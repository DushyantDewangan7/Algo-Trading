"use strict";

const {
  fetchJsonWithBackoff,
  fetchQualifiedGainers,
  fetchTickerSnapshot,
  normalizeInrTicker,
} = require("./top-gainers");
const { isCooldownActive } = require("./trailing-stop");
const bigCoins = require("./big-coins");
const {
  DEFAULT_FEE_PCT,
  DEFAULT_TDS_PCT,
  DEFAULT_LIQUIDATION_MARGIN_LOSS_PCT,
  MAX_LEVERAGE,
  normalizeLeverage,
  calculateSlippagePct,
  entryPriceWithSlippage,
  exitPriceWithSlippage,
  createLeveragedPosition,
  positionEquity,
  liquidationStatus,
  settleLeveragedPosition,
} = require("./leverage-sim");

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DETAILS_URL = "https://api.coindcx.com/exchange/v1/markets_details";
const DETAILS_CACHE_MS = 24 * HOUR_MS;

const SESSION_STATE = Object.freeze({
  IDLE: "IDLE",
  RUNNING: "RUNNING",
  EXPIRED: "EXPIRED",
});
const SESSION_STATES = SESSION_STATE;

let marketDetailsCache = { rows: null, fetchedAt: 0 };

function envNumber(name, fallback, { min = 0, max = Infinity } = {}) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function getConfig(overrides = {}) {
  const base = {
    sessionMinutes: envNumber("SESSION_MINUTES", 60, { min: 0.01 }),
    scanMinutes: envNumber("SCAN_MINUTES", 1, { min: 0.01 }),
    trailPct: envNumber("TRAIL_PCT", 6, { min: 0.01, max: 99.99 }),
    maxPositions: Math.max(1, Math.floor(envNumber("MAX_POSITIONS", 2, { min: 1 }))),
    smallCoinMaxHoldHours: envNumber("SMALL_COIN_MAX_HOLD_HOURS", 24, { min: 0.01 }),
    cooldownMinutes: envNumber("SESSION_COOLDOWN_MINUTES", 30, { min: 0 }),
    paperLeverage: envNumber("PAPER_LEVERAGE", 5, { min: 1, max: MAX_LEVERAGE }),
    liveLeverage: envNumber("LIVE_LEVERAGE", 3, { min: 1, max: MAX_LEVERAGE }),
    minVolumeINR: envNumber("TOP_GAINERS_MIN_VOLUME_INR", 1_000_000, { min: 0 }),
    universeLimit: 15,
    startingEquityINR: envNumber(
      "SESSION_EQUITY_INR",
      envNumber("PAPER_EQUITY_INR", 100, { min: 0.01 }),
      { min: 0.01 },
    ),
    feePct: DEFAULT_FEE_PCT,
    tdsPct: DEFAULT_TDS_PCT,
    liquidationMarginLossPct: DEFAULT_LIQUIDATION_MARGIN_LOSS_PCT,
  };
  const merged = { ...base, ...overrides };
  merged.sessionMinutes = Math.max(0.01, Number(merged.sessionMinutes) || base.sessionMinutes);
  merged.scanMinutes = Math.max(0.01, Number(merged.scanMinutes) || base.scanMinutes);
  merged.trailPct = Math.min(99.99, Math.max(0.01, Number(merged.trailPct) || base.trailPct));
  merged.maxPositions = Math.max(1, Math.floor(Number(merged.maxPositions) || base.maxPositions));
  merged.smallCoinMaxHoldHours = Math.max(
    0.01,
    Number(merged.smallCoinMaxHoldHours) || base.smallCoinMaxHoldHours,
  );
  merged.cooldownMinutes = Math.max(0, Number(merged.cooldownMinutes) || 0);
  merged.paperLeverage = normalizeLeverage(merged.paperLeverage, { max: MAX_LEVERAGE });
  merged.liveLeverage = normalizeLeverage(merged.liveLeverage, { max: MAX_LEVERAGE });
  merged.minVolumeINR = Math.max(0, Number(merged.minVolumeINR) || 0);
  merged.universeLimit = Math.max(1, Math.min(15, Math.floor(Number(merged.universeLimit) || 15)));
  merged.startingEquityINR = Math.max(
    0.01,
    Number(merged.startingEquityINR) || base.startingEquityINR,
  );
  merged.feePct = Math.max(0, Number(merged.feePct) || 0);
  merged.tdsPct = Math.max(0, Number(merged.tdsPct) || 0);
  merged.liquidationMarginLossPct = Math.min(
    100,
    Math.max(0.01, Number(merged.liquidationMarginLossPct) || 90),
  );
  return merged;
}

