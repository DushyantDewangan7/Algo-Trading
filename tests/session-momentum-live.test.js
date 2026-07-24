"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SessionMomentumLiveRuntime,
  SessionMomentumLiveService,
  buildAccountView,
  buildConversionPlan,
  configuredLiveLeverage,
} = require("../strategy/session-momentum-live");
const {
  CoinDcxLiveClient,
  FUTURES_WALLET_TRANSFER_ENDPOINT,
  auditLog,
} = require("../strategy/coindcx-live");

function fakeRuntime() {
  return {
    running: false,
    starts: [],
    isRunning() {
      return this.running;
    },
    async start(options) {
      this.starts.push(options);
      this.running = true;
      return { running: true };
    },
    async renew() {
      return { running: this.running, renewed: true };
    },
    async stop() {
      this.running = false;
      return { running: false };
    },
    status() {
      return { running: this.running };
    },
  };
}

function fakeClient({ initialInr = 50, cryptoBalance = 0.001 } = {}) {
  return {
    sold: false,
    futuresBalance: 0,
    sellCalls: [],
    transfers: [],
    hasCredentials: () => true,
    log: () => null,
    async balances() {
      if (this.sold) return [{ currency: "INR", balance: "1039", locked_balance: "0" }];
      return [
        { currency: "INR", balance: String(initialInr), locked_balance: "0" },
        { currency: "BTC", balance: String(cryptoBalance), locked_balance: "0" },
      ];
    },
    async listFuturesPositions() {
      return [];
    },
    async futuresWallets() {
      return this.futuresBalance > 0
        ? [{ currency_short_name: "INR", balance: String(this.futuresBalance), locked_balance: "0" }]
        : [];
    },
    async createSpotMarketSell(order) {
      this.sellCalls.push(order);
      return { orders: [{ id: "spot-1", status: "open" }] };
    },
    async waitForSpotFill() {
      this.sold = true;
      return { id: "spot-1", status: "filled", avg_price: 1_000_000 };
    },
    async transferToFutures(amount, currency) {
      this.transfers.push({ amount, currency });
      this.futuresBalance += amount;
      return { status: "success" };
    },
  };
}

const tickerRows = [
  { market: "BTCINR", last_price: "1000000", volume: "100" },
];

test("account view and direct-INR conversion quote include fee and TDS", () => {
  const account = buildAccountView([
    { currency: "INR", balance: "50", locked_balance: "5" },
    { currency: "BTC", balance: "0.001", locked_balance: "0" },
  ], tickerRows);
  const plan = buildConversionPlan(account, tickerRows, [{
    coindcx_name: "BTCINR",
    target_currency_short_name: "BTC",
    base_currency_short_name: "INR",
    target_currency_precision: 8,
  }]);

  assert.equal(account.inrAvailable, 50);
  assert.equal(account.totalValueInr, 1055);
  assert.equal(plan.totalSellValueInr, 1000);
  assert.equal(plan.totalFeeInr, 1);
  assert.equal(plan.totalTdsInr, 10);
  assert.equal(plan.estimatedInrAfterConversion, 1039);
});

test("conversion approval never sends an order before exact final LIVE", async () => {
  const client = fakeClient();
  const runtime = fakeRuntime();
  const service = new SessionMomentumLiveService({
    client,
    runtime,
    env: { LIVE_TRADING_ENABLED: "true", LIVE_LEVERAGE: "3" },
    tickerProvider: async () => ({ rows: tickerRows }),
    marketDetailsProvider: async () => [{
      coindcx_name: "BTCINR",
      target_currency_short_name: "BTC",
      base_currency_short_name: "INR",
      target_currency_precision: 8,
    }],
  });

  const preflight = await service.preflight();
  await service.prepare({ gateId: preflight.gateId, convertToInr: true });
  await service.approveConversion({ gateId: preflight.gateId });
  assert.equal(client.sellCalls.length, 0);
  await assert.rejects(
    service.start({ gateId: preflight.gateId, confirmation: "live" }),
    (error) => error.code === "LIVE_CONFIRMATION_REQUIRED",
  );
  assert.equal(client.sellCalls.length, 0);

  const started = await service.start({ gateId: preflight.gateId, confirmation: "LIVE" });
  assert.equal(started.started, true);
  assert.equal(client.sellCalls.length, 1);
  assert.deepEqual(client.transfers, [{ amount: 1039, currency: "INR" }]);
  assert.deepEqual(runtime.starts, [{
    capitalINR: 1039,
    leverage: 3,
    sessionId: `live-${preflight.gateId}`,
  }]);
});

