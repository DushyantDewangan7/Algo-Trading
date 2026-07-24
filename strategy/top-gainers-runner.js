"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  fetchJsonWithBackoff,
  fetchQualifiedGainers,
  fetchTickerSnapshot,
  normalizeInrTicker,
} = require("./top-gainers");
const {
  openPosition,
  updatePosition,
  realizePnL,
  isCooldownActive,
} = require("./trailing-stop");

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DETAILS_URL = "https://api.coindcx.com/exchange/v1/markets_details";
const DETAILS_CACHE_MS = DAY_MS;
const STATE_FILE = path.join(__dirname, "..", "top-gainers-state.json");

function envNumber(name, fallback, { min = 0 } = {}) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function envBoolean(name, fallback = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function getConfig() {
  return {
    enabled: envBoolean("TOP_GAINERS_ENABLED", false),
    minVolumeINR: envNumber("TOP_GAINERS_MIN_VOLUME_INR", 1_000_000),
    maxPositions: Math.max(1, Math.floor(envNumber("TOP_GAINERS_MAX_POSITIONS", 15, { min: 1 }))),
    trailPct: envNumber("TOP_GAINERS_TRAIL_PCT", 2, { min: 0.01 }),
    tpPct: envNumber("TOP_GAINERS_TAKE_PROFIT_PCT", 50, { min: 0.01 }),
    cooldownHours: envNumber("TOP_GAINERS_COOLDOWN_HOURS", 24, { min: 0 }),
    rescanHours: envNumber("TOP_GAINERS_RESCAN_HOURS", 4, { min: 0.01 }),
    stopCheckMinutes: envNumber("TOP_GAINERS_STOP_CHECK_MINUTES", 5, { min: 0.01 }),
    cashReservePct: envNumber("TOP_GAINERS_CASH_RESERVE_PCT", 10, { min: 0 }),
    startingEquityINR: envNumber(
      "TOP_GAINERS_EQUITY_INR",
      envNumber("PAPER_EQUITY_INR", 100_000, { min: 1 }),
      { min: 1 },
    ),
  };
}

function defaultState(config = getConfig()) {
  return {
    equity: config.startingEquityINR,
    cash: config.startingEquityINR,
    positions: [],
    cooldowns: {},
    closedTrades: [],
    lastRescan: null,
    lastStopCheck: null,
    log: [],
  };
}

function normalizedState(parsed, config = getConfig()) {
  const fallback = defaultState(config);
  if (!parsed || typeof parsed !== "object") return fallback;
  return {
    equity: Number.isFinite(Number(parsed.equity)) ? Number(parsed.equity) : fallback.equity,
    cash: Number.isFinite(Number(parsed.cash)) ? Number(parsed.cash) : fallback.cash,
    positions: Array.isArray(parsed.positions) ? parsed.positions : [],
    cooldowns: parsed.cooldowns && typeof parsed.cooldowns === "object" ? parsed.cooldowns : {},
    closedTrades: Array.isArray(parsed.closedTrades) ? parsed.closedTrades.slice(-500) : [],
    lastRescan: Number(parsed.lastRescan) || null,
    lastStopCheck: Number(parsed.lastStopCheck) || null,
    log: Array.isArray(parsed.log) ? parsed.log.slice(-500) : [],
  };
}

class TopGainersRunner {
  constructor({ stateFile = STATE_FILE } = {}) {
    this.stateFile = stateFile;
    this.config = getConfig();
    this.enabled = false;
    this.stopTimer = null;
    this.rescanTimer = null;
    this.stopCheckPromise = null;
    this.rescanPromise = null;
    this.detailsCache = { rows: null, fetchedAt: 0 };
    this.state = this.loadState();
  }

  loadState() {
    try {
      return normalizedState(JSON.parse(fs.readFileSync(this.stateFile, "utf8")), this.config);
    } catch {
      return defaultState(this.config);
    }
  }

  saveState() {
    this.state.log = this.state.log.slice(-500);
    this.state.closedTrades = this.state.closedTrades.slice(-500);
    const temp = `${this.stateFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2));
    fs.renameSync(temp, this.stateFile);
  }

  addLog(type, message, data = null, timestamp = Date.now()) {
    const entry = { timestamp, type, message };
    if (data !== null) entry.data = data;
    this.state.log.push(entry);
    this.state.log = this.state.log.slice(-500);
    console.log(`[top-gainers] ${new Date(timestamp).toISOString()} ${type}: ${message}`);
    return entry;
  }

  async getMarketDetails() {
    if (this.detailsCache.rows && Date.now() - this.detailsCache.fetchedAt < DETAILS_CACHE_MS) {
      return this.detailsCache.rows;
    }
    try {
      const rows = await fetchJsonWithBackoff(DETAILS_URL);
      this.detailsCache = { rows, fetchedAt: Date.now() };
      return rows;
    } catch (error) {
      if (this.detailsCache.rows) {
        this.addLog("WARN", `Using stale market details: ${error.message}`);
        return this.detailsCache.rows;
      }
      this.addLog("WARN", `Market details unavailable; using safe ₹100 minimum: ${error.message}`);
      return [];
    }
  }

  minOrderNotional(details, symbol, price) {
    const row = details.find((item) =>
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

  updateEquity(tickers = new Map()) {
    let positionsValue = 0;
    for (const position of this.state.positions) {
      const mark = tickers.get(position.symbol)?.lastPrice || position.currentPrice || position.entryPrice;
      position.currentPrice = mark;
      positionsValue += position.qty * mark;
    }
    this.state.equity = this.state.cash + positionsValue;
    return this.state.equity;
  }

  closePosition(position, exitPrice, reason, timestamp = Date.now()) {
    const pnl = realizePnL(position, exitPrice);
    this.state.cash += pnl.netProceeds;
    this.state.positions = this.state.positions.filter((item) => item !== position);
    this.state.cooldowns[position.symbol] = timestamp + this.config.cooldownHours * HOUR_MS;
    const trade = {
      symbol: position.symbol,
      entryTime: position.entryTime,
      exitTime: timestamp,
      entryPrice: position.entryPrice,
      exitPrice,
      qty: position.qty,
      reason,
      ...pnl,
    };
    this.state.closedTrades.push(trade);
    this.addLog(
      "SELL",
      `${position.symbol} at ₹${exitPrice.toFixed(8)} (${reason}), net ₹${pnl.netPnL.toFixed(2)}, R=${pnl.netR.toFixed(2)}`,
      trade,
      timestamp,
    );
    return trade;
  }

  async stopCheck() {
    if (this.stopCheckPromise) return this.stopCheckPromise;
    this.stopCheckPromise = (async () => {
      const timestamp = Date.now();
      try {
        const snapshot = await fetchTickerSnapshot();
        const tickers = new Map(
          snapshot.rows.map(normalizeInrTicker).filter(Boolean).map((row) => [row.market, row]),
        );
        for (const position of [...this.state.positions]) {
          const ticker = tickers.get(position.symbol);
          if (!ticker) {
            this.addLog("WARN", `No ticker available for open position ${position.symbol}`);
            continue;
          }
          const previousStop = position.stopPrice;
          const decision = updatePosition(position, ticker.lastPrice, timestamp);
          if (position.stopPrice > previousStop) {
            this.addLog(
              "STOP_RAISED",
              `${position.symbol} stop ₹${previousStop.toFixed(8)} → ₹${position.stopPrice.toFixed(8)}`,
              { symbol: position.symbol, previousStop, stopPrice: position.stopPrice },
              timestamp,
            );
          }
          if (decision.action === "SELL") {
            this.closePosition(position, ticker.lastPrice, decision.reason, timestamp);
          }
        }
        this.updateEquity(tickers);
        this.state.lastStopCheck = timestamp;
        this.saveState();
        return { checked: this.state.positions.length, timestamp };
      } catch (error) {
        this.state.lastStopCheck = timestamp;
        this.addLog("ERROR", `Stop check failed safely: ${error.message}`, null, timestamp);
        this.saveState();
        return { checked: 0, timestamp, error: error.message };
      } finally {
        this.stopCheckPromise = null;
      }
    })();
    return this.stopCheckPromise;
  }

  async rescan() {
    if (this.rescanPromise) return this.rescanPromise;
    this.rescanPromise = (async () => {
      await this.stopCheck();
      const timestamp = Date.now();
      try {
        const qualified = await fetchQualifiedGainers({
          minVolumeINR: this.config.minVolumeINR,
          maxPositions: this.config.maxPositions,
        });
        this.addLog(
          "UNIVERSE",
          `${qualified.rows.length} qualified: ${qualified.rows.map((row) => `${row.rank}.${row.market}`).join(", ") || "none"}`,
          qualified,
          timestamp,
        );
        const details = await this.getMarketDetails();
        const held = new Set(this.state.positions.map((position) => position.symbol));
        const equity = this.updateEquity(new Map(qualified.rows.map((row) => [row.market, row])));
        const sizeINR = (equity * (1 - this.config.cashReservePct / 100)) / this.config.maxPositions;

        for (const row of qualified.rows) {
          if (this.state.positions.length >= this.config.maxPositions) break;
          if (held.has(row.market)) continue;
          if (isCooldownActive(this.state.cooldowns, row.market, timestamp)) {
            this.addLog("COOLDOWN", `${row.market} skipped until ${new Date(this.state.cooldowns[row.market]).toISOString()}`);
            continue;
          }
          const minimum = this.minOrderNotional(details, row.market, row.lastPrice);
          if (sizeINR < minimum) {
            this.addLog("SKIP", `${row.market} slot ₹${sizeINR.toFixed(2)} is below market minimum ₹${minimum.toFixed(2)}`);
            continue;
          }
          if (this.state.cash < sizeINR) {
            this.addLog("SKIP", `${row.market} skipped: ₹${this.state.cash.toFixed(2)} cash is below ₹${sizeINR.toFixed(2)} slot`);
            continue;
          }
          const position = openPosition({
            symbol: row.market,
            price: row.lastPrice,
            sizeINR,
            timestamp,
            trailPct: this.config.trailPct,
            tpPct: this.config.tpPct,
          });
          position.entryDailyVolumeINR = row.volumeINR;
          position.entryRank = row.rank;
          this.state.cash -= sizeINR;
          this.state.positions.push(position);
          held.add(row.market);
          this.addLog(
            "BUY",
            `${row.market} at ₹${row.lastPrice.toFixed(8)}, slot ₹${sizeINR.toFixed(2)}, stop ₹${position.stopPrice.toFixed(8)}, TP ₹${position.takeProfitPrice.toFixed(8)}`,
            position,
            timestamp,
          );
        }
        this.state.lastRescan = timestamp;
        this.updateEquity(new Map(qualified.rows.map((row) => [row.market, row])));
        this.saveState();
        return qualified;
      } catch (error) {
        this.state.lastRescan = timestamp;
        this.addLog("ERROR", `Rescan failed safely: ${error.message}`, null, timestamp);
        this.saveState();
        return { rows: [], metadata: null, error: error.message };
      } finally {
        this.rescanPromise = null;
      }
    })();
    return this.rescanPromise;
  }

  start() {
    if (this.enabled) return this.status();
    this.config = getConfig();
    this.enabled = true;
    this.addLog("START", "Paper runner enabled");
    this.saveState();
    this.stopTimer = setInterval(() => void this.stopCheck(), this.config.stopCheckMinutes * MINUTE_MS);
    this.rescanTimer = setInterval(() => void this.rescan(), this.config.rescanHours * HOUR_MS);
    this.stopTimer.unref?.();
    this.rescanTimer.unref?.();
    void this.rescan();
    return this.status();
  }

  stop() {
    if (this.stopTimer) clearInterval(this.stopTimer);
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    this.stopTimer = null;
    this.rescanTimer = null;
    if (this.enabled) {
      this.enabled = false;
      this.addLog("STOP", "Paper runner disabled; open paper positions are preserved");
      this.saveState();
    }
    return this.status();
  }

  status(now = Date.now()) {
    const realizedToday = this.state.closedTrades
      .filter((trade) => new Date(trade.exitTime).toDateString() === new Date(now).toDateString())
      .reduce((sum, trade) => sum + (Number(trade.netPnL) || 0), 0);
    return {
      enabled: this.enabled,
      equity: this.state.equity,
      cash: this.state.cash,
      positionCount: this.state.positions.length,
      realizedPnlToday: realizedToday,
      lastRescan: this.state.lastRescan,
      lastStopCheck: this.state.lastStopCheck,
      nextRescan: this.enabled ? (this.state.lastRescan || now) + this.config.rescanHours * HOUR_MS : null,
      nextStopCheck: this.enabled ? (this.state.lastStopCheck || now) + this.config.stopCheckMinutes * MINUTE_MS : null,
      config: this.config,
    };
  }

  async positionsView(now = Date.now()) {
    let tickers = new Map();
    try {
      const snapshot = await fetchTickerSnapshot();
      tickers = new Map(snapshot.rows.map(normalizeInrTicker).filter(Boolean).map((row) => [row.market, row]));
    } catch (error) {
      this.addLog("WARN", `Position marks are stale: ${error.message}`);
    }
    this.updateEquity(tickers);
    return this.state.positions.map((position) => {
      const current = tickers.get(position.symbol)?.lastPrice || position.currentPrice || position.entryPrice;
      return {
        symbol: position.symbol,
        entry: position.entryPrice,
        current,
        highest: position.highestPrice,
        stop: position.stopPrice,
        tp: position.takeProfitPrice,
        qty: position.qty,
        sizeINR: position.sizeINR,
        unrealizedPct: (current / position.entryPrice - 1) * 100,
        distanceToStopPct: ((current - position.stopPrice) / current) * 100,
        distanceToTpPct: ((position.takeProfitPrice - current) / current) * 100,
        timeHeldHours: (now - position.entryTime) / HOUR_MS,
        entryTime: position.entryTime,
      };
    });
  }

  log(limit = 200) {
    return this.state.log.slice(-Math.min(Math.max(Number(limit) || 200, 1), 500));
  }

  reset() {
    const wasEnabled = this.enabled;
    this.state = defaultState(this.config);
    this.addLog("WARNING", "DEV RESET: top-gainers paper state was wiped");
    this.saveState();
    if (wasEnabled) void this.rescan();
    return this.status();
  }
}

const runner = new TopGainersRunner();

module.exports = {
  TopGainersRunner,
  runner,
  getConfig,
  defaultState,
  STATE_FILE,
  start: () => runner.start(),
  stop: () => runner.stop(),
  status: () => runner.status(),
  reset: () => runner.reset(),
};