function defaultState(config = getConfig()) {
  return {
    status: SESSION_STATE.IDLE,
    mode: "paper",
    sessionId: null,
    sessionStartedAt: null,
    expiresAt: null,
    expiredAt: null,
    renewalCount: 0,
    renewalWarningSent: false,
    lastScanAt: null,
    nextScanAt: null,
    cashINR: config.startingEquityINR,
    equityINR: config.startingEquityINR,
    marginUsedINR: 0,
    positions: [],
    cooldowns: {},
    closedTrades: [],
    sessionsRun: 0,
    positionsOpened: 0,
    liquidations: 0,
    log: [],
  };
}

function normalizeState(state, config = getConfig()) {
  const fallback = defaultState(config);
  if (!state || typeof state !== "object") return fallback;
  const status = Object.values(SESSION_STATE).includes(state.status) ? state.status : fallback.status;
  return {
    ...fallback,
    ...state,
    status,
    mode: state.mode === "live" ? "live" : "paper",
    cashINR: Number.isFinite(Number(state.cashINR)) ? Number(state.cashINR) : fallback.cashINR,
    equityINR: Number.isFinite(Number(state.equityINR)) ? Number(state.equityINR) : fallback.equityINR,
    marginUsedINR: Number.isFinite(Number(state.marginUsedINR))
      ? Number(state.marginUsedINR)
      : fallback.marginUsedINR,
    positions: Array.isArray(state.positions) ? state.positions : [],
    cooldowns: state.cooldowns && typeof state.cooldowns === "object" ? state.cooldowns : {},
    closedTrades: Array.isArray(state.closedTrades) ? state.closedTrades.slice(-500) : [],
    log: Array.isArray(state.log) ? state.log.slice(-500) : [],
  };
}

function normalizedQuote(row, fallbackSymbol = "") {
  if (Number.isFinite(Number(row))) {
    return { symbol: String(fallbackSymbol).toUpperCase(), lastPrice: Number(row), volumeINR: 0 };
  }
  const symbol = String(row?.market || row?.symbol || fallbackSymbol || "").trim().toUpperCase();
  const lastPrice = Number(row?.lastPrice ?? row?.price ?? row?.currentPrice ?? row?.last_price);
  const volumeINR = Number(row?.volumeINR ?? row?.dailyVolumeINR ?? row?.volume_inr) || 0;
  if (!symbol || !(lastPrice > 0)) return null;
  return { ...row, symbol, market: symbol, lastPrice, volumeINR };
}

function quoteMap(source) {
  const result = new Map();
  if (!source) return result;
  if (source instanceof Map) {
    for (const [symbol, row] of source) {
      const normalized = normalizedQuote(row, symbol);
      if (normalized) result.set(normalized.symbol, normalized);
    }
    return result;
  }
  const rows = Array.isArray(source) ? source : Array.isArray(source.rows) ? source.rows : null;
  if (rows) {
    for (const row of rows) {
      const normalized = normalizedQuote(row);
      if (normalized) result.set(normalized.symbol, normalized);
    }
    return result;
  }
  if (typeof source === "object") {
    for (const [symbol, row] of Object.entries(source)) {
      const normalized = normalizedQuote(row, symbol);
      if (normalized) result.set(normalized.symbol, normalized);
    }
  }
  return result;
}