test("server flag blocks final start and causes no sell or transfer", async () => {
  const client = fakeClient({ initialInr: 200, cryptoBalance: 0 });
  const service = new SessionMomentumLiveService({
    client,
    runtime: fakeRuntime(),
    env: { LIVE_TRADING_ENABLED: "false", LIVE_LEVERAGE: "3" },
    tickerProvider: async () => ({ rows: tickerRows }),
    marketDetailsProvider: async () => [],
  });
  const preflight = await service.preflight();
  await service.prepare({ gateId: preflight.gateId, convertToInr: false });

  await assert.rejects(
    service.start({ gateId: preflight.gateId, confirmation: "LIVE" }),
    (error) => error.code === "LIVE_TRADING_DISABLED" && error.details.restartGate,
  );
  assert.equal(client.sellCalls.length, 0);
  assert.equal(client.transfers.length, 0);
});

test("live leverage rejects values above the 5x hard maximum", () => {
  assert.throws(
    () => configuredLiveLeverage({ LIVE_LEVERAGE: "5.1" }),
    (error) => error.code === "INVALID_LIVE_LEVERAGE",
  );
  assert.equal(configuredLiveLeverage({ LIVE_LEVERAGE: "5" }), 5);
});

test("Futures execution validates the instrument and fills before returning", async () => {
  const events = [];
  const client = {
    log(event) {
      events.push(event);
    },
    async activeInstruments() {
      return ["B-BTC_USDT"];
    },
    async instrument() {
      return {
        instrument: {
          pair: "B-BTC_USDT",
          status: "active",
          quantity_increment: 0.001,
          min_quantity: 0.001,
          min_notional: 1,
          max_leverage_long: 10,
        },
      };
    },
    async createFuturesMarketOrder(order) {
      events.push({ create: order });
      return [{ id: "order-1", pair: order.pair, status: "initial" }];
    },
    async waitForFuturesFill(id) {
      events.push({ fill: id });
      return { id, pair: "B-BTC_USDT", status: "filled", avg_price: 60000 };
    },
    async listFuturesPositions() {
      return [{
        id: "position-1",
        pair: "B-BTC_USDT",
        active_pos: 0.019,
        margin_currency_short_name: "INR",
      }];
    },
  };
  const runtime = new SessionMomentumLiveRuntime({
    client,
    recoveryStateFile: "Z:/session-momentum-test-open.json",
  });
  const result = await runtime.openPosition({
    symbol: "BTCINR",
    referencePrice: 5_000_000,
    expectedFillPrice: 5_050_000,
    exposureINR: 100_000,
    leverage: 3,
  });

  assert.equal(events[0].create.pair, "B-BTC_USDT");
  assert.equal(events[0].create.quantity, 0.019);
  assert.deepEqual(events[1], { fill: "order-1" });
  assert.equal(result.quantity, 0.019);
  assert.equal(result.positionId, "position-1");
  assert.equal(result.fillPrice, 100_000 / 0.019);
});

test("CoinDCX client serializes documented position filters and uses Futures wallet transfer", async () => {
  const calls = [];
  const client = new CoinDcxLiveClient({
    apiKey: "test-key",
    secret: "test-secret",
    logFile: "Z:/definitely-missing/live.log",
    transport: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { status: 200, headers: {}, data: [] };
    },
  });

  await client.listFuturesPositions({ pairs: ["B-BTC_USDT"], positionIds: ["p-1"] });
  await client.updateFuturesLeverage({ pair: "B-BTC_USDT", leverage: 3 });
  await client.transferToFutures(250, "INR");

  assert.equal(calls[0].body.pairs, "B-BTC_USDT");
  assert.equal(calls[0].body.position_ids, "p-1");
  assert.equal(calls[1].body.leverage, "3");
  assert.equal(calls[1].body.margin_currency_short_name, "INR");
  assert.ok(calls[2].url.endsWith(FUTURES_WALLET_TRANSFER_ENDPOINT));
  assert.equal(calls[2].body.transfer_type, "deposit");
  assert.equal(calls[2].body.currency_short_name, "INR");
  assert.equal(calls[2].body.amount, 250);
});

