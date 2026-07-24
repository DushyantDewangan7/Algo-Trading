"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  CoinDcxLiveClient,
  baseAssetFromSymbol,
  firstOrder,
  futuresPairForSymbol,
} = require("./coindcx-live");
const {
  SessionMomentum,
  SESSION_STATE,
  MINUTE_MS,
  getConfig: getSessionConfig,
} = require("./session-momentum");
const {
  fetchQualifiedGainers,
  fetchTickerSnapshot,
  normalizeInrTicker,
} = require("./top-gainers");

const GATE_TTL_MS = 15 * MINUTE_MS;
const MIN_LIVE_CAPITAL_INR = 100;
const MAX_LIVE_LEVERAGE = 5;
const SPOT_FEE_PCT = 0.1;
const SELL_TDS_PCT = 1;
const EPSILON = 1e-12;
const LIVE_RECOVERY_STATE_FILE = path.join(__dirname, "..", "live-session-state.json");
const CLOSED_POSITION_STATUSES = new Set([
  "closed",
  "exited",
  "settled",
  "liquidated",
  "cancelled",
  "canceled",
]);

function liveError(code, message, status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== null) error.details = details;
  return error;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback = 0) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readRecoveryMarker(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeRecoveryMarker(file, marker) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(marker, null, 2));
  fs.renameSync(temporary, file);
}

function clearRecoveryMarker(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // A stale marker only causes another defensive close sweep on restart.
  }
}

function money(value) {
  return Math.round((finiteNumber(value) + Number.EPSILON) * 100) / 100;
}

function incrementDecimals(increment) {
  const text = String(increment).toLowerCase();
  if (text.includes("e-")) {
    const [coefficient, exponent] = text.split("e-");
    return Math.min(12, Number(exponent) + (coefficient.split(".")[1] || "").length);
  }
  return Math.min(12, (text.split(".")[1] || "").length);
}