function normalizeUniverse(source) {
  const rows = Array.isArray(source) ? source : Array.isArray(source?.rows) ? source.rows : [];
  return rows
    .map((row, index) => {
      const quote = normalizedQuote(row);
      if (!quote) return null;
      return {
        ...quote,
        rank: Number(row.rank) > 0 ? Number(row.rank) : index + 1,
        change24h: Number(row.change24h ?? row.change_24_hour) || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || b.change24h - a.change24h)
    .slice(0, 15);
}

async function defaultTickerProvider() {
  const snapshot = await fetchTickerSnapshot();
  return snapshot.rows.map(normalizeInrTicker).filter(Boolean);
}

async function defaultMinimumOrderProvider(symbol, price) {
  if (!marketDetailsCache.rows || Date.now() - marketDetailsCache.fetchedAt >= DETAILS_CACHE_MS) {
    try {
      marketDetailsCache = {
        rows: await fetchJsonWithBackoff(DETAILS_URL),
        fetchedAt: Date.now(),
      };
    } catch {
      if (!marketDetailsCache.rows) return 100;
    }
  }
  const row = marketDetailsCache.rows.find((item) =>
    String(item.coindcx_name || item.symbol || "").toUpperCase() === String(symbol).toUpperCase(),
  );
  if (!row) return 100;
  for (const key of ["min_notional", "minimum_notional", "min_order_value", "minimum_order_value"]) {
    const value = Number(row[key]);
    if (value > 0) return value;
  }
  for (const key of ["min_quantity", "minimum_quantity", "min_order_size", "minimum_order_size"]) {
    const value = Number(row[key]);
    if (value > 0) return value * price;
  }
  return 100;
}

function paperExecutionAdapter() {
  return {
    async openPosition(intent) {
      return { fillPrice: intent.expectedFillPrice, simulated: true };
    },
    async closePosition(_position, _reason, price) {
      return { fillPrice: price, simulated: true };
    },
  };
}

function timestampOptions(value) {
  if (Number.isFinite(Number(value))) return { now: Number(value) };
  if (!value || typeof value !== "object") return {};
  if (value.now === undefined && Number.isFinite(Number(value.timestamp))) {
    return { ...value, now: Number(value.timestamp) };
  }
  return value;
}

class SessionMomentum {
  constructor(options = {}) {
    this.config = getConfig(options.config);
    this.clock = typeof options.clock === "function" ? options.clock : Date.now;
    this.universeProvider = options.universeProvider || options.getUniverse || (() => fetchQualifiedGainers({
      minVolumeINR: this.config.minVolumeINR,
      maxPositions: this.config.universeLimit,
    }));
    this.tickerProvider = options.tickerProvider || options.getPrices || defaultTickerProvider;
    this.minimumOrderProvider = options.minimumOrderProvider || options.getMinimumOrder ||
      options.getMinOrder || defaultMinimumOrderProvider;
    this.bigCoins = options.bigCoins || bigCoins;
    this.isBigCoin = options.isBigCoin || ((symbol) => {
      if (this.bigCoins instanceof Set) return this.bigCoins.has(bigCoins.baseSymbol(symbol));
      return Boolean(this.bigCoins.isBigCoin?.(symbol));
    });
    const defaults = paperExecutionAdapter();
    this.execution = options.execution || {
      openPosition: options.openPosition || defaults.openPosition,
      closePosition: options.closePosition || defaults.closePosition,
    };
    if (typeof this.execution.openPosition !== "function" ||
        typeof this.execution.closePosition !== "function") {
      throw new TypeError("execution must provide openPosition() and closePosition() hooks");
    }
    this.stateStore = options.stateStore || null;
    this.logger = typeof options.logger === "function" ? options.logger : null;
    this.state = normalizeState(options.state, this.config);
    this.tickPromise = null;
    this.sequence = 0;
    this.updateEquity();
  }

  get positions() {
    return this.state.positions;
  }

  get sessionState() {
    return this.state.status;
  }

  addLog(type, message, data = null, timestamp = this.clock()) {
    const entry = { timestamp: Number(timestamp), type, message };
    if (data !== null) entry.data = data;
    this.state.log.push(entry);
    this.state.log = this.state.log.slice(-500);
    this.logger?.(entry);
    return entry;
  }

  async persist() {
    if (typeof this.stateStore?.save !== "function") return;
    await this.stateStore.save(this.state);
  }

  leverageForMode() {
    return this.state.mode === "live" ? this.config.liveLeverage : this.config.paperLeverage;
  }

  updateEquity(quotes = new Map()) {
    let marginUsedINR = 0;
    let openPositionEquity = 0;
    for (const position of this.state.positions) {
      const mark = quotes.get(position.symbol)?.lastPrice ||
        position.currentPrice || position.entryPrice;
      position.currentPrice = mark;
      marginUsedINR += Number(position.marginUsedINR ?? position.marginINR) || 0;
      openPositionEquity += positionEquity(position, mark);
    }
    this.state.marginUsedINR = marginUsedINR;
    this.state.equityINR = this.state.cashINR + openPositionEquity;
    return this.state.equityINR;
  }

  status(now = this.clock()) {
    const timestamp = Number(now);
    return {
      status: this.state.status,
      mode: this.state.mode,
      sessionId: this.state.sessionId,
      sessionStartedAt: this.state.sessionStartedAt,
      expiresAt: this.state.expiresAt,
      expiredAt: this.state.expiredAt,
      remainingMs: this.state.status === SESSION_STATE.RUNNING && this.state.expiresAt
        ? Math.max(0, this.state.expiresAt - timestamp)
        : 0,
      renewalCount: this.state.renewalCount,
      renewalWarningSent: this.state.renewalWarningSent,
      lastScanAt: this.state.lastScanAt,
      nextScanAt: this.state.nextScanAt,
      cashINR: this.state.cashINR,
      cash: this.state.cashINR,
      equityINR: this.state.equityINR,
      equity: this.state.equityINR,
      marginUsedINR: this.state.marginUsedINR,
      positionCount: this.state.positions.length,
      positionsOpened: this.state.positionsOpened,
      sessionsRun: this.state.sessionsRun,
      liquidations: this.state.liquidations,
      config: { ...this.config, leverage: this.leverageForMode() },
    };
  }

  async startSession(value = {}) {
    const options = typeof value === "string" ? { mode: value } : timestampOptions(value);
    const now = Number(options.now ?? this.clock());
    if (this.state.status === SESSION_STATE.RUNNING) return this.status(now);
    if (this.state.positions.length) {
      const error = new Error("Cannot start a session while positions from an expired session remain open");
      error.code = "OPEN_POSITIONS_REMAIN";
      throw error;
    }
    if (options.mode && !["paper", "live"].includes(options.mode)) {
      throw new TypeError("mode must be paper or live");
    }
    if (options.capitalINR !== undefined) {
      const capital = Number(options.capitalINR);
      if (!Number.isFinite(capital) || capital <= 0) {
        throw new TypeError("capitalINR must be a positive number");
      }
      this.state.cashINR = capital;
      this.state.equityINR = capital;
    }
    this.state.mode = options.mode || this.state.mode || "paper";
    try {
      await this.bigCoins.fetchTopMarketCap?.();
    } catch (error) {
      this.addLog("WARN", `Big-coin refresh failed; using fallback: ${error.message}`, null, now);
    }
    this.state.status = SESSION_STATE.RUNNING;
    this.state.sessionId = options.sessionId || `session-${now}-${++this.sequence}`;
    this.state.sessionStartedAt = now;
    this.state.expiresAt = now + this.config.sessionMinutes * MINUTE_MS;
    this.state.expiredAt = null;
    this.state.renewalCount = 0;
    this.state.renewalWarningSent = false;
    this.state.lastScanAt = null;
    this.state.nextScanAt = now;
    this.state.sessionsRun += 1;
    this.addLog(
      "SESSION_STARTED",
      `${this.state.mode} session started; expires ${new Date(this.state.expiresAt).toISOString()}`,
      { sessionId: this.state.sessionId, expiresAt: this.state.expiresAt },
      now,
    );
    this.updateEquity();
    await this.persist();
    return this.status(now);
  }

  async renewSession(value = {}) {
    const options = timestampOptions(value);
    const now = Number(options.now ?? this.clock());
    if (this.state.status !== SESSION_STATE.RUNNING) {
      const error = new Error("Only a running session can be renewed");
      error.code = "SESSION_NOT_RUNNING";
      throw error;
    }
    this.state.sessionStartedAt = now;
    this.state.expiresAt = now + this.config.sessionMinutes * MINUTE_MS;
    this.state.renewalCount += 1;
    this.state.renewalWarningSent = false;
    this.addLog(
      "SESSION_RENEWED",
      `Session renewed until ${new Date(this.state.expiresAt).toISOString()}`,
      { expiresAt: this.state.expiresAt, renewalCount: this.state.renewalCount },
      now,
    );
    await this.persist();
    return this.status(now);
  }

  async quotesFor(source, now) {
    if (source) return quoteMap(source);
    try {
      return quoteMap(await this.tickerProvider());
    } catch (error) {
      this.addLog("ERROR", `Ticker refresh failed safely: ${error.message}`, null, now);
      return quoteMap(this.state.positions.map((position) => ({
        symbol: position.symbol,
        lastPrice: position.currentPrice || position.entryPrice,
        volumeINR: position.entryDailyVolumeINR || 0,
      })));
    }
  }

  async closePosition(position, reason, referencePrice, dailyVolumeINR, now) {
    const slippage = exitPriceWithSlippage(
      referencePrice,
      position.exposureINR || position.sizeINR,
      dailyVolumeINR || position.entryDailyVolumeINR || 0,
    );
    let executionResult;
    try {
      const closeIntent = Object.freeze({
        symbol: position.symbol,
        side: "sell",
        orderType: "market",
        mode: this.state.mode,
        reason,
        referencePrice,
        expectedFillPrice: slippage.fillPrice,
        slippagePct: slippage.slippagePct,
        qty: position.qty,
        marginINR: position.marginINR,
        leverage: position.leverage,
        exposureINR: position.exposureINR,
        timestamp: now,
      });
      executionResult = await this.execution.closePosition(
        Object.freeze({ ...position }),
        reason,
        slippage.fillPrice,
        closeIntent,
      );
      const fillPrice = Number(executionResult?.fillPrice ?? slippage.fillPrice);
      if (!(fillPrice > 0)) throw new Error("close execution returned an invalid fill price");
      const trade = settleLeveragedPosition(position, fillPrice, {
        timestamp: now,
        reason,
        feePct: this.config.feePct,
        tdsPct: this.config.tdsPct,
        rawExitPrice: referencePrice,
        exitSlippagePct: slippage.slippagePct,
      });
      if (executionResult && typeof executionResult === "object") {
        trade.execution = { ...executionResult };
      }
      this.state.cashINR += trade.netProceeds;
      this.state.positions = this.state.positions.filter((item) => item !== position);
      this.state.cooldowns[position.symbol] = now + this.config.cooldownMinutes * MINUTE_MS;
      this.state.closedTrades.push(trade);
      this.state.closedTrades = this.state.closedTrades.slice(-500);
      if (reason === "LIQUIDATION") this.state.liquidations += 1;
      this.addLog(
        reason,
        `${position.symbol} closed at ₹${fillPrice.toFixed(8)}; net ₹${trade.netPnL.toFixed(2)}`,
        trade,
        now,
      );
      return { trade, error: null };
    } catch (error) {
      position.closePendingReason = reason;
      position.lastCloseError = error.message;
      position.lastCloseAttemptAt = now;
      this.addLog(
        "CLOSE_FAILED",
        `${position.symbol} ${reason} close failed; position remains tracked: ${error.message}`,
        { symbol: position.symbol, reason },
        now,
      );
      return { trade: null, error };
    }
  }

  async closeAll(reason, quotes, now) {
    const closed = [];
    const failures = [];
    for (const position of [...this.state.positions]) {
      const quote = quotes.get(position.symbol);
      const price = quote?.lastPrice || position.currentPrice || position.entryPrice;
      const result = await this.closePosition(position, reason, price, quote?.volumeINR, now);
      if (result.trade) closed.push(result.trade);
      if (result.error) failures.push({ symbol: position.symbol, error: result.error.message });
    }
    return { closed, failures };
  }

  async endSession(value = {}) {
    const options = timestampOptions(value);
    const now = Number(options.now ?? this.clock());
    if (this.state.status === SESSION_STATE.IDLE && this.state.positions.length === 0) {
      return { ...this.status(now), closed: [], failures: [] };
    }
    const reason = options.reason || "SESSION_ENDED";
    const quotes = await this.quotesFor(options.tickers || options.prices, now);
    const result = await this.closeAll(reason, quotes, now);
    this.state.status = result.failures.length ? SESSION_STATE.EXPIRED : SESSION_STATE.IDLE;
    this.state.expiredAt = result.failures.length ? now : null;
    this.state.expiresAt = null;
    this.state.nextScanAt = null;
    this.addLog(
      reason,
      result.failures.length
        ? `Session ended with ${result.failures.length} close failure(s)`
        : `Session ended; ${result.closed.length} position(s) closed`,
      result,
      now,
    );
    this.updateEquity(quotes);
    await this.persist();
    return { ...this.status(now), ...result };
  }

  async managePositions(quotes, now) {
    const closed = [];
    const failures = [];
    for (const position of [...this.state.positions]) {
      const quote = quotes.get(position.symbol);
      if (!quote) {
        this.addLog("WARN", `No price available for ${position.symbol}`, null, now);
        continue;
      }
      const price = quote.lastPrice;
      position.currentPrice = price;
      position.updatedAt = now;

      const liquidation = liquidationStatus(
        position,
        price,
        this.config.liquidationMarginLossPct,
      );
      if (liquidation.liquidated) {
        const result = await this.closePosition(
          position,
          "LIQUIDATION",
          price,
          quote.volumeINR,
          now,
        );
        if (result.trade) closed.push(result.trade);
        if (result.error) failures.push(result.error);
        continue;
      }

      position.isBigCoin = Boolean(this.isBigCoin(position.symbol));
      if (!position.isBigCoin &&
          now - position.entryTime >= this.config.smallCoinMaxHoldHours * HOUR_MS) {
        const result = await this.closePosition(
          position,
          "MAX_HOLD_EXPIRED",
          price,
          quote.volumeINR,
          now,
        );
        if (result.trade) closed.push(result.trade);
        if (result.error) failures.push(result.error);
        continue;
      }

      const previousStop = position.stopPrice;
      if (price > position.highestPrice) {
        position.highestPrice = price;
        position.stopPrice = Math.max(
          previousStop,
          price * (1 - this.config.trailPct / 100),
        );
      }
      if (position.stopPrice > previousStop) {
        this.addLog(
          "STOP_RAISED",
          `${position.symbol} stop ₹${previousStop.toFixed(8)} → ₹${position.stopPrice.toFixed(8)}`,
          { symbol: position.symbol, previousStop, stopPrice: position.stopPrice },
          now,
        );
      }
      if (price <= position.stopPrice) {
        const result = await this.closePosition(
          position,
          "STOP_HIT",
          price,
          quote.volumeINR,
          now,
        );
        if (result.trade) closed.push(result.trade);
        if (result.error) failures.push(result.error);
      }
    }
    return { closed, failures };
  }

  async scanEntries(source, now) {
    const rows = normalizeUniverse(source);
    const opened = [];
    const skipped = [];
    const attempted = new Set();

    while (this.state.cashINR > 0 && this.state.positions.length < this.config.maxPositions) {
      const remainingSlots = this.config.maxPositions - this.state.positions.length;
      const sizeINR = this.state.cashINR / remainingSlots;
      const held = new Set(this.state.positions.map((position) => position.symbol));
      let openedThisPass = false;

      for (const row of rows) {
        const symbol = row.symbol;
        if (attempted.has(symbol) || held.has(symbol)) continue;
        attempted.add(symbol);
        if (isCooldownActive(this.state.cooldowns, symbol, now)) {
          skipped.push({ symbol, reason: "COOLDOWN" });
          this.addLog(
            "COOLDOWN",
            `${symbol} blocked until ${new Date(this.state.cooldowns[symbol]).toISOString()}`,
            null,
            now,
          );
          continue;
        }

        let minimum;
        try {
          minimum = Number(await this.minimumOrderProvider(symbol, row.lastPrice));
        } catch (error) {
          minimum = 100;
          this.addLog("WARN", `${symbol} minimum-order lookup failed: ${error.message}`, null, now);
        }
        const leverage = this.leverageForMode();
        const exposureINR = sizeINR * leverage;
        if (Number.isFinite(minimum) && minimum > 0 && exposureINR < minimum) {
          skipped.push({ symbol, reason: "BELOW_MINIMUM", minimum, sizeINR, exposureINR });
          this.addLog(
            "SKIP",
            `${symbol} exposure ₹${exposureINR.toFixed(2)} is below minimum ₹${minimum.toFixed(2)}`,
            null,
            now,
          );
          continue;
        }

        const entrySlippage = entryPriceWithSlippage(
          row.lastPrice,
          exposureINR,
          row.volumeINR,
        );
        const intent = Object.freeze({
          symbol,
          side: "buy",
          orderType: "market",
          mode: this.state.mode,
          referencePrice: row.lastPrice,
          expectedFillPrice: entrySlippage.fillPrice,
          slippagePct: entrySlippage.slippagePct,
          marginINR: sizeINR,
          leverage,
          exposureINR,
          dailyVolumeINR: row.volumeINR,
          timestamp: now,
        });

        let executionResult;
        try {
          executionResult = await this.execution.openPosition(intent);
          const fillPrice = Number(executionResult?.fillPrice ?? intent.expectedFillPrice);
          if (!(fillPrice > 0)) throw new Error("open execution returned an invalid fill price");
          const position = createLeveragedPosition({
            symbol,
            entryPrice: fillPrice,
            rawEntryPrice: row.lastPrice,
            sizeINR,
            leverage,
            timestamp: now,
            trailPct: this.config.trailPct,
            feePct: this.config.feePct,
            liquidationMarginLossPct: this.config.liquidationMarginLossPct,
            entrySlippagePct: entrySlippage.slippagePct,
            quantity: executionResult?.quantity,
          });
          position.id = `${this.state.sessionId}-${++this.sequence}`;
          position.entryRank = row.rank;
          position.entryDailyVolumeINR = row.volumeINR;
          position.isBigCoin = Boolean(this.isBigCoin(symbol));
          if (executionResult && typeof executionResult === "object") {
            position.execution = { ...executionResult };
          }
          this.state.cashINR -= sizeINR;
          this.state.positions.push(position);
          this.state.positionsOpened += 1;
          opened.push(position);
          this.addLog(
            "BUY",
            `${symbol} at ₹${fillPrice.toFixed(8)}, margin ₹${sizeINR.toFixed(2)}, ${leverage}x, stop ₹${position.stopPrice.toFixed(8)}`,
            position,
            now,
          );
          openedThisPass = true;
          break;
        } catch (error) {
          skipped.push({ symbol, reason: "OPEN_FAILED", error: error.message });
          this.addLog(
            "OPEN_FAILED",
            `${symbol} open failed before state commit: ${error.message}`,
            { symbol },
            now,
          );
          return { opened, skipped, error };
        }
      }
      if (!openedThisPass) break;
    }
    return { opened, skipped, error: null };
  }

  async tick(value = {}) {
    if (this.tickPromise) return this.tickPromise;
    const options = timestampOptions(value);
    this.tickPromise = this.runTick(options).finally(() => {
      this.tickPromise = null;
    });
    return this.tickPromise;
  }

  async runTick(options) {
    const now = Number(options.now ?? this.clock());
    if (this.state.status === SESSION_STATE.IDLE) return this.status(now);
    try {
      await this.bigCoins.fetchTopMarketCap?.();
    } catch (error) {
      this.addLog("WARN", `Big-coin refresh failed; retaining current list: ${error.message}`, null, now);
    }
    const quotes = await this.quotesFor(options.tickers || options.prices, now);

    if (this.state.status === SESSION_STATE.EXPIRED) {
      const retry = await this.closeAll("SESSION_EXPIRED", quotes, now);
      this.updateEquity(quotes);
      await this.persist();
      return { ...this.status(now), closed: retry.closed, failures: retry.failures };
    }

    if (now >= this.state.expiresAt) {
      this.state.status = SESSION_STATE.EXPIRED;
      this.state.expiredAt = now;
      const result = await this.closeAll("SESSION_EXPIRED", quotes, now);
      this.state.nextScanAt = null;
      this.addLog(
        "SESSION_EXPIRED",
        `Session expired; ${result.closed.length} position(s) closed`,
        result,
        now,
      );
      this.updateEquity(quotes);
      await this.persist();
      return { ...this.status(now), closed: result.closed, failures: result.failures };
    }

    const warningAt = this.state.expiresAt - 10 * MINUTE_MS;
    if (!this.state.renewalWarningSent && now >= warningAt) {
      this.state.renewalWarningSent = true;
      this.addLog(
        "SESSION_RENEWAL_WARNING",
        "10 min remaining — renew?",
        { expiresAt: this.state.expiresAt },
        now,
      );
    }

    const managed = await this.managePositions(quotes, now);
    let scanned = { opened: [], skipped: [], error: null };
    if (now >= (this.state.nextScanAt ?? now)) {
      try {
        const universe = options.universe || await this.universeProvider();
        scanned = await this.scanEntries(universe, now);
      } catch (error) {
        scanned.error = error;
        this.addLog("ERROR", `Session scan failed safely: ${error.message}`, null, now);
      }
      this.state.lastScanAt = now;
      this.state.nextScanAt = now + this.config.scanMinutes * MINUTE_MS;
    }
    this.updateEquity(quotes);
    await this.persist();
    return {
      ...this.status(now),
      opened: scanned.opened,
      closed: managed.closed,
      failures: managed.failures,
      skipped: scanned.skipped,
    };
  }
}

const strategy = new SessionMomentum();

module.exports = {
  SESSION_STATE,
  SESSION_STATES,
  MINUTE_MS,
  HOUR_MS,
  getConfig,
  defaultState,
  normalizeState,
  normalizeUniverse,
  quoteMap,
  paperExecutionAdapter,
  SessionMomentum,
  strategy,
  startSession: (...args) => strategy.startSession(...args),
  renewSession: (...args) => strategy.renewSession(...args),
  endSession: (...args) => strategy.endSession(...args),
  tick: (...args) => strategy.tick(...args),
  status: (...args) => strategy.status(...args),
};
