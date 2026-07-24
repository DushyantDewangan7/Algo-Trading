"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SessionMomentum,
  SESSION_STATE,
  MINUTE_MS,
  HOUR_MS,
} = require("../strategy/session-momentum");
const {
  calculateLeveragedPnL,
  calculateSlippagePct,
  createLeveragedPosition,
  executeLiquidation,
  liquidationStatus,
  settleLeveragedPosition,
} = require("../strategy/leverage-sim");
const { baseSymbol } = require("../strategy/big-coins");

const T0 = Date.UTC(2026, 0, 1);

function row(symbol, price = 100, rank = 1, volumeINR = 10_000_000) {
  return { market: symbol, symbol, lastPrice: price, change24h: 10 - rank, volumeINR, rank };
}

function createHarness({
  config = {},
  big = ["BTC"],
  execution,
  minimumOrder = 1,
} = {}) {
  let now = T0;
  const service = {
    async fetchTopMarketCap() {
      return big;
    },
    isBigCoin(symbol) {
      return big.includes(baseSymbol(symbol));
    },
  };
  const strategy = new SessionMomentum({
    clock: () => now,
    config: {
      startingEquityINR: 1_000,
      maxPositions: 1,
      sessionMinutes: 60,
      scanMinutes: 1,
      trailPct: 6,
      paperLeverage: 5,
      cooldownMinutes: 30,
      smallCoinMaxHoldHours: 24,
      ...config,
    },
    bigCoins: service,
    minimumOrderProvider: async () => minimumOrder,
    universeProvider: async () => ({ rows: [] }),
    tickerProvider: async () => [],
    execution,
  });
  return {
    strategy,
    setNow(value) {
      now = value;
    },
  };
}

test("session expires at one hour and closes every open position as SESSION_EXPIRED", async () => {
  const { strategy } = createHarness();
  await strategy.startSession({ now: T0, capitalINR: 1_000 });
  await strategy.tick({
    now: T0,
    universe: { rows: [row("BTCINR")] },
    tickers: [row("BTCINR")],
  });
  assert.equal(strategy.state.positions.length, 1);

  const result = await strategy.tick({
    now: T0 + 60 * MINUTE_MS,
    tickers: [row("BTCINR", 105)],
  });

  assert.equal(result.status, SESSION_STATE.EXPIRED);
  assert.equal(strategy.state.positions.length, 0);
  assert.equal(strategy.state.closedTrades.length, 1);
  assert.equal(strategy.state.closedTrades[0].reason, "SESSION_EXPIRED");
  assert.ok(strategy.state.log.some((entry) => entry.type === "SESSION_EXPIRED"));
});

test("big coin remains held past 24h while a small coin is force-closed", async () => {
  const { strategy } = createHarness({
    config: { maxPositions: 2, sessionMinutes: 48 * 60 },
  });
  await strategy.startSession({ now: T0, capitalINR: 1_000 });
  const universe = { rows: [row("BTCINR", 100, 1), row("ABCINR", 100, 2)] };
  await strategy.tick({ now: T0, universe, tickers: universe.rows });
  assert.deepEqual(strategy.state.positions.map((position) => position.symbol).sort(), ["ABCINR", "BTCINR"]);

  await strategy.tick({
    now: T0 + 24 * HOUR_MS,
    universe,
    tickers: universe.rows,
  });

  assert.deepEqual(strategy.state.positions.map((position) => position.symbol), ["BTCINR"]);
  const smallExit = strategy.state.closedTrades.find((trade) => trade.symbol === "ABCINR");
  assert.equal(smallExit?.reason, "MAX_HOLD_EXPIRED");
  assert.equal(strategy.state.closedTrades.some((trade) => trade.symbol === "BTCINR"), false);
});

test("5x leverage amplifies a ten-percent price move to fifty percent of margin", () => {
  assert.ok(Math.abs(calculateLeveragedPnL({
    entryPrice: 100,
    currentPrice: 110,
    marginINR: 100,
    leverage: 5,
  }) - 50) < 1e-9);
  assert.ok(Math.abs(calculateLeveragedPnL({
    entryPrice: 100,
    currentPrice: 90,
    marginINR: 100,
    leverage: 5,
  }) - (-50)) < 1e-9);
});

test("liquidation fires at 90% margin loss even when the trailing stop is not reached", () => {
  const position = createLeveragedPosition({
    symbol: "ABCINR",
    entryPrice: 100,
    sizeINR: 100,
    leverage: 5,
    trailPct: 50,
    feePct: 0,
    timestamp: T0,
  });
  assert.equal(position.stopPrice, 50);
  assert.equal(liquidationStatus(position, 82).liquidated, true);
  assert.ok(82 > position.stopPrice, "fixture must not touch its trailing stop");

  const trade = executeLiquidation(position, 82, { timestamp: T0 + MINUTE_MS, feePct: 0, tdsPct: 0 });
  assert.equal(trade.reason, "LIQUIDATION");
  assert.equal(trade.grossPnL, -90);
});