// The exchange commonly publishes increments in scientific notation (for
// example 1e-8), which Number#toFixed cannot infer from String#split alone.
function roundQuantityDown(value, increment) {
  const quantity = positiveNumber(value);
  const step = positiveNumber(increment);
  if (!(quantity > 0)) return 0;
  if (!(step > 0)) return quantity;
  const units = Math.floor((quantity + step * 1e-10) / step);
  return Number((units * step).toFixed(incrementDecimals(step)));
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "balances", "positions", "orders", "wallets", "result"]) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === "object") {
      const nested = rowsFrom(payload[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function entityId(value) {
  return value?.id ?? value?.order_id ?? value?.orderId ??
    value?.position_id ?? value?.positionId ?? null;
}

function firstExchangeOrder(payload) {
  if (Array.isArray(payload?.orders)) return payload.orders[0] || null;
  if (Array.isArray(payload?.data?.orders)) return payload.data.orders[0] || null;
  return firstOrder(payload);
}

function normalizedPair(value) {
  return String(
    value?.pair ?? value?.instrument ?? value?.symbol ?? value?.market ?? value ?? "",
  ).trim().toUpperCase();
}

function normalizeActiveInstruments(payload) {
  const source = Array.isArray(payload) ? payload : rowsFrom(payload);
  return [...new Set(source.map(normalizedPair).filter(Boolean))];
}

function mapFuturesPair(symbol, activeInstruments) {
  const documented = futuresPairForSymbol(symbol, activeInstruments);
  if (documented) return documented;
  const asset = baseAssetFromSymbol(symbol);
  return activeInstruments.find((candidate) => {
    const pair = normalizedPair(candidate);
    return pair === asset ||
      pair.startsWith(`${asset}_`) || pair.startsWith(`${asset}-`) ||
      pair.startsWith(`B-${asset}_`) || pair.startsWith(`B-${asset}-`);
  }) || null;
}

function positionAmount(position) {
  for (const key of [
    "active_pos",
    "active_position",
    "position_size",
    "position_quantity",
    "position_amount",
    "size",
    "quantity",
    "qty",
  ]) {
    if (position?.[key] !== undefined && Number.isFinite(Number(position[key]))) {
      return Number(position[key]);
    }
  }
  return 0;
}

function isInrPosition(position) {
  const marginCurrency = String(
    position?.margin_currency_short_name ?? position?.margin_currency ??
    position?.settlement_currency ?? "INR",
  ).trim().toUpperCase();
  return !marginCurrency || marginCurrency === "INR";
}

function isActiveFuturesPosition(position) {
  if (!position || !isInrPosition(position)) return false;
  const status = String(position.status || position.position_status || "").trim().toLowerCase();
  if (CLOSED_POSITION_STATUSES.has(status)) return false;
  return Math.abs(positionAmount(position)) > EPSILON;
}

function extractActiveFuturesPositions(payload) {
  return rowsFrom(payload).filter(isActiveFuturesPosition);
}

function balanceCurrency(balance) {
  return String(
    balance?.currency ?? balance?.currency_short_name ?? balance?.asset ?? balance?.coin ?? "",
  ).trim().toUpperCase();
}

function availableBalance(balance) {
  return Math.max(0, finiteNumber(
    balance?.balance ?? balance?.available_balance ?? balance?.available ?? balance?.free,
  ));
}

function lockedBalance(balance) {
  return Math.max(0, finiteNumber(
    balance?.locked_balance ?? balance?.locked ?? balance?.in_order,
  ));
}

function normalizeBalances(payload) {
  return rowsFrom(payload)
    .map((row) => {
      const currency = balanceCurrency(row);
      const available = availableBalance(row);
      const locked = lockedBalance(row);
      return {
        currency,
        available,
        locked,
        total: available + locked,
      };
    })
    .filter((row) => row.currency && row.total > EPSILON);
}

function normalizeTickerRows(payload) {
  const source = Array.isArray(payload) ? payload : payload?.rows;
  if (!Array.isArray(source)) return [];
  return source.map((ticker) => {
    const market = String(ticker?.market || ticker?.symbol || "").trim().toUpperCase();
    return {
      raw: ticker,
      market,
      price: positiveNumber(ticker?.last_price ?? ticker?.lastPrice ?? ticker?.price),
      volume: Math.max(0, finiteNumber(ticker?.volume ?? ticker?.baseVolume)),
    };
  }).filter((ticker) => ticker.market && ticker.price > 0);
}

function directInrTicker(currency, tickers) {
  const desired = `${String(currency).toUpperCase()}INR`;
  return tickers.find((ticker) => ticker.market === desired) || null;
}

function inrPrice(currency, tickers) {
  const symbol = String(currency || "").toUpperCase();
  if (symbol === "INR") return 1;
  const direct = directInrTicker(symbol, tickers);
  if (direct) return direct.price;
  const againstUsdt = tickers.find((ticker) => ticker.market === `${symbol}USDT`);
  const usdtInr = directInrTicker("USDT", tickers);
  return againstUsdt && usdtInr ? againstUsdt.price * usdtInr.price : null;
}

function marketAsset(detail) {
  return String(
    detail?.target_currency_short_name ?? detail?.target_currency ?? detail?.asset ?? "",
  ).trim().toUpperCase();
}

function marketQuote(detail) {
  return String(
    detail?.base_currency_short_name ?? detail?.base_currency ?? detail?.quote ?? "",
  ).trim().toUpperCase();
}

function marketName(detail) {
  return String(detail?.coindcx_name ?? detail?.symbol ?? detail?.market ?? "")
    .trim().toUpperCase();
}

function decimalIncrement(precision) {
  const places = Number(precision);
  if (!Number.isInteger(places) || places < 0 || places > 12) return null;
  return 10 ** -places;
}

function quantityIncrement(detail) {
  for (const key of [
    "quantity_increment",
    "quantity_step",
    "step_size",
    "target_currency_step",
    "min_quantity_increment",
    "step",
  ]) {
    const value = positiveNumber(detail?.[key]);
    if (value > 0) return value;
  }
  return decimalIncrement(
    detail?.target_currency_precision ?? detail?.quantity_precision ?? detail?.amount_precision,
  ) || 1e-8;
}

function minimumQuantity(detail) {
  for (const key of [
    "min_quantity",
    "minimum_quantity",
    "min_order_size",
    "minimum_order_size",
    "min_trade_quantity",
  ]) {
    const value = positiveNumber(detail?.[key]);
    if (value > 0) return value;
  }
  return 0;
}

function minimumNotional(detail) {
  for (const key of [
    "min_notional",
    "minimum_notional",
    "min_order_value",
    "minimum_order_value",
  ]) {
    const value = positiveNumber(detail?.[key]);
    if (value > 0) return value;
  }
  return 0;
}

function findDirectInrMarket(currency, tickers, details) {
  const asset = String(currency || "").toUpperCase();
  const detail = details.find((row) =>
    marketAsset(row) === asset && marketQuote(row) === "INR" && marketName(row),
  );
  const ticker = directInrTicker(asset, tickers);
  const name = marketName(detail) || ticker?.market || null;
  if (!name || !ticker) return null;
  return { name, ticker, detail: detail || null };
}

function normalizeFuturesWallets(payload, tickerPayload = []) {
  const tickers = normalizeTickerRows(tickerPayload);
  return rowsFrom(payload).map((row) => {
    const currency = balanceCurrency(row);
    const available = Math.max(0, finiteNumber(
      row?.available_balance_isolated ?? row?.withdrawable_balance ?? row?.balance,
    ));
    const locked = Math.max(0, finiteNumber(row?.locked_balance));
    const total = available + locked;
    const priceInr = inrPrice(currency, tickers);
    return {
      currency,
      wallet: "futures",
      available,
      locked,
      total,
      priceInr,
      valueInr: priceInr === null ? null : money(total * priceInr),
    };
  }).filter((row) => row.currency && row.total > EPSILON);
}

function buildAccountView(balancePayload, tickerPayload, futuresWalletPayload = []) {
  const balances = normalizeBalances(balancePayload);
  const tickers = normalizeTickerRows(tickerPayload);
  const holdings = balances.map((balance) => {
    const priceInr = inrPrice(balance.currency, tickers);
    return {
      ...balance,
      priceInr,
      valueInr: priceInr === null ? null : money(balance.total * priceInr),
      availableValueInr: priceInr === null ? null : money(balance.available * priceInr),
      hasDirectInrMarket: balance.currency === "INR" ||
        Boolean(directInrTicker(balance.currency, tickers)),
    };
  }).sort((a, b) => (b.valueInr ?? -1) - (a.valueInr ?? -1));
  const inr = holdings.find((holding) => holding.currency === "INR");
  const futuresWallets = normalizeFuturesWallets(futuresWalletPayload, tickerPayload);
  const futuresInr = futuresWallets.find((wallet) => wallet.currency === "INR");
  const spotInrAvailable = inr?.available || 0;
  const futuresInrAvailable = futuresInr?.available || 0;
  const knownValue = holdings.reduce((sum, holding) => sum + (holding.valueInr || 0), 0) +
    futuresWallets.reduce((sum, wallet) => sum + (wallet.valueInr || 0), 0);
  const unknownValueCurrencies = holdings
    .filter((holding) => holding.valueInr === null)
    .map((holding) => holding.currency)
    .concat(futuresWallets.filter((wallet) => wallet.valueInr === null)
      .map((wallet) => `${wallet.currency}:futures`));
  return {
    inrAvailable: spotInrAvailable + futuresInrAvailable,
    availableInr: spotInrAvailable + futuresInrAvailable,
    cashBalanceInr: spotInrAvailable + futuresInrAvailable,
    spotInrAvailable,
    futuresInrAvailable,
    inrLocked: inr?.locked || 0,
    holdings,
    nonInrHoldings: holdings.filter((holding) => holding.currency !== "INR"),
    futuresWallets,
    nonInrFuturesWallets: futuresWallets.filter((wallet) => wallet.currency !== "INR"),
    totalValueInr: money(knownValue),
    valuationComplete: unknownValueCurrencies.length === 0,
    unknownValueCurrencies,
    valuedAt: Date.now(),
  };
}

function buildConversionPlan(account, tickerPayload, marketDetails = []) {
  const tickers = normalizeTickerRows(tickerPayload);
  const details = Array.isArray(marketDetails) ? marketDetails : rowsFrom(marketDetails);
  const sells = [];
  const unavailable = [];

  for (const wallet of account.nonInrFuturesWallets || []) {
    if (wallet.total > EPSILON) {
      unavailable.push({
        currency: wallet.currency,
        reason: "NON_INR_FUTURES_WALLET",
        quantity: wallet.total,
      });
    }
  }

  for (const holding of account.nonInrHoldings) {
    if (holding.locked > EPSILON) {
      unavailable.push({
        currency: holding.currency,
        reason: "LOCKED_BALANCE",
        quantity: holding.locked,
      });
    }
    if (!(holding.available > EPSILON)) {
      continue;
    }
    const direct = findDirectInrMarket(holding.currency, tickers, details);
    if (!direct) {
      unavailable.push({
        currency: holding.currency,
        reason: "NO_DIRECT_INR_MARKET",
        quantity: holding.available,
      });
      continue;
    }
    const step = quantityIncrement(direct.detail);
    const sellQuantity = roundQuantityDown(holding.available, step);
    const minimum = minimumQuantity(direct.detail);
    if (!(sellQuantity > 0) || (minimum > 0 && sellQuantity < minimum)) {
      unavailable.push({
        currency: holding.currency,
        reason: "BELOW_MINIMUM_QUANTITY",
        quantity: holding.available,
        minimumQuantity: minimum || step,
      });
      continue;
    }
    const grossValueInr = sellQuantity * direct.ticker.price;
    const minNotionalInr = minimumNotional(direct.detail);
    if (minNotionalInr > 0 && grossValueInr < minNotionalInr) {
      unavailable.push({
        currency: holding.currency,
        reason: "BELOW_MINIMUM_NOTIONAL",
        valueInr: money(grossValueInr),
        minimumValueInr: minNotionalInr,
      });
      continue;
    }
    const feeInr = grossValueInr * SPOT_FEE_PCT / 100;
    const tdsInr = grossValueInr * SELL_TDS_PCT / 100;
    sells.push({
      currency: holding.currency,
      market: direct.name,
      availableQuantity: holding.available,
      sellQuantity,
      quantityIncrement: step,
      currentPriceInr: direct.ticker.price,
      estimatedSellValueInr: money(grossValueInr),
      feeInr: money(feeInr),
      tdsInr: money(tdsInr),
      estimatedNetInr: money(grossValueInr - feeInr - tdsInr),
    });
  }

  const totalSellValueInr = money(sells.reduce(
    (sum, sell) => sum + sell.estimatedSellValueInr,
    0,
  ));
  const totalFeeInr = money(sells.reduce((sum, sell) => sum + sell.feeInr, 0));
  const totalTdsInr = money(sells.reduce((sum, sell) => sum + sell.tdsInr, 0));
  const estimatedConversionNetInr = money(sells.reduce(
    (sum, sell) => sum + sell.estimatedNetInr,
    0,
  ));
  return {
    sells,
    unavailable,
    totalSellValueInr,
    totalValueInr: totalSellValueInr,
    totalFeeInr,
    totalTdsInr,
    estimatedConversionNetInr,
    existingInrAvailable: account.inrAvailable,
    estimatedInrAfterConversion: money(account.inrAvailable + estimatedConversionNetInr),
    feePct: SPOT_FEE_PCT,
    tdsPct: SELL_TDS_PCT,
    complete: unavailable.length === 0,
  };
}

function configuredLiveLeverage(env = process.env) {
  const raw = String(env.LIVE_LEVERAGE ?? "").trim();
  const leverage = raw ? Number(raw) : 3;
  if (!Number.isFinite(leverage) || leverage < 1 || leverage > MAX_LIVE_LEVERAGE) {
    throw liveError(
      "INVALID_LIVE_LEVERAGE",
      `LIVE_LEVERAGE must be between 1 and ${MAX_LIVE_LEVERAGE}.`,
      503,
    );
  }
  return leverage;
}

function publicConfig(env = process.env) {
  const session = getSessionConfig();
  let liveLeverage;
  try {
    liveLeverage = configuredLiveLeverage(env);
  } catch {
    liveLeverage = finiteNumber(env.LIVE_LEVERAGE, 3);
  }
  return {
    sessionMinutes: session.sessionMinutes,
    scanMinutes: session.scanMinutes,
    trailPct: session.trailPct,
    maxPositions: session.maxPositions,
    paperLeverage: session.paperLeverage,
    liveLeverage,
    smallCoinMaxHoldHours: session.smallCoinMaxHoldHours,
    cooldownMinutes: session.cooldownMinutes,
  };
}

function instrumentDetail(payload) {
  if (Array.isArray(payload)) return payload[0] || null;
  if (Array.isArray(payload?.data)) return payload.data[0] || null;
  if (payload?.instrument && typeof payload.instrument === "object") return payload.instrument;
  if (payload?.data?.instrument && typeof payload.data.instrument === "object") {
    return payload.data.instrument;
  }
  return payload?.data && typeof payload.data === "object" ? payload.data : payload;
}

function futuresQuantityIncrement(instrument) {
  for (const key of [
    "quantity_increment",
    "quantity_step",
    "step_size",
    "min_quantity_increment",
    "contract_size",
  ]) {
    const value = positiveNumber(instrument?.[key]);
    if (value > 0) return value;
  }
  return decimalIncrement(
    instrument?.quantity_precision ?? instrument?.amount_precision ??
    instrument?.base_currency_precision,
  ) || 1e-8;
}

function futuresMinimumQuantity(instrument) {
  for (const key of [
    "min_trade_quantity",
    "min_trade_size",
    "minimum_trade_quantity",
    "min_quantity",
    "minimum_quantity",
    "min_order_quantity",
  ]) {
    const value = positiveNumber(instrument?.[key]);
    if (value > 0) return value;
  }
  return 0;
}

function futuresMaxLeverage(instrument) {
  for (const key of [
    "max_leverage",
    "maximum_leverage",
    "maxLeverage",
    "max_leverage_long",
  ]) {
    const value = positiveNumber(instrument?.[key]);
    if (value > 0) return value;
  }
  const values = instrument?.allowed_leverages ?? instrument?.leverages;
  if (Array.isArray(values)) return Math.max(...values.map(Number).filter(Number.isFinite), 0);
  return null;
}

function futuresMaximumMarketQuantity(instrument) {
  const limits = [
    instrument?.max_market_order_quantity,
    instrument?.maximum_market_order_quantity,
    instrument?.max_quantity,
    instrument?.maximum_quantity,
  ].map((value) => positiveNumber(value)).filter((value) => value > 0);
  return limits.length ? Math.min(...limits) : null;
}

function futuresFillPrice(order) {
  for (const key of [
    "avg_price",
    "average_price",
    "filled_price",
    "execution_price",
    "price",
  ]) {
    const value = positiveNumber(order?.[key]);
    if (value > 0) return value;
  }
  return null;
}

function futuresFillPriceInr(order) {
  const price = futuresFillPrice(order);
  if (!(price > 0)) return null;
  const conversion = positiveNumber(
    order?.settlement_currency_conversion_price ?? order?.conversion_price,
  );
  if (conversion > 0) return price * conversion;
  return null;
}

function orderTimestamp(order) {
  return finiteNumber(
    order?.created_at ?? order?.createdAt ?? order?.timestamp ?? order?.updated_at,
  );
}

class SessionMomentumLiveRuntime {
  constructor({
    client = new CoinDcxLiveClient(),
    Strategy = SessionMomentum,
    qualifiedProvider = fetchQualifiedGainers,
    tickerProvider = fetchTickerSnapshot,
    clock = Date.now,
    intervalMs = MINUTE_MS,
    config = {},
    recoveryStateFile = LIVE_RECOVERY_STATE_FILE,
  } = {}) {
    this.client = client;
    this.Strategy = Strategy;
    this.qualifiedProvider = qualifiedProvider;
    this.tickerProvider = tickerProvider;
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.configOverrides = config;
    this.recoveryStateFile = recoveryStateFile;
    this.recoveryMarker = readRecoveryMarker(recoveryStateFile);
    this.recoveryPending = Boolean(this.recoveryMarker);
    this.engine = null;
    this.timer = null;
    this.running = false;
    this.stopping = false;
    this.tickPromise = null;
    this.killPromise = null;
    this.activeInstrumentPairs = [];
    this.instrumentCache = new Map();
    this.lastError = null;
    this.lastTickAt = null;
    this.startedAt = null;
    this.lastStopResult = null;
    this.lastTickerRows = [];
    this.lifecycleVersion = 0;
    this.blocked = false;
    this.blockReason = null;
  }

  isRunning() {
    return this.running || this.stopping || this.recoveryPending;
  }

  persistRecoveryMarker() {
    if (!this.engine) return;
    const strategy = this.engine.status(this.clock());
    const marker = {
      version: 1,
      mode: "live",
      sessionId: strategy.sessionId,
      startedAt: strategy.sessionStartedAt,
      expiresAt: strategy.expiresAt,
      leverage: strategy.config?.leverage,
      updatedAt: this.clock(),
    };
    writeRecoveryMarker(this.recoveryStateFile, marker);
    this.recoveryMarker = marker;
    this.recoveryPending = true;
  }

  clearRecoveryState() {
    clearRecoveryMarker(this.recoveryStateFile);
    this.recoveryMarker = null;
    this.recoveryPending = false;
  }

  log(event, details = {}) {
    return this.client.log?.(event, details);
  }

  async refreshActiveInstruments() {
    const payload = await this.client.activeInstruments("INR");
    const pairs = normalizeActiveInstruments(payload);
    if (!pairs.length) {
      throw liveError(
        "NO_ACTIVE_INR_FUTURES",
        "CoinDCX returned no active INR-margined Futures instruments.",
        502,
      );
    }
    this.activeInstrumentPairs = pairs;
    return pairs;
  }

  async pairAndInstrument(symbol) {
    if (!this.activeInstrumentPairs.length) await this.refreshActiveInstruments();
    const pair = mapFuturesPair(symbol, this.activeInstrumentPairs);
    if (!pair) {
      throw liveError(
        "FUTURES_INSTRUMENT_UNAVAILABLE",
        `No active INR-margined CoinDCX Futures instrument maps to ${symbol}.`,
        422,
      );
    }
    if (!this.instrumentCache.has(pair)) {
      const payload = await this.client.instrument(pair, "INR");
      const detail = instrumentDetail(payload);
      if (!detail || typeof detail !== "object") {
        throw liveError(
          "INVALID_FUTURES_INSTRUMENT",
          `CoinDCX returned invalid instrument metadata for ${pair}.`,
          502,
        );
      }
      if (String(detail.status || "active").toLowerCase() !== "active" || detail.exit_only === true) {
        throw liveError(
          "FUTURES_INSTRUMENT_NOT_TRADABLE",
          `${pair} is not open for new Futures positions.`,
          422,
        );
      }
      this.instrumentCache.set(pair, detail);
    }
    return { pair, instrument: this.instrumentCache.get(pair) };
  }

  async findExchangePosition(pair) {
    const payload = await this.client.listFuturesPositions({ pairs: [pair] });
    const active = extractActiveFuturesPositions(payload);
    return active.find((position) => normalizedPair(position) === normalizedPair(pair)) || null;
  }

  async reconcileCreatedOrder(pair, side, createdAfter) {
    const payload = await this.client.listFuturesOrders({ side });
    return rowsFrom(payload)
      .filter((order) => normalizedPair(order) === normalizedPair(pair))
      .filter((order) => !createdAfter || !orderTimestamp(order) ||
        orderTimestamp(order) >= createdAfter - 5_000)
      .sort((a, b) => orderTimestamp(b) - orderTimestamp(a))[0] || null;
  }

  async containAmbiguousFuturesOrder({ pair, orderId = null, cause }) {
    const containment = { pair, orderId, cancel: null, exitedPosition: null, failures: [] };
    this.blocked = true;
    this.blockReason = {
      code: cause?.code || "FUTURES_ORDER_AMBIGUOUS",
      message: cause?.message || `Uncertain Futures order state for ${pair}`,
    };
    if (orderId && typeof this.client.cancelFuturesOrder === "function") {
      try {
        containment.cancel = await this.client.cancelFuturesOrder(orderId);
      } catch (error) {
        containment.failures.push({ operation: "CANCEL_ORDER", error: error.message, code: error.code });
      }
    }
    try {
      const position = await this.findExchangePosition(pair);
      const positionId = entityId(position);
      if (position && positionId) {
        const exit = await this.client.exitFuturesPosition(positionId);
        await this.client.waitForPositionClosed(positionId);
        containment.exitedPosition = { id: positionId, exit };
      } else if (position) {
        containment.failures.push({
          operation: "EXIT_POSITION",
          error: `Active ${pair} position had no id`,
        });
      }
    } catch (error) {
      containment.failures.push({ operation: "RECONCILE_POSITION", error: error.message, code: error.code });
    }
    this.log("LIVE_ORDER_AMBIGUITY_CONTAINED", { cause: this.blockReason, containment });
    return containment;
  }

  async openPosition(intent) {
    const { pair, instrument } = await this.pairAndInstrument(intent.symbol);
    const maximumLeverage = futuresMaxLeverage(instrument);
    if (maximumLeverage && intent.leverage > maximumLeverage) {
      throw liveError(
        "INSTRUMENT_LEVERAGE_UNAVAILABLE",
        `${pair} supports at most ${maximumLeverage}x leverage.`,
        422,
      );
    }
    const rawQuantity = intent.exposureINR / intent.expectedFillPrice;
    const increment = futuresQuantityIncrement(instrument);
    const quantity = roundQuantityDown(rawQuantity, increment);
    const minimum = futuresMinimumQuantity(instrument);
    if (!(quantity > 0) || (minimum > 0 && quantity < minimum)) {
      throw liveError(
        "FUTURES_ORDER_BELOW_MINIMUM",
        `${pair} order quantity ${quantity} is below its minimum ${minimum || increment}.`,
        422,
        { pair, quantity, minimum: minimum || increment },
      );
    }
    const maximum = futuresMaximumMarketQuantity(instrument);
    if (maximum && quantity > maximum) {
      throw liveError(
        "FUTURES_ORDER_ABOVE_MAXIMUM",
        `${pair} order quantity ${quantity} exceeds its market-order maximum ${maximum}.`,
        422,
        { pair, quantity, maximum },
      );
    }
    const minimumNotionalInr = await this.minimumFuturesNotional(
      intent.symbol,
      intent.expectedFillPrice,
    );
    if (quantity * intent.expectedFillPrice + EPSILON < minimumNotionalInr) {
      throw liveError(
        "FUTURES_ORDER_BELOW_MINIMUM",
        `${pair} order value is below its ₹${money(minimumNotionalInr)} minimum.`,
        422,
        { pair, quantity, minimumNotionalInr },
      );
    }

    if (typeof this.client.updateFuturesLeverage === "function") {
      await this.client.updateFuturesLeverage({ pair, leverage: intent.leverage });
    }
    const createdAfter = this.clock();
    let createdPayload = null;
    let createdOrder = null;
    try {
      createdPayload = await this.client.createFuturesMarketOrder({
        pair,
        side: "buy",
        quantity,
        leverage: intent.leverage,
      });
      createdOrder = firstExchangeOrder(createdPayload);
    } catch (error) {
      if (error.status && error.status < 500) throw error;
      try {
        createdOrder = await this.reconcileCreatedOrder(pair, "buy", createdAfter);
      } catch {
        createdOrder = null;
      }
      if (!createdOrder) {
        const containment = await this.containAmbiguousFuturesOrder({ pair, cause: error });
        throw liveError(
          "FUTURES_CREATE_UNCERTAIN",
          `${pair} create response was ambiguous. New entries are blocked until the live session is stopped.`,
          502,
          { containment },
        );
      }
    }
    let orderId = entityId(createdOrder);
    if (!orderId) {
      try {
        createdOrder = await this.reconcileCreatedOrder(pair, "buy", createdAfter);
      } catch {
        createdOrder = null;
      }
      orderId = entityId(createdOrder);
    }
    if (!orderId) {
      const cause = liveError(
        "FUTURES_ORDER_AMBIGUOUS",
        `${pair} order was submitted without a reconcilable order id.`,
        502,
      );
      const containment = await this.containAmbiguousFuturesOrder({ pair, cause });
      throw liveError(
        "FUTURES_ORDER_AMBIGUOUS",
        `${pair} order was submitted but CoinDCX did not return or reconcile an order id; new entries are blocked.`,
        502,
        { containment },
      );
    }
    let filledOrder;
    try {
      filledOrder = String(createdOrder?.status || "").toLowerCase() === "filled"
        ? createdOrder
        : await this.client.waitForFuturesFill(orderId, "buy");
    } catch (error) {
      const settled = ["cancelled", "canceled", "rejected", "partially_cancelled",
        "partially_canceled"].includes(String(error?.order?.status || "").toLowerCase());
      if (settled) throw error;
      const containment = await this.containAmbiguousFuturesOrder({ pair, orderId, cause: error });
      throw liveError(
        "FUTURES_FILL_UNCERTAIN",
        `${pair} fill could not be proven. The order was contained and new entries are blocked.`,
        502,
        { containment },
      );
    }
    const exchangePosition = await this.findExchangePosition(pair);
    const positionId = entityId(exchangePosition) ||
      filledOrder?.position_id || filledOrder?.positionId || null;
    this.log("LIVE_POSITION_OPENED", {
      intent,
      pair,
      quantity,
      orderId,
      positionId,
      created: createdPayload,
      fill: filledOrder,
    });
    // Make the core engine's derived quantity exactly match the rounded lot
    // accepted by the exchange while retaining the spot-INR accounting unit.
    const accountingFillPrice = futuresFillPriceInr(filledOrder) ||
      intent.exposureINR / quantity;
    return {
      fillPrice: accountingFillPrice,
      quantity,
      pair,
      orderId,
      positionId,
      exchangeFillPrice: futuresFillPrice(filledOrder),
      exchangeOrder: filledOrder,
    };
  }

  async closePosition(position, reason, expectedFillPrice, closeIntent = {}) {
    const pair = position?.execution?.pair ||
      (await this.pairAndInstrument(position.symbol)).pair;
    let exchangePosition = null;
    const knownPositionId = position?.execution?.positionId;
    if (knownPositionId) {
      const payload = await this.client.listFuturesPositions({ positionIds: [knownPositionId] });
      exchangePosition = extractActiveFuturesPositions(payload).find((item) =>
        String(entityId(item)) === String(knownPositionId),
      ) || null;
    }
    if (!exchangePosition) exchangePosition = await this.findExchangePosition(pair);
    if (!exchangePosition) {
      this.log("LIVE_POSITION_ALREADY_FLAT", {
        symbol: position.symbol,
        pair,
        reason,
      });
      return {
        fillPrice: expectedFillPrice,
        pair,
        positionId: knownPositionId || null,
        reconciledAlreadyFlat: true,
      };
    }

    const positionId = entityId(exchangePosition);
    if (!positionId) {
      throw liveError(
        "FUTURES_POSITION_ID_MISSING",
        `CoinDCX returned an active ${pair} position without an id; it was not retried or locally closed.`,
        502,
      );
    }
    const exitPayload = await this.client.exitFuturesPosition(positionId);
    const closedPosition = await this.client.waitForPositionClosed(positionId);
    this.log("LIVE_POSITION_CLOSED", {
      closeIntent,
      pair,
      positionId,
      reason,
      exit: exitPayload,
      closedPosition,
    });
    return {
      fillPrice: expectedFillPrice,
      pair,
      positionId,
      exitResponse: exitPayload,
      exchangePosition: closedPosition,
    };
  }

  async getTickerRows() {
    const snapshot = await this.tickerProvider();
    const rows = Array.isArray(snapshot) ? snapshot : snapshot?.rows;
    if (!Array.isArray(rows)) throw new Error("Ticker provider returned no rows");
    this.lastTickerRows = rows.map(normalizeInrTicker).filter(Boolean);
    return this.lastTickerRows;
  }

  async getQualifiedUniverse() {
    if (this.blocked) {
      this.log("LIVE_ENTRIES_BLOCKED", { reason: this.blockReason });
      return [];
    }
    const result = await this.qualifiedProvider({
      minVolumeINR: this.engine?.config?.minVolumeINR ?? 1_000_000,
      maxPositions: 15,
    });
    const rows = result?.rows || result || [];
    if (!this.activeInstrumentPairs.length) await this.refreshActiveInstruments();
    const supported = [];
    for (const row of rows) {
      const symbol = row?.market || row?.symbol;
      if (mapFuturesPair(symbol, this.activeInstrumentPairs)) {
        supported.push(row);
      } else {
        this.log("LIVE_UNIVERSE_INSTRUMENT_SKIPPED", {
          symbol,
          reason: "NO_ACTIVE_INR_FUTURES_INSTRUMENT",
        });
      }
    }
    return supported;
  }

  async minimumFuturesNotional(symbol, spotPrice) {
    try {
      const { instrument } = await this.pairAndInstrument(symbol);
      const minimum = futuresMinimumQuantity(instrument);
      const increment = futuresQuantityIncrement(instrument);
      const quantityNotionalInr = Math.max(minimum, increment) * positiveNumber(spotPrice);
      const minimumNotional = positiveNumber(instrument.min_notional);
      const marginCurrency = String(instrument.margin_currency_short_name || "").toUpperCase();
      const quoteCurrency = String(
        instrument.quote_currency_short_name || instrument.settle_currency_short_name || "USDT",
      ).toUpperCase();
      const quoteInr = inrPrice(quoteCurrency, normalizeTickerRows(this.lastTickerRows));
      const exchangeMinimumInr = marginCurrency === "INR"
        ? minimumNotional
        : minimumNotional > 0 && quoteInr ? minimumNotional * quoteInr : 0;
      return Math.max(quantityNotionalInr, exchangeMinimumInr);
    } catch (error) {
      this.log("LIVE_MINIMUM_LOOKUP_FAILED", {
        symbol,
        error: { message: error.message, code: error.code },
      });
      // A safe finite value lets the core skip this candidate and continue to
      // the next ranked coin instead of attempting an unvalidated order.
      return Number.MAX_SAFE_INTEGER;
    }
  }

  strategyLogger(entry) {
    this.log("LIVE_STRATEGY_EVENT", { entry });
  }

  async start({ capitalINR, leverage = configuredLiveLeverage(), sessionId = null } = {}) {
    if (this.isRunning()) {
      throw liveError("LIVE_SESSION_ALREADY_RUNNING", "A live session is already running.", 409);
    }
    const capital = positiveNumber(capitalINR);
    if (capital < MIN_LIVE_CAPITAL_INR) {
      throw liveError(
        "INSUFFICIENT_BALANCE",
        `At least ₹${MIN_LIVE_CAPITAL_INR} is required to start live trading.`,
        422,
      );
    }
    if (!(leverage >= 1 && leverage <= MAX_LIVE_LEVERAGE)) {
      throw liveError(
        "INVALID_LIVE_LEVERAGE",
        `Live leverage must be between 1x and ${MAX_LIVE_LEVERAGE}x.`,
        422,
      );
    }
    const lifecycleVersion = ++this.lifecycleVersion;
    this.blocked = false;
    this.blockReason = null;
    await this.refreshActiveInstruments();
    if (lifecycleVersion !== this.lifecycleVersion) {
      throw liveError("LIVE_START_ABORTED", "Live start was interrupted by the kill switch.", 409);
    }
    const config = {
      ...this.configOverrides,
      liveLeverage: leverage,
      startingEquityINR: capital,
    };
    this.engine = new this.Strategy({
      config,
      clock: this.clock,
      universeProvider: () => this.getQualifiedUniverse(),
      tickerProvider: () => this.getTickerRows(),
      minimumOrderProvider: (symbol, price) => this.minimumFuturesNotional(symbol, price),
      execution: {
        openPosition: (intent) => this.openPosition(intent),
        closePosition: (position, reason, price, intent) =>
          this.closePosition(position, reason, price, intent),
      },
      logger: (entry) => this.strategyLogger(entry),
    });
    await this.engine.startSession({
      mode: "live",
      capitalINR: capital,
      sessionId: sessionId || `live-${this.clock()}`,
      now: this.clock(),
    });
    try {
      this.persistRecoveryMarker();
    } catch (error) {
      throw liveError(
        "LIVE_RECOVERY_STATE_FAILED",
        `Live session was not armed because its crash-recovery marker could not be saved: ${error.message}`,
        503,
      );
    }
    if (lifecycleVersion !== this.lifecycleVersion) {
      throw liveError("LIVE_START_ABORTED", "Live start was interrupted by the kill switch.", 409);
    }
    this.running = true;
    this.stopping = false;
    this.startedAt = this.clock();
    this.lastError = null;
    this.lastStopResult = null;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
    await this.tick();
    if (lifecycleVersion !== this.lifecycleVersion) {
      throw liveError("LIVE_START_ABORTED", "Live start was interrupted by the kill switch.", 409);
    }
    return this.status();
  }

  async tick() {
    if (!this.running || this.stopping || !this.engine) return this.status();
    if (this.tickPromise) return this.tickPromise;
    this.tickPromise = (async () => {
      try {
        const result = await this.engine.tick({ now: this.clock() });
        this.lastTickAt = this.clock();
        if (result.status === SESSION_STATE.EXPIRED) {
          const exchange = await this.closeEveryExchangePosition();
          this.lastStopResult = { reason: "SESSION_EXPIRED", exchange, strategy: result };
          const exchangeFlat = Array.isArray(exchange.remaining) &&
            exchange.remaining.length === 0 && exchange.failures.length === 0;
          if (exchangeFlat && this.engine.state.positions.length === 0) {
            this.running = false;
            this.lastError = null;
            this.clearRecoveryState();
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
          } else {
            this.lastError = {
              code: "SESSION_EXPIRY_CLOSE_INCOMPLETE",
              message: "Session expired, but the exchange close-all has not yet verified flat.",
            };
          }
        } else {
          this.lastError = this.blocked ? this.blockReason : null;
        }
        return this.status();
      } catch (error) {
        this.lastError = { message: error.message, code: error.code || "LIVE_TICK_FAILED" };
        this.log("LIVE_TICK_FAILED", { error: this.lastError });
        return this.status();
      } finally {
        this.tickPromise = null;
      }
    })();
    return this.tickPromise;
  }

  async renew() {
    if (!this.running || !this.engine || this.stopping) {
      throw liveError("LIVE_SESSION_NOT_RUNNING", "No live session is running.", 409);
    }
    await this.engine.renewSession({ now: this.clock() });
    this.persistRecoveryMarker();
    return this.status();
  }

  async recoverAfterRestart() {
    if (!this.recoveryPending) return this.status();
    this.stopping = true;
    this.log("LIVE_RESTART_RECOVERY_STARTED", { marker: this.recoveryMarker });
    const exchange = await this.closeEveryExchangePosition();
    const verifiedFlat = Array.isArray(exchange.remaining) &&
      exchange.remaining.length === 0 && exchange.failures.length === 0;
    this.stopping = false;
    this.running = !verifiedFlat;
    this.lastStopResult = { reason: "SERVER_RESTART_RECOVERY", exchange, verifiedFlat };
    if (verifiedFlat) {
      this.clearRecoveryState();
      this.lastError = null;
    } else {
      this.lastError = {
        code: "LIVE_RESTART_RECOVERY_INCOMPLETE",
        message: "A previous live session was found; restart recovery could not verify the account flat.",
      };
    }
    this.log("LIVE_RESTART_RECOVERY_COMPLETE", this.lastStopResult);
    return this.status();
  }

  async closeEveryExchangePosition() {
    const failures = [];
    const closed = [];
    let cancelResponse = null;
    try {
      cancelResponse = await this.client.cancelAllFuturesOrders();
    } catch (error) {
      failures.push({ operation: "CANCEL_ALL", error: error.message, code: error.code });
      this.log("LIVE_KILL_CANCEL_FAILED", { error: failures[failures.length - 1] });
    }

    let positions = [];
    try {
      positions = extractActiveFuturesPositions(await this.client.listFuturesPositions());
    } catch (error) {
      failures.push({ operation: "LIST_POSITIONS", error: error.message, code: error.code });
      return { cancelResponse, closed, failures, remaining: null };
    }
    for (const position of positions) {
      const id = entityId(position);
      const pair = normalizedPair(position);
      if (!id) {
        failures.push({ operation: "EXIT", pair, error: "Active position has no id" });
        continue;
      }
      try {
        const exitResponse = await this.client.exitFuturesPosition(id);
        await this.client.waitForPositionClosed(id);
        closed.push({ id, pair, exitResponse });
      } catch (error) {
        failures.push({ operation: "EXIT", id, pair, error: error.message, code: error.code });
      }
    }

    let remaining = null;
    try {
      remaining = extractActiveFuturesPositions(await this.client.listFuturesPositions());
      if (remaining.length) {
        failures.push({
          operation: "VERIFY_FLAT",
          error: `${remaining.length} active INR Futures position(s) remain`,
          positions: remaining.map((position) => ({
            id: entityId(position),
            pair: normalizedPair(position),
            amount: positionAmount(position),
          })),
        });
      }
    } catch (error) {
      failures.push({ operation: "VERIFY_FLAT", error: error.message, code: error.code });
    }
    return { cancelResponse, closed, failures, remaining };
  }

  async stop() {
    if (this.killPromise) return this.killPromise;
    this.killPromise = (async () => {
      this.lifecycleVersion += 1;
      this.stopping = true;
      this.running = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      const activeTick = this.tickPromise;
      if (activeTick) {
        try {
          await activeTick;
        } catch {
          // tick() records its own failure; continue with exchange-wide close.
        }
      }
      const initialExchange = await this.closeEveryExchangePosition();
      let strategy = null;
      if (this.engine) {
        try {
          strategy = await this.engine.endSession({
            now: this.clock(),
            reason: "LIVE_KILL_SWITCH",
          });
        } catch (error) {
          initialExchange.failures.push({
            operation: "LOCAL_RECONCILE",
            error: error.message,
            code: error.code,
          });
        }
      }
      // A second sweep catches a late fill that raced the first cancel/list.
      const finalExchange = await this.closeEveryExchangePosition();
      const verifiedFlat = Array.isArray(finalExchange.remaining) &&
        finalExchange.remaining.length === 0 && finalExchange.failures.length === 0;
      this.stopping = false;
      this.running = !verifiedFlat;
      this.lastStopResult = {
        exchange: { initial: initialExchange, final: finalExchange },
        strategy,
        verifiedFlat,
      };
      this.lastError = !verifiedFlat
        ? { code: "LIVE_STOP_INCOMPLETE", message: "Kill switch could not verify every position closed." }
        : null;
      if (verifiedFlat) {
        this.blocked = false;
        this.blockReason = null;
        this.clearRecoveryState();
      }
      this.log("LIVE_KILL_SWITCH_COMPLETE", this.lastStopResult);
      return this.status();
    })().finally(() => {
      this.killPromise = null;
    });
    return this.killPromise;
  }

  status(now = this.clock()) {
    const strategy = this.engine?.status(now) || null;
    return {
      ...(strategy || {}),
      status: this.running || this.stopping || this.recoveryPending
        ? strategy?.status === SESSION_STATE.EXPIRED
          ? SESSION_STATE.EXPIRED
          : SESSION_STATE.RUNNING
        : strategy?.status || SESSION_STATE.IDLE,
      running: this.running,
      stopping: this.stopping,
      mode: "live",
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      renewalWarning: Boolean(strategy?.renewalWarningSent),
      renewalWarningMessage: strategy?.renewalWarningSent ? "10 min remaining — renew?" : null,
      strategy,
      positions: this.engine?.state?.positions || [],
      closedTrades: this.engine?.state?.closedTrades?.slice(-50) || [],
      log: this.engine?.state?.log?.slice(-100) || [],
      blocked: this.blocked,
      blockReason: this.blockReason,
      recoveryPending: this.recoveryPending,
      recoveryMarker: this.recoveryMarker,
      lastStopResult: this.lastStopResult,
    };
  }
}

class SessionMomentumLiveService {
  constructor({
    client = new CoinDcxLiveClient(),
    runtime = null,
    clock = Date.now,
    env = process.env,
    gateTtlMs = GATE_TTL_MS,
    minimumCapitalInr = MIN_LIVE_CAPITAL_INR,
    tickerProvider = fetchTickerSnapshot,
    marketDetailsProvider = null,
  } = {}) {
    this.client = client;
    this.clock = clock;
    this.env = env;
    this.gateTtlMs = gateTtlMs;
    this.minimumCapitalInr = minimumCapitalInr;
    this.tickerProvider = tickerProvider;
    this.marketDetailsProvider = marketDetailsProvider ||
      (() => this.client.publicGet("/exchange/v1/markets_details"));
    this.runtime = runtime || new SessionMomentumLiveRuntime({ client, clock });
    this.gates = new Map();
    this.startPromise = null;
    this.stopPromise = null;
    this.lifecycleVersion = 0;
  }

  assertLifecycle(version) {
    if (version === this.lifecycleVersion) return;
    throw liveError(
      "LIVE_START_ABORTED_BY_KILL_SWITCH",
      "The kill switch interrupted live-session startup. No further entry action was sent.",
      409,
      { restartGate: true },
    );
  }

  cleanupGates() {
    const now = this.clock();
    for (const [id, gate] of this.gates) {
      if (gate.expiresAt <= now) this.gates.delete(id);
    }
  }

  requireGate(gateId, allowedStates = null) {
    this.cleanupGates();
    const id = String(gateId || "").trim();
    const gate = this.gates.get(id);
    if (!gate) {
      throw liveError(
        "LIVE_GATE_EXPIRED",
        "The live-trading confirmation expired. Start again from Step 1.",
        410,
        { restartGate: true },
      );
    }
    if (allowedStates && !allowedStates.includes(gate.state)) {
      throw liveError(
        "LIVE_GATE_STEP_INVALID",
        "The live-trading confirmations must be completed in order.",
        409,
        { expected: allowedStates, actual: gate.state },
      );
    }
    return gate;
  }

  touchGate(gate) {
    gate.expiresAt = this.clock() + this.gateTtlMs;
    return gate;
  }

  async tickerRows() {
    const payload = await this.tickerProvider();
    return Array.isArray(payload) ? payload : payload?.rows || [];
  }

  async accountSnapshot() {
    const [balancePayload, tickerRows, futuresWalletPayload] = await Promise.all([
      this.client.balances(),
      this.tickerRows(),
      typeof this.client.futuresWallets === "function"
        ? this.client.futuresWallets()
        : Promise.resolve([]),
    ]);
    return {
      account: buildAccountView(balancePayload, tickerRows, futuresWalletPayload),
      balancePayload,
      tickerRows,
      futuresWalletPayload,
    };
  }

  async waitForFuturesCredit(expectedInr, { timeoutMs = 20_000, pollMs = 500 } = {}) {
    if (typeof this.client.futuresWallets !== "function") {
      return { availableInr: expectedInr, verified: false };
    }
    const deadline = Date.now() + timeoutMs;
    let lastAvailable = 0;
    while (Date.now() < deadline) {
      const payload = await this.client.futuresWallets();
      const wallet = normalizeFuturesWallets(payload, [])
        .find((item) => item.currency === "INR");
      lastAvailable = wallet?.available || 0;
      if (lastAvailable + 0.01 >= expectedInr) {
        return { availableInr: lastAvailable, verified: true, wallet };
      }
      await delay(pollMs);
    }
    throw liveError(
      "FUTURES_TRANSFER_NOT_CREDITED",
      "The INR transfer was sent, but the Futures wallet credit could not be verified. Start again from Step 1 after checking CoinDCX.",
      502,
      { expectedInr, availableInr: lastAvailable, restartGate: true },
    );
  }

  async preflight() {
    if (!this.client.hasCredentials?.()) {
      throw liveError(
        "MISSING_CREDENTIALS",
        "CoinDCX API key and secret are not configured.",
        503,
      );
    }
    const snapshot = await this.accountSnapshot();
    const gateId = crypto.randomUUID();
    const now = this.clock();
    const gate = {
      id: gateId,
      createdAt: now,
      expiresAt: now + this.gateTtlMs,
      state: "PREFLIGHT",
      account: snapshot.account,
      tickerRows: snapshot.tickerRows,
      choice: null,
      conversionPlan: null,
    };
    this.gates.set(gateId, gate);
    return {
      gateId,
      expiresAt: gate.expiresAt,
      account: gate.account,
      config: publicConfig(this.env),
    };
  }

  async prepare({ gateId, convertToInr } = {}) {
    const gate = this.requireGate(gateId, ["PREFLIGHT", "PREPARED", "CONVERSION_PREPARED"]);
    if (typeof convertToInr !== "boolean") {
      throw liveError("INVALID_CONVERSION_CHOICE", "convertToInr must be true or false.");
    }
    gate.choice = convertToInr ? "CONVERT_TO_INR" : "USE_EXISTING_INR";
    gate.conversionPlan = null;

    if (!convertToInr) {
      if (gate.account.inrAvailable < this.minimumCapitalInr) {
        throw liveError(
          "INSUFFICIENT_BALANCE",
          `Existing INR balance is below ₹${this.minimumCapitalInr}.`,
          422,
          { availableInr: gate.account.inrAvailable },
        );
      }
      gate.state = "PREPARED";
      this.touchGate(gate);
      return {
        gateId: gate.id,
        expiresAt: gate.expiresAt,
        convertToInr: false,
        account: gate.account,
        availableCapitalInr: gate.account.inrAvailable,
      };
    }

    let details = [];
    try {
      details = await this.marketDetailsProvider();
    } catch (error) {
      this.client.log?.("CONVERSION_MARKET_DETAILS_FAILED", {
        error: { message: error.message, code: error.code },
      });
    }
    const plan = buildConversionPlan(gate.account, gate.tickerRows, details);
    if (plan.unavailable.length) {
      throw liveError(
        "HOLDINGS_NOT_FULLY_CONVERTIBLE",
        "Every available non-INR holding must have a sellable direct INR market before conversion can continue.",
        422,
        { unavailable: plan.unavailable },
      );
    }
    if (!plan.sells.length && gate.account.inrAvailable < this.minimumCapitalInr) {
      throw liveError(
        "NO_CONVERTIBLE_HOLDINGS",
        `No convertible holdings can raise the required ₹${this.minimumCapitalInr}.`,
        422,
      );
    }
    if (plan.estimatedInrAfterConversion < this.minimumCapitalInr) {
      throw liveError(
        "INSUFFICIENT_BALANCE",
        `Estimated INR after conversion is below ₹${this.minimumCapitalInr}.`,
        422,
        { estimatedInrAfterConversion: plan.estimatedInrAfterConversion },
      );
    }
    gate.conversionPlan = plan;
    gate.state = "CONVERSION_PREPARED";
    this.touchGate(gate);
    return {
      gateId: gate.id,
      expiresAt: gate.expiresAt,
      convertToInr: true,
      conversionPlan: plan,
      account: gate.account,
    };
  }

  async approveConversion({ gateId } = {}) {
    const gate = this.requireGate(gateId, ["CONVERSION_PREPARED"]);
    if (gate.choice !== "CONVERT_TO_INR" || !gate.conversionPlan) {
      throw liveError("CONVERSION_PLAN_MISSING", "Prepare a conversion plan first.", 409);
    }
    gate.state = "CONVERSION_APPROVED";
    gate.conversionApprovedAt = this.clock();
    this.touchGate(gate);
    return {
      gateId: gate.id,
      expiresAt: gate.expiresAt,
      approved: true,
      conversionPlan: gate.conversionPlan,
    };
  }

  assertFinalServerGate(gate, confirmation) {
    if (confirmation !== "LIVE") {
      throw liveError(
        "LIVE_CONFIRMATION_REQUIRED",
        'Type "LIVE" exactly to start real-money trading.',
        422,
      );
    }
    if (String(this.env.LIVE_TRADING_ENABLED ?? "") !== "true") {
      throw liveError(
        "LIVE_TRADING_DISABLED",
        "LIVE_TRADING_ENABLED=true is required in .env before live trading can start.",
        503,
        { restartGate: true },
      );
    }
    if (!this.client.hasCredentials?.()) {
      throw liveError(
        "MISSING_CREDENTIALS",
        "Valid CoinDCX API key and secret are required.",
        503,
        { restartGate: true },
      );
    }
    if (this.runtime.isRunning()) {
      throw liveError(
        "LIVE_SESSION_ALREADY_RUNNING",
        "A live session is already running.",
        409,
        { restartGate: true },
      );
    }
    if (gate.choice === "CONVERT_TO_INR" && gate.state !== "CONVERSION_APPROVED") {
      throw liveError(
        "CONVERSION_NOT_APPROVED",
        "The planned sells must be approved before final confirmation.",
        409,
      );
    }
    if (gate.choice === "USE_EXISTING_INR" && gate.state !== "PREPARED") {
      throw liveError("LIVE_GATE_STEP_INVALID", "Complete the balance choice first.", 409);
    }
    return configuredLiveLeverage(this.env);
  }

  async assertNoExchangePositions() {
    const active = extractActiveFuturesPositions(await this.client.listFuturesPositions());
    if (active.length) {
      throw liveError(
        "ACTIVE_FUTURES_POSITION_EXISTS",
        "An active INR-margined CoinDCX Futures position already exists. Close it before starting.",
        409,
        {
          restartGate: true,
          positions: active.map((position) => ({
            id: entityId(position),
            pair: normalizedPair(position),
            amount: positionAmount(position),
          })),
        },
      );
    }
  }

  validateApprovedBalances(gate, currentAccount) {
    if (gate.choice === "USE_EXISTING_INR") {
      if (Math.abs(currentAccount.inrAvailable - gate.account.inrAvailable) > 0.01) {
        throw liveError(
          "BALANCE_CHANGED",
          "The available INR balance changed after confirmation. Start the live gate again.",
          409,
          { restartGate: true },
        );
      }
      return;
    }
    const byCurrency = new Map(
      currentAccount.holdings.map((holding) => [holding.currency, holding]),
    );
    const approvedCurrencies = new Set(gate.conversionPlan.sells.map((sell) => sell.currency));
    const changed = gate.conversionPlan.sells.filter((sell) => {
      const current = byCurrency.get(sell.currency)?.available || 0;
      return Math.abs(current - sell.availableQuantity) > Math.max(EPSILON, sell.quantityIncrement / 2);
    });
    const added = currentAccount.nonInrHoldings.filter((holding) =>
      holding.available > EPSILON && !approvedCurrencies.has(holding.currency),
    );
    if (Math.abs(currentAccount.inrAvailable - gate.account.inrAvailable) > 0.01) {
      changed.push({ currency: "INR" });
    }
    changed.push(...added);
    if (changed.length) {
      throw liveError(
        "BALANCE_CHANGED",
        "A holding balance changed after approval. Start the live gate again for a fresh quote.",
        409,
        {
          restartGate: true,
          currencies: changed.map((sell) => sell.currency),
        },
      );
    }
  }

  async executeApprovedConversion(gate, assertContinue = () => {}) {
    const fills = [];
    for (let index = 0; index < gate.conversionPlan.sells.length; index += 1) {
      assertContinue();
      const sell = gate.conversionPlan.sells[index];
      const clientOrderId = `sm-${gate.id.slice(0, 12)}-${index}`;
      try {
        const createdPayload = await this.client.createSpotMarketSell({
          market: sell.market,
          quantity: sell.sellQuantity,
          clientOrderId,
        });
        const createdOrder = firstExchangeOrder(createdPayload);
        const id = entityId(createdOrder);
        if (!id && String(createdOrder?.status || "").toLowerCase() !== "filled") {
          throw liveError(
            "SPOT_ORDER_AMBIGUOUS",
            `${sell.market} sell was submitted but no order id was returned; no retry was sent.`,
            502,
          );
        }
        const fill = String(createdOrder?.status || "").toLowerCase() === "filled"
          ? createdOrder
          : await this.client.waitForSpotFill({ id, clientOrderId });
        const result = {
          currency: sell.currency,
          market: sell.market,
          quantity: sell.sellQuantity,
          orderId: id || entityId(fill),
          fill,
        };
        fills.push(result);
        this.client.log?.("CONVERSION_SELL_FILLED", result);
        assertContinue();
      } catch (error) {
        this.client.log?.("CONVERSION_STOPPED", {
          failedMarket: sell.market,
          fills,
          error: { message: error.message, code: error.code },
        });
        throw liveError(
          "CONVERSION_FILL_FAILED",
          `${sell.market} conversion failed; no further sells or live orders were sent. Start again from Step 1.`,
          502,
          {
            restartGate: true,
            filled: fills.map((fill) => ({
              currency: fill.currency,
              market: fill.market,
              orderId: fill.orderId,
            })),
            cause: error.message,
          },
        );
      }
    }
    return fills;
  }

  async start({ gateId, confirmation } = {}) {
    if (this.startPromise || this.stopPromise) {
      throw liveError("LIVE_START_IN_PROGRESS", "A live-session start is already in progress.", 409);
    }
    const gate = this.requireGate(gateId, ["PREPARED", "CONVERSION_APPROVED"]);
    const lifecycleVersion = ++this.lifecycleVersion;
    const assertContinue = () => this.assertLifecycle(lifecycleVersion);
    const startPromise = (async () => {
      let realActionStarted = false;
      try {
        const leverage = this.assertFinalServerGate(gate, confirmation);
        gate.state = "STARTING";
        await this.assertNoExchangePositions();
        assertContinue();
        if (typeof this.runtime.refreshActiveInstruments === "function") {
          await this.runtime.refreshActiveInstruments();
          assertContinue();
        }
        const before = await this.accountSnapshot();
        assertContinue();
        this.validateApprovedBalances(gate, before.account);
        const projectedCapital = gate.choice === "CONVERT_TO_INR"
          ? gate.conversionPlan.estimatedInrAfterConversion
          : before.account.inrAvailable;
        if (projectedCapital < this.minimumCapitalInr) {
          throw liveError(
            "INSUFFICIENT_BALANCE",
            `At least ₹${this.minimumCapitalInr} available INR is required.`,
            422,
            { availableInr: before.account.inrAvailable, projectedCapital },
          );
        }

        let conversionFills = [];
        if (gate.choice === "CONVERT_TO_INR") {
          realActionStarted = gate.conversionPlan.sells.length > 0;
          conversionFills = await this.executeApprovedConversion(gate, assertContinue);
        }
        const after = gate.choice === "CONVERT_TO_INR"
          ? await this.accountSnapshot()
          : before;
        assertContinue();
        const availableInr = after.account.inrAvailable;
        if (availableInr < this.minimumCapitalInr) {
          throw liveError(
            "INSUFFICIENT_BALANCE_AFTER_CONVERSION",
            `Available INR after conversion is below ₹${this.minimumCapitalInr}; live trading was not started.`,
            422,
            { availableInr, restartGate: true },
          );
        }
        const transferAmount = Math.floor(
          (after.account.spotInrAvailable + Number.EPSILON) * 100,
        ) / 100;
        const existingFuturesInr = after.account.futuresInrAvailable || 0;
        let transfer = null;
        if (transferAmount > 0) {
          realActionStarted = true;
          transfer = await this.client.transferToFutures(transferAmount, "INR");
          assertContinue();
        }
        const expectedFuturesInr = existingFuturesInr + transferAmount;
        const credit = await this.waitForFuturesCredit(expectedFuturesInr);
        assertContinue();
        const liveCapitalInr = credit.availableInr;
        if (liveCapitalInr < this.minimumCapitalInr) {
          throw liveError(
            "INSUFFICIENT_FUTURES_BALANCE",
            `The verified Futures wallet balance is below ₹${this.minimumCapitalInr}.`,
            422,
            { availableInr: liveCapitalInr, restartGate: true },
          );
        }
        const runtime = await this.runtime.start({
          capitalINR: liveCapitalInr,
          leverage,
          sessionId: `live-${gate.id}`,
        });
        assertContinue();
        this.gates.delete(gate.id);
        return {
          started: true,
          capitalInr: liveCapitalInr,
          leverage,
          conversionFills,
          transfer,
          transferCredit: credit,
          runtime,
        };
      } catch (error) {
        if (confirmation === "LIVE" || realActionStarted || error?.details?.restartGate ||
            [
              "LIVE_TRADING_DISABLED",
              "MISSING_CREDENTIALS",
              "ACTIVE_FUTURES_POSITION_EXISTS",
            ].includes(error.code)) {
          this.gates.delete(gate.id);
          if (!error.details) error.details = {};
          error.details.restartGate = true;
        } else if (this.gates.has(gate.id)) {
          gate.state = gate.choice === "CONVERT_TO_INR"
            ? "CONVERSION_APPROVED"
            : "PREPARED";
        }
        throw error;
      }
    })();
    this.startPromise = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.startPromise === startPromise) this.startPromise = null;
    }
  }

  renew() {
    return this.runtime.renew();
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.lifecycleVersion += 1;
    const pendingStart = this.startPromise;
    this.stopPromise = (async () => {
      // Sweep immediately, then again after any interrupted startup has
      // unwound. This fences conversion/transfer/runtime-start races.
      await this.runtime.stop();
      if (pendingStart) {
        try {
          await pendingStart;
        } catch {
          // The generation check is expected to abort the start.
        }
      }
      return this.runtime.stop();
    })();
    try {
      return await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  status() {
    return this.runtime.status();
  }

  recoverAfterRestart() {
    return this.runtime.recoverAfterRestart();
  }
}

const liveService = new SessionMomentumLiveService();

module.exports = {
  GATE_TTL_MS,
  MIN_LIVE_CAPITAL_INR,
  MAX_LIVE_LEVERAGE,
  SPOT_FEE_PCT,
  SELL_TDS_PCT,
  LIVE_RECOVERY_STATE_FILE,
  SessionMomentumLiveRuntime,
  SessionMomentumLiveService,
  buildAccountView,
  buildConversionPlan,
  configuredLiveLeverage,
  extractActiveFuturesPositions,
  isActiveFuturesPosition,
  normalizeActiveInstruments,
  normalizeBalances,
  publicConfig,
  liveService,
  preflight: (...args) => liveService.preflight(...args),
  prepare: (...args) => liveService.prepare(...args),
  approveConversion: (...args) => liveService.approveConversion(...args),
  start: (...args) => liveService.start(...args),
  renew: (...args) => liveService.renew(...args),
  stop: (...args) => liveService.stop(...args),
  status: (...args) => liveService.status(...args),
  recoverAfterRestart: (...args) => liveService.recoverAfterRestart(...args),
};