test("audit logging failure is non-fatal to emergency API operations", () => {
  const circular = {};
  circular.self = circular;
  const result = auditLog("Z:/definitely-missing/live.log", "EXIT", circular);
  assert.equal(result.logFailed, true);
});

test("ambiguous Futures create blocks new entries and performs containment without retry", async () => {
  let creates = 0;
  const client = {
    log: () => null,
    async activeInstruments() {
      return ["B-BTC_USDT"];
    },
    async instrument() {
      return { instrument: {
        pair: "B-BTC_USDT",
        status: "active",
        margin_currency_short_name: "INR",
        quantity_increment: 0.001,
        min_quantity: 0.001,
        min_notional: 60,
        max_leverage_long: 10,
      } };
    },
    async createFuturesMarketOrder() {
      creates += 1;
      throw Object.assign(new Error("socket reset after write"), { code: "ECONNRESET" });
    },
    async listFuturesOrders() {
      return [];
    },
    async listFuturesPositions() {
      return [];
    },
  };
  const runtime = new SessionMomentumLiveRuntime({
    client,
    recoveryStateFile: "Z:/session-momentum-test-ambiguous.json",
  });

  await assert.rejects(
    runtime.openPosition({
      symbol: "BTCINR",
      referencePrice: 5_000_000,
      expectedFillPrice: 5_000_000,
      exposureINR: 100_000,
      leverage: 3,
    }),
    (error) => error.code === "FUTURES_CREATE_UNCERTAIN",
  );
  assert.equal(creates, 1);
  assert.equal(runtime.blocked, true);
  assert.deepEqual(await runtime.getQualifiedUniverse(), []);
});

test("kill switch fences an in-flight tick before two exchange-wide close sweeps", async () => {
  const events = [];
  let releaseTick;
  const inFlightTick = new Promise((resolve) => {
    releaseTick = () => {
      events.push("tick-finished");
      resolve();
    };
  });
  const client = {
    log: () => null,
    async cancelAllFuturesOrders() {
      events.push("cancel-all");
      return { status: 200 };
    },
    async listFuturesPositions() {
      events.push("list-positions");
      return [];
    },
  };
  const runtime = new SessionMomentumLiveRuntime({
    client,
    recoveryStateFile: "Z:/session-momentum-test-kill.json",
  });
  runtime.running = true;
  runtime.tickPromise = inFlightTick;
  runtime.engine = {
    state: { positions: [], closedTrades: [], log: [] },
    status: () => ({ status: "RUNNING" }),
    async endSession() {
      events.push("local-end");
      return { status: "IDLE" };
    },
  };

  const stopping = runtime.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, []);
  releaseTick();
  const status = await stopping;

  assert.equal(events[0], "tick-finished");
  assert.equal(events.filter((event) => event === "cancel-all").length, 2);
  assert.equal(status.running, false);
  assert.equal(status.lastStopResult.verifiedFlat, true);
});

test("session expiry performs an exchange-wide cancel and flat verification", async () => {
  let cancels = 0;
  const client = {
    log: () => null,
    async cancelAllFuturesOrders() {
      cancels += 1;
      return { status: 200 };
    },
    async listFuturesPositions() {
      return [];
    },
  };
  const runtime = new SessionMomentumLiveRuntime({
    client,
    recoveryStateFile: "Z:/session-momentum-test-expiry.json",
  });
  runtime.running = true;
  runtime.engine = {
    state: { positions: [], closedTrades: [], log: [] },
    status: () => ({ status: "EXPIRED", expiresAt: 1 }),
    async tick() {
      return { status: "EXPIRED" };
    },
  };

  const status = await runtime.tick();
  assert.equal(cancels, 1);
  assert.equal(status.running, false);
  assert.equal(status.lastStopResult.reason, "SESSION_EXPIRED");
});

test("account view includes available INR already held in the Futures wallet", () => {
  const account = buildAccountView(
    [{ currency: "INR", balance: "50", locked_balance: "0" }],
    tickerRows,
    [{ currency_short_name: "INR", balance: "125", locked_balance: "0" }],
  );
  assert.equal(account.spotInrAvailable, 50);
  assert.equal(account.futuresInrAvailable, 125);
  assert.equal(account.inrAvailable, 175);
  assert.equal(account.totalValueInr, 175);
});