test("30-minute cooldown blocks re-entry inside the window and permits it at expiry", async () => {
  const { strategy } = createHarness({ config: { sessionMinutes: 180 } });
  const universe = { rows: [row("ABCINR")] };
  await strategy.startSession({ now: T0, capitalINR: 1_000 });
  await strategy.tick({ now: T0, universe, tickers: universe.rows });
  assert.equal(strategy.state.positions.length, 1);

  const exitTime = T0 + MINUTE_MS;
  await strategy.tick({
    now: exitTime,
    universe,
    tickers: [row("ABCINR", 90)],
  });
  assert.equal(strategy.state.positions.length, 0);
  assert.equal(strategy.state.closedTrades[0].reason, "STOP_HIT");

  await strategy.tick({
    now: exitTime + 29 * MINUTE_MS,
    universe,
    tickers: universe.rows,
  });
  assert.equal(strategy.state.positions.length, 0);

  await strategy.tick({
    now: exitTime + 30 * MINUTE_MS,
    universe,
    tickers: universe.rows,
  });
  assert.equal(strategy.state.positions.length, 1);
  assert.equal(strategy.state.positionsOpened, 2);
});

test("the six-percent trailing stop ratchets upward and positions have no take-profit", async () => {
  const { strategy } = createHarness();
  const universe = { rows: [row("BTCINR")] };
  await strategy.startSession({ now: T0, capitalINR: 1_000 });
  await strategy.tick({ now: T0, universe, tickers: universe.rows });
  const position = strategy.state.positions[0];
  assert.equal("takeProfitPrice" in position, false);

  await strategy.tick({
    now: T0 + MINUTE_MS,
    universe,
    tickers: [row("BTCINR", 110)],
  });
  assert.equal(position.highestPrice, 110);
  assert.ok(Math.abs(position.stopPrice - 103.4) < 1e-9);

  await strategy.tick({
    now: T0 + 2 * MINUTE_MS,
    universe,
    tickers: [row("BTCINR", 108)],
  });
  assert.ok(Math.abs(position.stopPrice - 103.4) < 1e-9);
});

test("renewal restarts the timer without replacing positions and manual end returns to IDLE", async () => {
  const { strategy } = createHarness();
  const universe = { rows: [row("BTCINR")] };
  await strategy.startSession({ now: T0, capitalINR: 1_000 });
  await strategy.tick({ now: T0, universe, tickers: universe.rows });
  const originalPosition = strategy.state.positions[0];

  await strategy.renewSession({ now: T0 + 50 * MINUTE_MS });
  assert.equal(strategy.state.expiresAt, T0 + 110 * MINUTE_MS);
  await strategy.tick({
    now: T0 + 60 * MINUTE_MS,
    universe,
    tickers: universe.rows,
  });
  assert.equal(strategy.state.status, SESSION_STATE.RUNNING);
  assert.equal(strategy.state.positions[0], originalPosition);

  await strategy.endSession({
    now: T0 + 61 * MINUTE_MS,
    tickers: universe.rows,
  });
  assert.equal(strategy.state.status, SESSION_STATE.IDLE);
  assert.equal(strategy.state.positions.length, 0);
  assert.equal(strategy.state.closedTrades.at(-1).reason, "SESSION_ENDED");
});

test("fees, sell-side TDS, and bounded slippage are included in leveraged settlement", () => {
  assert.equal(calculateSlippagePct(100, 10_000_000), 0.1);
  assert.equal(calculateSlippagePct(1_000_000, 1), 2);
  const position = createLeveragedPosition({
    symbol: "BTCINR",
    entryPrice: 100,
    sizeINR: 100,
    leverage: 5,
    trailPct: 6,
    feePct: 0.1,
  });
  const trade = settleLeveragedPosition(position, 100, { feePct: 0.1, tdsPct: 1 });
  assert.equal(trade.grossPnL, 0);
  assert.equal(trade.entryFee, 0.5);
  assert.equal(trade.sellFee, 0.5);
  assert.equal(trade.tds, 5);
  assert.equal(trade.netPnL, -6);
  assert.equal(trade.netProceeds, 94);
});

test("execution hook failures do not commit an entry or discard an open position", async () => {
  let failOpen = true;
  let failClose = true;
  const execution = {
    async openPosition(intent) {
      if (failOpen) throw new Error("open rejected");
      return { fillPrice: intent.expectedFillPrice, orderId: "open-1" };
    },
    async closePosition(_position, _reason, price) {
      if (failClose) throw new Error("close rejected");
      return { fillPrice: price, orderId: "close-1" };
    },
  };
  const { strategy } = createHarness({ execution });
  const universe = { rows: [row("BTCINR")] };
  await strategy.startSession({ now: T0, capitalINR: 1_000 });
  await strategy.tick({ now: T0, universe, tickers: universe.rows });
  assert.equal(strategy.state.positions.length, 0);
  assert.equal(strategy.state.cashINR, 1_000);

  failOpen = false;
  await strategy.tick({ now: T0 + MINUTE_MS, universe, tickers: universe.rows });
  assert.equal(strategy.state.positions.length, 1);
  const tracked = strategy.state.positions[0];

  await strategy.endSession({ now: T0 + 2 * MINUTE_MS, tickers: universe.rows });
  assert.equal(strategy.state.status, SESSION_STATE.EXPIRED);
  assert.equal(strategy.state.positions[0], tracked);
  assert.equal(tracked.closePendingReason, "SESSION_ENDED");

  failClose = false;
  await strategy.tick({ now: T0 + 3 * MINUTE_MS, tickers: universe.rows });
  assert.equal(strategy.state.positions.length, 0);
});
