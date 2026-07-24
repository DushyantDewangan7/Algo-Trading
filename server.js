const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const momentum = require("./strategy/momentum");
const risk = require("./strategy/risk");
const regimeModule = require("./strategy/regime");
const crossSectional = require("./strategy/cross-sectional");
const { runBacktest, fetchHistoricalCandles, INTERVAL_MS } = require("./strategy/backtest");
const { runTopGainersBacktest, buildBuyAndHold } = require("./strategy/top-gainers-backtest");
const { fetchQualifiedGainers } = require("./strategy/top-gainers");
const { runner: topGainersRunner } = require("./strategy/top-gainers-runner");
const {
  SessionMomentum,
  MINUTE_MS: SESSION_MINUTE_MS,
} = require("./strategy/session-momentum");
const { runSessionMomentumBacktest } = require("./strategy/session-momentum-backtest");
const { liveService: sessionMomentumLiveService } = require("./strategy/session-momentum-live");
const bigCoins = require("./strategy/big-coins");
const { saveSignal, saveTrade } = require("./database");

const PORT = Number(process.env.PORT) || 4000;
const PUBLIC_DIR = path.join(__dirname, "public");
const COST_BASIS_FILE = path.join(__dirname, "portfolio-cost-basis.json");
const COINDCX_API = "https://api.coindcx.com";
const CACHE_TTL_MS = 900;
const DETAILS_TTL_MS = 60 * 60 * 1000;
const ACCOUNT_CACHE_TTL_MS = 5_000;
const MORPHO_STRATEGY = {
  targetAsset: "MORPHO",
  sourceAssets: ["USDT", "SHIB", "SUSHI"],
  targetSellInr: 40,
  preferredLeverage: 10,
  fallbackLeverage: 5,
  stopLossPercent: -1,
  takeProfitPercent: 3,
  orderType: "market",
};

// CoinDCX candle pairs for INR markets use the I- prefix (I-BTC_INR). Other
// spellings (B-BTC_INR, BTCINR) are resolved via markets_details at runtime.
const WATCHLIST = (process.env.WATCHLIST || "I-BTC_INR,I-ETH_INR,I-SOL_INR,I-BNB_INR,I-XRP_INR")
  .split(",")
  .map((symbol) => symbol.trim())
  .filter(Boolean);
const SIGNAL_INTERVAL = process.env.SIGNAL_INTERVAL || "4h";
const PAPER_STATE_FILE = path.join(__dirname, "paper-trading.json");
const SESSION_MOMENTUM_STATE_FILE = path.join(__dirname, "session-momentum-state.json");
const PAPER_STARTING_EQUITY_INR = Number(process.env.PAPER_EQUITY_INR) || 100_000;
const MIN_PAPER_ORDER_INR = 100;
const CROSS_SECTIONAL_LOOKBACK_DAYS =
  Number(process.env.CROSS_SECTIONAL_LOOKBACK_DAYS) || crossSectional.DEFAULT_LOOKBACK_DAYS;
const CROSS_SECTIONAL_TOP_N = Number(process.env.CROSS_SECTIONAL_TOP_N) || crossSectional.DEFAULT_TOP_N;
const REGIME_CACHE_TTL_MS = 5 * 60 * 1000; // BTC daily regime barely moves within a session
const BACKTEST_LOG_FILE = path.join(__dirname, "backtest-results", "last-run.log");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

let tickerCache = { data: null, fetchedAt: 0 };
let detailsCache = { data: null, fetchedAt: 0 };
let accountCache = { data: null, fetchedAt: 0 };
let pendingMarketRequest = null;
let pendingAccountRequest = null;
const candleCache = new Map(); // `${symbol}|${interval}` → { candles, expiresAt }
let paperState = null;
let regimeCache = { data: null, fetchedAt: 0 };
const backtestStreamClients = new Set();
let backtestRunState = { running: false, strategy: null, lines: [], startedAt: null };

function loadSessionMomentumState() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_MOMENTUM_STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

const paperSessionMomentum = new SessionMomentum({
  state: loadSessionMomentumState(),
  stateStore: {
    save(state) {
      const temporary = `${SESSION_MOMENTUM_STATE_FILE}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
      fs.renameSync(temporary, SESSION_MOMENTUM_STATE_FILE);
    },
  },
  logger(entry) {
    console.log(
      `[session-momentum:paper] ${new Date(entry.timestamp).toISOString()} ${entry.type}: ${entry.message}`,
    );
  },
});

const paperSessionTimer = setInterval(
  () => void paperSessionMomentum.tick(),
  paperSessionMomentum.config.scanMinutes * SESSION_MINUTE_MS,
);
paperSessionTimer.unref?.();

const bigCoinRefreshTimer = setInterval(
  () => void bigCoins.fetchTopMarketCap({ force: true }),
  bigCoins.CACHE_TTL_MS,
);
bigCoinRefreshTimer.unref?.();
void bigCoins.fetchTopMarketCap();

let liveSessionService = sessionMomentumLiveService;
if (liveSessionService.status().recoveryPending) {
  void liveSessionService.recoverAfterRestart().catch((error) => {
    console.error(`[session-momentum:live] Restart recovery failed safely: ${error.message}`);
  });
}

function sessionPositionView(position) {
  const currentPrice = Number(position.currentPrice) || Number(position.entryPrice);
  const grossPnl = (currentPrice - Number(position.entryPrice)) * Number(position.qty || 0);
  return {
    id: position.id,
    symbol: position.symbol,
    entryPrice: position.entryPrice,
    currentPrice,
    highestPrice: position.highestPrice,
    stopPrice: position.stopPrice,
    marginINR: position.marginINR,
    exposureINR: position.exposureINR,
    leverage: position.leverage,
    qty: position.qty,
    entryTime: position.entryTime,
    isBigCoin: Boolean(position.isBigCoin),
    unrealizedPnlINR: grossPnl,
    unrealizedPct: Number(position.marginINR) > 0
      ? (grossPnl / Number(position.marginINR)) * 100
      : null,
    execution: position.execution || null,
    closePendingReason: position.closePendingReason || null,
    lastCloseError: position.lastCloseError || null,
  };
}

async function sessionMomentumPayload() {
  const now = Date.now();
  const quotes = await paperSessionMomentum.quotesFor(null, now);
  paperSessionMomentum.updateEquity(quotes);
  const paper = {
    ...paperSessionMomentum.status(now),
    positions: paperSessionMomentum.state.positions.map(sessionPositionView),
    closedTrades: paperSessionMomentum.state.closedTrades.slice(-50),
    log: paperSessionMomentum.state.log.slice(-100),
  };
  const liveStatus = liveSessionService
    ? await Promise.resolve(liveSessionService.status())
    : { status: "IDLE", mode: "live", positions: [], log: [] };
  const live = {
    ...liveStatus,
    positions: Array.isArray(liveStatus.positions)
      ? liveStatus.positions.map(sessionPositionView)
      : [],
  };
  return {
    paper,
    live,
    config: {
      sessionMinutes: paperSessionMomentum.config.sessionMinutes,
      scanMinutes: paperSessionMomentum.config.scanMinutes,
      trailPct: paperSessionMomentum.config.trailPct,
      maxPositions: paperSessionMomentum.config.maxPositions,
      smallCoinMaxHoldHours: paperSessionMomentum.config.smallCoinMaxHoldHours,
      cooldownMinutes: paperSessionMomentum.config.cooldownMinutes,
      paperLeverage: paperSessionMomentum.config.paperLeverage,
      liveLeverage: paperSessionMomentum.config.liveLeverage,
      minVolumeINR: paperSessionMomentum.config.minVolumeINR,
      universeLimit: paperSessionMomentum.config.universeLimit,
    },
    bigCoins: bigCoins.getBigCoinsState(),
    serverTime: now,
  };
}

function formatLogTime(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function broadcastBacktestLine(line) {
  backtestRunState.lines.push(line);
  for (const client of backtestStreamClients) {
    client.write(`data: ${JSON.stringify({ line, running: backtestRunState.running })}\n\n`);
  }
}

function backtestLog(message) {
  const line = String(message).startsWith("[")
    ? String(message)
    : `[${formatLogTime()}] ${message}`;
  console.log(line);
  broadcastBacktestLine(line);
  return line;
}

function captureBacktestLine(line) {
  broadcastBacktestLine(String(line));
}

function normalizeDateBoundary(value, endOfDay = false) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
  }
  return value;
}

function parseBacktestWindow(body) {
  const fromValue = normalizeDateBoundary(body.from, false);
  const toValue = normalizeDateBoundary(body.to, true);
  const fromMs = Date.parse(fromValue);
  const toMs = Date.parse(toValue);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    const error = new Error("from/to must be valid UTC dates and from must be before to");
    error.code = "INVALID_REQUEST";
    throw error;
  }
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), fromMs, toMs };
}

function beginBacktestRun(strategy, body) {
  if (backtestRunState.running) {
    const error = new Error(`A ${backtestRunState.strategy} backtest is already running`);
    error.code = "BACKTEST_BUSY";
    throw error;
  }
  const window = parseBacktestWindow(body);
  backtestRunState = { running: true, strategy, lines: [], startedAt: Date.now() };
  backtestLog(
    `Strategy=${strategy} from=${window.from} (${window.fromMs}) to=${window.to} (${window.toMs}) symbol=${body.symbol || "n/a"}`,
  );
  return window;
}

function finishBacktestRun(result = null, error = null) {
  if (result?.summary && !backtestRunState.lines.slice(-3).some((line) => line.includes("Backtest complete:"))) {
    backtestLog(
      `Backtest complete: netPct=${Number(result.summary.netReturnPct || 0).toFixed(2)} trades=${Number(result.summary.tradeCount || 0)} winRate=${Number(result.summary.winRatePct || 0).toFixed(1)}`,
    );
  }
  if (error) backtestLog(`Backtest failed: ${error.message}`);
  backtestRunState.running = false;
  fs.mkdirSync(path.dirname(BACKTEST_LOG_FILE), { recursive: true });
  fs.writeFileSync(BACKTEST_LOG_FILE, `${backtestRunState.lines.join("\n")}\n`);
  for (const client of backtestStreamClients) {
    client.write(`event: done\ndata: ${JSON.stringify({ running: false, error: error?.message || null })}\n\n`);
  }
}

function assertTradesInsideWindow(result, window) {
  for (const trade of result?.trades || []) {
    for (const field of ["entryTime", "exitTime"]) {
      const timestamp = Number(trade[field]);
      if (Number.isFinite(timestamp) && (timestamp < window.fromMs || timestamp > window.toMs)) {
        throw new Error(
          `Trade range invariant failed: ${trade.symbol || "unknown"} ${field}=${new Date(timestamp).toISOString()} is outside [${window.from}, ${window.to}]`,
        );
      }
    }
  }
}

function parseWatchlist(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return WATCHLIST;
}

async function runCrossSectionalForApi(strategy, body, window) {
  backtestLog("Fetching candles...");
  const common = {
    symbols: parseWatchlist(body.watchlist),
    from: window.fromMs,
    to: window.toMs,
    initialEquity: Number(body.equity) > 0 ? Number(body.equity) : 100_000,
  };
  let options;
  if (strategy === "csPrevious") {
    options = crossSectional.PREVIOUS_VERSION_OPTIONS;
  } else {
    options = {
      lookbackDays: strategy === "cs60ema" ? 60 : 30,
      topN: 2,
      momentumMetric: crossSectional.MOMENTUM_METRIC.TOTAL_RETURN,
      regimeFilterMode: crossSectional.REGIME_FILTER_MODE.EMA_ONLY,
      rebalanceEveryWeeks: Number(body.rebalanceFreq) || 2,
      skipUnchangedHoldings: true,
      requirePositiveMomentum: false,
    };
  }
  const result = await crossSectional.runCrossSectionalBacktest({ ...common, ...options });
  const first = Number.isFinite(result.candleRange?.first) ? new Date(result.candleRange.first).toISOString() : "n/a";
  const last = Number.isFinite(result.candleRange?.last) ? new Date(result.candleRange.last).toISOString() : "n/a";
  backtestLog(`Received ${result.candleCount || 0} candles, first=${first}, last=${last}`);
  backtestLog(`Warmup complete at index ${result.lookbackDays}`);
  return { ...result, strategy };
}

async function runBtcHoldForApi(body, window) {
  backtestLog("Fetching candles...");
  const candles = await fetchHistoricalCandles("I-BTC_INR", "1d", window.fromMs, window.toMs);
  backtestLog(
    `Received ${candles.length} candles, first=${candles.length ? new Date(candles[0].time).toISOString() : "n/a"}, last=${candles.length ? new Date(candles.at(-1).time).toISOString() : "n/a"}`,
  );
  const initialEquity = Number(body.equity) > 0 ? Number(body.equity) : 100_000;
  const benchmark = buildBuyAndHold(candles, window.fromMs, window.toMs, initialEquity);
  if (!benchmark) throw new Error("BTC buy-and-hold needs at least two candles in the selected range");
  const days = (window.toMs - window.fromMs) / 86_400_000;
  benchmark.summary.cagrPct = days > 0
    ? ((benchmark.summary.finalEquityInr / initialEquity) ** (365 / days) - 1) * 100
    : null;
  benchmark.summary.sharpe = null;
  benchmark.summary.avgRMultiple = null;
  benchmark.summary.turnover = 2;
  benchmark.summary.durationDays = days;
  benchmark.summary.captureRatio = 1;
  return {
    strategy: "btcHold",
    symbol: "I-BTC_INR",
    interval: "1d",
    from: window.fromMs,
    to: window.toMs,
    initialEquity,
    candleCount: candles.length,
    candleRange: { first: candles[0].time, last: candles.at(-1).time },
    summary: benchmark.summary,
    trades: [{
      symbol: "I-BTC_INR",
      entryTime: benchmark.entryTime,
      exitTime: benchmark.exitTime,
      entryPrice: benchmark.entryPrice,
      exitPrice: benchmark.exitPrice,
      reason: "BUY_AND_HOLD",
    }],
    equityCurve: benchmark.equityCurve,
  };
}

function loadManualCostBasis() {
  try {
    const parsed = JSON.parse(fs.readFileSync(COST_BASIS_FILE, "utf8"));
    const assets = Object.fromEntries(
      Object.entries(parsed.assets || {})
        .map(([currency, value]) => [currency.toUpperCase(), Number(value)])
        .filter(([, value]) => Number.isFinite(value) && value >= 0),
    );
    const totalInvestedInr = Number(parsed.totalInvestedInr);

    return {
      assets,
      totalInvestedInr: Number.isFinite(totalInvestedInr)
        ? totalInvestedInr
        : Object.values(assets).reduce((sum, value) => sum + value, 0),
      note: String(parsed.note || ""),
    };
  } catch {
    return null;
  }
}

async function fetchJson(endpoint) {
  const response = await fetch(`${COINDCX_API}${endpoint}`, {
    headers: { Accept: "application/json", "User-Agent": "coindcx-market-dashboard/1.0" },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`CoinDCX returned HTTP ${response.status}`);
  }

  return response.json();
}

function hasCredentials() {
  return Boolean(process.env.COINDCX_API_KEY?.trim() && process.env.COINDCX_SECRET?.trim());
}

async function authenticatedRequest(endpoint, body) {
  if (!hasCredentials()) {
    const error = new Error("CoinDCX API credentials are not configured.");
    error.code = "MISSING_CREDENTIALS";
    throw error;
  }

  const payload = JSON.stringify(body);
  const signature = crypto
    .createHmac("sha256", process.env.COINDCX_SECRET.trim())
    .update(payload)
    .digest("hex");

  const response = await fetch(`${COINDCX_API}${endpoint}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "coindcx-market-dashboard/1.0",
      "X-AUTH-APIKEY": process.env.COINDCX_API_KEY.trim(),
      "X-AUTH-SIGNATURE": signature,
    },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });

  let result;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok || !Array.isArray(result)) {
    const error = new Error(
      result?.message || result?.error || `CoinDCX returned HTTP ${response.status}`,
    );
    error.code = response.status === 401 || response.status === 403 ? "AUTH_FAILED" : "UPSTREAM_ERROR";
    throw error;
  }

  return result;
}

async function getMarketDetails() {
  if (detailsCache.data && Date.now() - detailsCache.fetchedAt < DETAILS_TTL_MS) {
    return detailsCache.data;
  }

  const details = await fetchJson("/exchange/v1/markets_details");
  const detailsByMarket = new Map();

  for (const item of details) {
    const market = item.coindcx_name || item.symbol;
    if (!market) continue;

    detailsByMarket.set(market, {
      market,
      name: item.target_currency_name || item.target_currency_short_name || market,
      asset: item.target_currency_short_name || "",
      quote: item.base_currency_short_name || "",
      pair: item.pair || "",
      precision: Number.isFinite(item.base_currency_precision)
        ? item.base_currency_precision
        : 8,
    });
  }

  detailsCache = { data: detailsByMarket, fetchedAt: Date.now() };
  return detailsByMarket;
}

async function loadMarkets() {
  const [tickers, detailsByMarket] = await Promise.all([
    fetchJson("/exchange/ticker"),
    getMarketDetails(),
  ]);

  const markets = tickers.map((ticker) => {
    const details = detailsByMarket.get(ticker.market) || {};

    return {
      market: ticker.market,
      name: details.name || ticker.market,
      asset: details.asset || "",
      quote: details.quote || "",
      pair: details.pair || "",
      precision: details.precision ?? 8,
      price: Number(ticker.last_price) || 0,
      change: Number(ticker.change_24_hour) || 0,
      high: Number(ticker.high) || 0,
      low: Number(ticker.low) || 0,
      volume: Number(ticker.volume) || 0,
      bid: Number(ticker.bid) || 0,
      ask: Number(ticker.ask) || 0,
      timestamp: Number(ticker.timestamp) || Math.floor(Date.now() / 1000),
    };
  });

  tickerCache = { data: markets, fetchedAt: Date.now() };
  return markets;
}

async function getMarkets() {
  if (tickerCache.data && Date.now() - tickerCache.fetchedAt < CACHE_TTL_MS) {
    return { markets: tickerCache.data, stale: false };
  }

  if (!pendingMarketRequest) {
    pendingMarketRequest = loadMarkets().finally(() => {
      pendingMarketRequest = null;
    });
  }

  try {
    return { markets: await pendingMarketRequest, stale: false };
  } catch (error) {
    if (tickerCache.data) {
      return { markets: tickerCache.data, stale: true, warning: error.message };
    }
    throw error;
  }
}

function findInrPrice(currency, markets) {
  if (currency === "INR") return 1;

  const directMarket = markets.find(
    (market) => market.asset === currency && market.quote === "INR" && market.price > 0,
  );
  if (directMarket) return directMarket.price;

  const usdtMarket = markets.find(
    (market) => market.asset === currency && market.quote === "USDT" && market.price > 0,
  );
  const usdtInrMarket = markets.find(
    (market) => market.asset === "USDT" && market.quote === "INR" && market.price > 0,
  );

  if (usdtMarket && usdtInrMarket) return usdtMarket.price * usdtInrMarket.price;
  return null;
}

function findMarket(asset, quote, markets) {
  return markets.find(
    (market) => market.asset === asset && market.quote === quote && market.price > 0,
  );
}

function findBestTradeMarket(asset, markets, preferredQuotes = ["INR", "USDT"]) {
  for (const quote of preferredQuotes) {
    const market = findMarket(asset, quote, markets);
    if (market) return market;
  }

  return markets.find((market) => market.asset === asset && market.price > 0) || null;
}

async function getAccountTradeHistory() {
  const trades = [];
  const seenIds = new Set();
  let fromId;
  let limitReached = false;

  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const body = {
      limit: 500,
      timestamp: Date.now(),
      sort: "asc",
    };
    if (fromId !== undefined) body.from_id = fromId;

    const page = await authenticatedRequest("/exchange/v1/orders/trade_history", body);
    for (const trade of page) {
      const identifier = String(trade.id ?? `${trade.order_id}-${trade.timestamp}`);
      if (!seenIds.has(identifier)) {
        seenIds.add(identifier);
        trades.push(trade);
      }
    }

    if (page.length < 500) break;

    const nextFromId = page.at(-1)?.id;
    if (nextFromId === undefined || nextFromId === fromId) break;
    fromId = nextFromId;
    limitReached = pageNumber === 9;
  }

  return { trades, limitReached };
}

function resolveMarketMetadata(symbol, markets, marketDetails) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const activeMarket = markets.find((market) => market.market === normalizedSymbol);
  if (activeMarket) return activeMarket;

  const documentedMarket = marketDetails.get(normalizedSymbol);
  if (documentedMarket) return documentedMarket;

  const knownQuotes = ["USDT", "USDC", "BUSD", "TUSD", "INR", "BTC", "ETH", "BNB"];
  const quote = knownQuotes.find(
    (candidate) =>
      normalizedSymbol.endsWith(candidate) && normalizedSymbol.length > candidate.length,
  );

  if (!quote) return null;
  return {
    market: normalizedSymbol,
    asset: normalizedSymbol.slice(0, -quote.length),
    quote,
    name: normalizedSymbol.slice(0, -quote.length),
    precision: 8,
  };
}

function calculatePerformance(holdings, trades, markets, marketDetails, historyLimitReached) {
  const marketBySymbol = new Map(markets.map((market) => [market.market, market]));
  const positions = new Map();
  let usedNonInrConversion = false;
  let unmatchedTrades = 0;

  for (const trade of [...trades].sort((a, b) => a.timestamp - b.timestamp)) {
    const market =
      marketBySymbol.get(trade.symbol) ||
      resolveMarketMetadata(trade.symbol, markets, marketDetails);
    if (!market?.asset || !market?.quote || trade.quantity <= 0 || trade.price <= 0) {
      unmatchedTrades += 1;
      continue;
    }

    const quotePriceInr = findInrPrice(market.quote, markets);
    if (quotePriceInr === null) {
      unmatchedTrades += 1;
      continue;
    }

    if (market.quote !== "INR") usedNonInrConversion = true;

    const position = positions.get(market.asset) || {
      lots: [],
      realizedPnlInr: 0,
      uncoveredSales: 0,
      buyTrades: 0,
      sellTrades: 0,
    };
    const grossInr = trade.quantity * trade.price * quotePriceInr;

    if (trade.side === "buy") {
      position.lots.push({
        quantity: trade.quantity,
        costPerUnitInr: grossInr / trade.quantity,
      });
      position.buyTrades += 1;
    } else if (trade.side === "sell") {
      let remainingToSell = trade.quantity;
      let removedCostInr = 0;

      while (remainingToSell > 1e-12 && position.lots.length > 0) {
        const lot = position.lots[0];
        const consumed = Math.min(remainingToSell, lot.quantity);
        removedCostInr += consumed * lot.costPerUnitInr;
        lot.quantity -= consumed;
        remainingToSell -= consumed;
        if (lot.quantity <= 1e-12) position.lots.shift();
      }

      const coveredQuantity = trade.quantity - remainingToSell;
      const coveredProceedsInr =
        coveredQuantity > 0 ? grossInr * (coveredQuantity / trade.quantity) : 0;
      position.realizedPnlInr += coveredProceedsInr - removedCostInr;
      position.uncoveredSales += remainingToSell;
      position.sellTrades += 1;
    }

    positions.set(market.asset, position);
  }

  let portfolioReturnsInr = 0;
  const realizedPnlInr = [...positions.values()].reduce(
    (sum, position) => sum + position.realizedPnlInr,
    0,
  );
  let investedInr = 0;
  let coveredValueInr = 0;

  const enrichedHoldings = holdings.map((holding) => {
    const position = positions.get(holding.currency);
    const trackedQuantity =
      position?.lots.reduce((sum, lot) => sum + lot.quantity, 0) || 0;
    const coveredQuantity = Math.min(holding.total, trackedQuantity);
    let remainingCoverage = coveredQuantity;
    let costBasisInr = 0;

    for (const lot of position?.lots || []) {
      if (remainingCoverage <= 1e-12) break;
      const included = Math.min(remainingCoverage, lot.quantity);
      costBasisInr += included * lot.costPerUnitInr;
      remainingCoverage -= included;
    }

    const hasCostBasis = coveredQuantity > 1e-12;
    const averageBuyPriceInr = hasCostBasis ? costBasisInr / coveredQuantity : null;
    const coveredCurrentValueInr =
      hasCostBasis && holding.priceInr !== null ? coveredQuantity * holding.priceInr : null;
    const holdingUnrealizedPnlInr =
      !hasCostBasis || coveredCurrentValueInr === null
        ? null
        : coveredCurrentValueInr - costBasisInr;
    const holdingRealizedPnlInr = position?.realizedPnlInr || 0;
    const coverage =
      holding.total > 0 ? Math.min(1, coveredQuantity / holding.total) : 0;

    if (holdingUnrealizedPnlInr !== null) {
      portfolioReturnsInr += holdingUnrealizedPnlInr;
      investedInr += costBasisInr;
      coveredValueInr += coveredCurrentValueInr;
    }
    return {
      ...holding,
      averageBuyPriceInr,
      costBasisInr: hasCostBasis ? costBasisInr : null,
      unrealizedPnlInr: holdingUnrealizedPnlInr,
      realizedPnlInr: holdingRealizedPnlInr,
      totalPnlInr:
        holdingUnrealizedPnlInr === null
          ? holdingRealizedPnlInr || null
          : holdingUnrealizedPnlInr + holdingRealizedPnlInr,
      pnlPercent:
        costBasisInr && holdingUnrealizedPnlInr !== null
          ? (holdingUnrealizedPnlInr / costBasisInr) * 100
          : null,
      costBasisCoverage: coverage,
      costBasisQuantity: coveredQuantity,
      buyTrades: position?.buyTrades || 0,
      sellTrades: position?.sellTrades || 0,
    };
  });

  const portfolioCurrentValueInr = holdings.reduce(
    (sum, holding) =>
      holding.currency === "INR" ? sum : sum + (holding.valueInr || 0),
    0,
  );

  return {
    holdings: enrichedHoldings.map((holding) => ({
      ...holding,
      allocationPercent:
        holding.currency !== "INR" &&
        holding.valueInr !== null &&
        portfolioCurrentValueInr > 0
          ? (holding.valueInr / portfolioCurrentValueInr) * 100
          : null,
    })),
    performance: {
      portfolioCurrentValueInr,
      investedInr,
      portfolioReturnsInr: investedInr > 0 ? portfolioReturnsInr : null,
      portfolioReturnsPercent:
        investedInr > 0 ? (portfolioReturnsInr / investedInr) * 100 : null,
      unrealizedPnlInr: investedInr > 0 ? portfolioReturnsInr : null,
      realizedPnlInr,
      totalPnlInr: investedInr > 0 ? portfolioReturnsInr : null,
      pnlPercent: investedInr > 0 ? (portfolioReturnsInr / investedInr) * 100 : null,
      coveragePercent:
        portfolioCurrentValueInr > 0
          ? (coveredValueInr / portfolioCurrentValueInr) * 100
          : 0,
      isEstimated:
        usedNonInrConversion ||
        unmatchedTrades > 0 ||
        enrichedHoldings.some(
          (holding) =>
            holding.currency !== "INR" &&
            holding.total > 0 &&
            holding.costBasisCoverage < 0.999,
        ),
      unmatchedTrades,
      historyLimitReached,
    },
  };
}

function applyManualCostBasis(performanceResult, manualCostBasis) {
  if (!manualCostBasis) return performanceResult;

  const assignedInvestedInr = Object.values(manualCostBasis.assets).reduce(
    (sum, value) => sum + value,
    0,
  );

  const holdings = performanceResult.holdings.map((holding) => {
    const manualInvestment = manualCostBasis.assets[holding.currency];
    if (manualInvestment === undefined || holding.currency === "INR") return holding;

    const currentReturnsInr =
      holding.valueInr === null ? null : holding.valueInr - manualInvestment;

    return {
      ...holding,
      averageBuyPriceInr:
        holding.total > 0 ? manualInvestment / holding.total : null,
      costBasisInr: manualInvestment,
      unrealizedPnlInr: currentReturnsInr,
      totalPnlInr: currentReturnsInr,
      pnlPercent:
        manualInvestment > 0 && currentReturnsInr !== null
          ? (currentReturnsInr / manualInvestment) * 100
          : null,
      costBasisCoverage: 1,
      costBasisQuantity: holding.total,
      costBasisSource: "manual",
    };
  });

  const totalInvestedInr = manualCostBasis.totalInvestedInr;
  const currentValueInr = performanceResult.performance.portfolioCurrentValueInr;
  const portfolioReturnsInr = currentValueInr - totalInvestedInr;

  return {
    holdings,
    performance: {
      ...performanceResult.performance,
      investedInr: totalInvestedInr,
      portfolioReturnsInr,
      portfolioReturnsPercent:
        totalInvestedInr > 0 ? (portfolioReturnsInr / totalInvestedInr) * 100 : null,
      unrealizedPnlInr: portfolioReturnsInr,
      totalPnlInr: portfolioReturnsInr,
      coveragePercent: 100,
      isEstimated: false,
      costBasisSource: "manual",
      assignedInvestedInr,
      unassignedInvestedInr: totalInvestedInr - assignedInvestedInr,
      costBasisNote: manualCostBasis.note,
    },
  };
}

async function loadAccount() {
  const timestamp = Date.now();
  const [balances, tradeHistory, marketResult] = await Promise.all([
    authenticatedRequest("/exchange/v1/users/balances", { timestamp }),
    getAccountTradeHistory(),
    getMarkets(),
  ]);
  const trades = tradeHistory.trades;
  const marketDetails = await getMarketDetails();

  const holdings = balances
    .map((item) => {
      const available = Number(item.balance) || 0;
      const locked = Number(item.locked_balance) || 0;
      const total = available + locked;
      const currency = String(item.currency || "").toUpperCase();
      const priceInr = findInrPrice(currency, marketResult.markets);
      const market = marketResult.markets.find((item) => item.asset === currency);

      return {
        currency,
        name: currency === "INR" ? "Indian Rupee" : market?.name || currency,
        available,
        locked,
        total,
        priceInr,
        valueInr: priceInr === null ? null : total * priceInr,
      };
    })
    .filter((holding) => holding.total > 0)
    .sort((a, b) => (b.valueInr ?? -1) - (a.valueInr ?? -1));

  const normalizedTrades = trades
    .map((trade) => {
      const symbol = String(trade.symbol || "").toUpperCase();
      const price = Number(trade.price) || 0;
      const quantity = Number(trade.quantity) || 0;
      const market = marketResult.markets.find((item) => item.market === symbol);
      const details =
        market || resolveMarketMetadata(symbol, marketResult.markets, marketDetails);
      const asset = details?.asset || "";
      const quote = details?.quote || "";
      let currentPrice = market?.price || null;
      let comparisonTradePrice = price;
      let currentPriceQuote = quote;
      let isConvertedComparison = false;

      if (currentPrice === null && asset && quote) {
        const assetPriceInr = findInrPrice(asset, marketResult.markets);
        const quotePriceInr = findInrPrice(quote, marketResult.markets);
        if (assetPriceInr !== null && quotePriceInr !== null) {
          currentPrice = assetPriceInr;
          comparisonTradePrice = price * quotePriceInr;
          currentPriceQuote = "INR";
          isConvertedComparison = quote !== "INR";
        }
      }

      return {
        id: trade.id,
        orderId: trade.order_id,
        side: String(trade.side || "").toLowerCase(),
        fee: Number(trade.fee_amount) || 0,
        quantity,
        price,
        symbol,
        asset,
        quote,
        precision: details?.precision ?? 8,
        currentPrice,
        currentPriceQuote,
        isConvertedComparison,
        comparisonUnavailableReason:
          currentPrice === null
            ? asset
              ? "No active CoinDCX market"
              : "Market mapping unavailable"
            : null,
        priceChangePercent:
          currentPrice !== null && comparisonTradePrice > 0
            ? ((currentPrice - comparisonTradePrice) / comparisonTradePrice) * 100
            : null,
        valueDifference:
          currentPrice !== null ? (currentPrice - comparisonTradePrice) * quantity : null,
        timestamp: Number(trade.timestamp) || 0,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const calculatedPerformance = calculatePerformance(
    holdings,
    normalizedTrades,
    marketResult.markets,
    marketDetails,
    tradeHistory.limitReached,
  );
  const performanceResult = applyManualCostBasis(
    calculatedPerformance,
    loadManualCostBasis(),
  );

  return {
    holdings: performanceResult.holdings,
    trades: normalizedTrades.slice(0, 100),
    totalTradeCount: normalizedTrades.length,
    totalValueInr: performanceResult.performance.portfolioCurrentValueInr,
    cashBalanceInr:
      holdings.find((holding) => holding.currency === "INR")?.total || 0,
    coinCount: holdings.filter((holding) => holding.currency !== "INR").length,
    unpricedAssets: holdings.filter((holding) => holding.valueInr === null).length,
    performance: performanceResult.performance,
    updatedAt: Date.now(),
  };
}

async function getAccount() {
  if (accountCache.data && Date.now() - accountCache.fetchedAt < ACCOUNT_CACHE_TTL_MS) {
    return accountCache.data;
  }

  if (!pendingAccountRequest) {
    pendingAccountRequest = loadAccount()
      .then((data) => {
        accountCache = { data, fetchedAt: Date.now() };
        return data;
      })
      .finally(() => {
        pendingAccountRequest = null;
      });
  }

  return pendingAccountRequest;
}

function buildExitSignals(account) {
  const watchedAssets = [
    ...new Set([...MORPHO_STRATEGY.sourceAssets, MORPHO_STRATEGY.targetAsset]),
  ];

  return watchedAssets.map((asset) => {
    const holding = account.holdings.find((item) => item.currency === asset);
    const averageBuyPriceInr = holding?.averageBuyPriceInr ?? null;
    const livePriceInr = holding?.priceInr ?? null;
    const changeFromBuyPercent =
      averageBuyPriceInr > 0 && livePriceInr !== null
        ? ((livePriceInr - averageBuyPriceInr) / averageBuyPriceInr) * 100
        : null;

    let trigger = "not-held";
    let action = "No holding to monitor";

    if (holding && changeFromBuyPercent === null) {
      trigger = "waiting";
      action = "Need buy price and live price";
    } else if (holding && changeFromBuyPercent <= MORPHO_STRATEGY.stopLossPercent) {
      trigger = "stop-loss";
      action = "Sell signal: down 1% or more from buy price";
    } else if (holding && changeFromBuyPercent >= MORPHO_STRATEGY.takeProfitPercent) {
      trigger = "take-profit";
      action = "Sell signal: up 3% or more from buy price";
    } else if (holding) {
      trigger = "hold";
      action = "Hold: inside -1% to +3% range";
    }

    return {
      asset,
      heldQuantity: holding?.total ?? 0,
      currentValueInr: holding?.valueInr ?? 0,
      averageBuyPriceInr,
      livePriceInr,
      changeFromBuyPercent,
      trigger,
      action,
    };
  });
}

function buildMorphoStrategyPlan(account, markets) {
  const holdingsByCurrency = new Map(account.holdings.map((holding) => [holding.currency, holding]));
  const sourceHoldings = MORPHO_STRATEGY.sourceAssets.map((asset) => {
    const holding = holdingsByCurrency.get(asset);
    const priceInr = holding?.priceInr ?? findInrPrice(asset, markets);
    const available = holding?.available ?? 0;
    const availableValueInr = priceInr === null ? null : available * priceInr;
    const market = findBestTradeMarket(asset, markets);

    return {
      asset,
      holding,
      priceInr,
      available,
      availableValueInr,
      market,
    };
  });

  let remainingSellInr = MORPHO_STRATEGY.targetSellInr;
  const sellLegs = sourceHoldings.map((source) => {
    const canEstimate = source.priceInr !== null && source.availableValueInr !== null;
    const sellValueInr = canEstimate
      ? Math.min(Math.max(0, remainingSellInr), source.availableValueInr)
      : 0;
    if (canEstimate) remainingSellInr -= sellValueInr;

    return {
      asset: source.asset,
      market: source.market?.market ?? null,
      quote: source.market?.quote ?? null,
      available: source.available,
      availableValueInr: source.availableValueInr,
      estimatedSellValueInr: sellValueInr,
      estimatedQuantity:
        source.priceInr > 0 && sellValueInr > 0 ? sellValueInr / source.priceInr : 0,
      livePriceInr: source.priceInr,
      ready:
        sellValueInr > 0 &&
        Boolean(source.market) &&
        source.available > 0 &&
        source.priceInr !== null,
      warning: !source.holding
        ? "No balance"
        : source.priceInr === null
          ? "No INR price available"
          : !source.market
            ? "No active sell market found"
            : sellValueInr <= 0
              ? "No amount needed for this leg"
              : null,
    };
  });

  const estimatedSellValueInr = sellLegs.reduce(
    (sum, leg) => sum + leg.estimatedSellValueInr,
    0,
  );
  const targetMarket = findBestTradeMarket(MORPHO_STRATEGY.targetAsset, markets);
  const targetPriceInr = findInrPrice(MORPHO_STRATEGY.targetAsset, markets);
  const leveragedNotionalInr = estimatedSellValueInr * MORPHO_STRATEGY.preferredLeverage;
  const warnings = [
    "Dry run only: this dashboard does not place real orders automatically.",
    "Leverage availability is not confirmed by this spot market feed. Verify CoinDCX futures/margin support before trading.",
  ];

  if (remainingSellInr > 0) {
    warnings.push(
      `Selected source assets are short by INR ${remainingSellInr.toFixed(2)} against the INR ${MORPHO_STRATEGY.targetSellInr.toFixed(2)} target.`,
    );
  }
  if (!targetMarket) warnings.push("No active MORPHO market was found in the live CoinDCX market list.");
  if (targetPriceInr === null) warnings.push("MORPHO INR price could not be estimated.");

  return {
    config: MORPHO_STRATEGY,
    execution: {
      mode: "dry-run",
      liveOrdersEnabled: false,
      reason:
        "Real order execution is intentionally locked. Use this panel to preview, then place the trade manually in CoinDCX or add a separately reviewed execution module.",
    },
    sell: {
      targetSellInr: MORPHO_STRATEGY.targetSellInr,
      estimatedSellValueInr,
      shortfallInr: Math.max(0, remainingSellInr),
      allocationMethod: "Sell selected source assets in order, capped at INR 40.",
      legs: sellLegs,
    },
    buy: {
      asset: MORPHO_STRATEGY.targetAsset,
      market: targetMarket?.market ?? null,
      quote: targetMarket?.quote ?? null,
      orderType: MORPHO_STRATEGY.orderType,
      livePriceInr: targetPriceInr,
      spotQuantityEstimate:
        targetPriceInr > 0 ? estimatedSellValueInr / targetPriceInr : null,
      requestedLeverage: MORPHO_STRATEGY.preferredLeverage,
      fallbackLeverage: MORPHO_STRATEGY.fallbackLeverage,
      leveragedNotionalInr,
      leveragedQuantityEstimate:
        targetPriceInr > 0 ? leveragedNotionalInr / targetPriceInr : null,
    },
    automation: {
      stopLossPercent: MORPHO_STRATEGY.stopLossPercent,
      takeProfitPercent: MORPHO_STRATEGY.takeProfitPercent,
      signals: buildExitSignals(account),
    },
    warnings,
    updatedAt: Date.now(),
  };
}

async function getTradePlan() {
  const [account, marketResult] = await Promise.all([getAccount(), getMarkets()]);
  return buildMorphoStrategyPlan(account, marketResult.markets);
}

// ---------------------------------------------------------------------------
// Momentum strategy: candles, signals, paper trading
// ---------------------------------------------------------------------------

const pairResolutionCache = new Map(); // requested symbol → real candle pair

// Map whatever the caller sent (I-BTC_INR, B-BTC_INR, BTCINR) onto the pair
// name the public candles API actually accepts.
async function resolveCandlePair(symbol) {
  const requested = String(symbol || "").trim();
  if (!requested) return requested;
  if (pairResolutionCache.has(requested)) return pairResolutionCache.get(requested);

  try {
    const details = await getMarketDetails();
    const entries = [...details.values()];
    const upper = requested.toUpperCase();

    let resolved =
      entries.find((item) => item.pair === requested)?.pair ||
      entries.find((item) => item.market === upper)?.pair ||
      null;

    if (!resolved) {
      // Wrong ecosystem prefix (e.g. B-BTC_INR for the real I-BTC_INR).
      const suffix = upper.match(/^[A-Z]+-(.+)$/);
      if (suffix) {
        resolved = entries.find((item) => item.pair?.endsWith(`-${suffix[1]}`))?.pair || null;
      }
    }

    const pair = resolved || requested;
    pairResolutionCache.set(requested, pair);
    return pair;
  } catch {
    return requested; // markets_details unavailable — try the symbol as-is
  }
}

// Cache candles until the current interval bucket rolls over, so repeated
// signal/candle requests within one candle never re-hit CoinDCX.
async function getCandles(symbol, interval, limit = 300) {
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) {
    const error = new Error(`Unsupported interval "${interval}". Use one of: ${Object.keys(INTERVAL_MS).join(", ")}`);
    error.code = "INVALID_REQUEST";
    throw error;
  }

  const pair = await resolveCandlePair(symbol);
  const key = `${pair}|${interval}`;
  const cached = candleCache.get(key);
  if (cached && Date.now() < cached.expiresAt && cached.candles.length >= Math.min(limit, 1000)) {
    return { candles: cached.candles.slice(-limit), pair, stale: false };
  }

  try {
    const fetchCount = Math.max(limit, 400) + 5;
    const now = Date.now();
    const candles = await fetchHistoricalCandles(pair, interval, now - fetchCount * intervalMs, now);
    if (candles.length === 0) throw new Error(`No candles returned for ${pair} ${interval}`);
    const expiresAt = Math.floor(now / intervalMs) * intervalMs + intervalMs;
    candleCache.set(key, { candles, expiresAt });
    return { candles: candles.slice(-limit), pair, stale: false };
  } catch (error) {
    if (cached) {
      return { candles: cached.candles.slice(-limit), pair, stale: true, warning: error.message };
    }
    throw error;
  }
}

// Signals must only see closed bars; the newest candle is still forming
// until its bucket ends.
function dropFormingCandle(candles, intervalMs) {
  const last = candles.at(-1);
  if (last && last.time + intervalMs > Date.now()) return candles.slice(0, -1);
  return candles;
}

// Market regime (see strategy/regime.js), benchmarked on BTC's own daily
// candles. Cached for a few minutes since it only moves on daily closes and
// is fetched by both /api/signals and /api/ranking.
async function getMarketRegime() {
  if (regimeCache.data && Date.now() - regimeCache.fetchedAt < REGIME_CACHE_TTL_MS) {
    return regimeCache.data;
  }

  let info;
  try {
    const { candles, stale } = await getCandles(regimeModule.REGIME_BENCHMARK_SYMBOL, "1d", 400);
    const closed = dropFormingCandle(candles, INTERVAL_MS["1d"]);
    const regime = regimeModule.getRegime(closed);
    info = {
      regime,
      // Unknown regime (fetch failed, or not enough BTC daily history yet)
      // fails safe to RANGE — i.e. no new entries — rather than bypassing
      // the gate that strategy/momentum.js and cross-sectional.js apply.
      regimeForGate: regime || "RANGE",
      known: regime !== null,
      stale,
      benchmark: regimeModule.REGIME_BENCHMARK_SYMBOL,
      candleTime: closed.at(-1)?.time ?? null,
    };
  } catch (error) {
    info = {
      regime: null,
      regimeForGate: "RANGE",
      known: false,
      stale: true,
      benchmark: regimeModule.REGIME_BENCHMARK_SYMBOL,
      candleTime: null,
      error: error.message,
    };
  }

  regimeCache = { data: info, fetchedAt: Date.now() };
  return info;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function defaultPaperState() {
  return {
    startingEquityInr: PAPER_STARTING_EQUITY_INR,
    cashInr: PAPER_STARTING_EQUITY_INR,
    positions: {},
    closedTrades: [],
    dailyRealizedPnl: {},
    updatedAt: Date.now(),
  };
}

function loadPaperState() {
  if (paperState) return paperState;
  try {
    const parsed = JSON.parse(fs.readFileSync(PAPER_STATE_FILE, "utf8"));
    paperState = {
      startingEquityInr: Number.isFinite(Number(parsed.startingEquityInr))
        ? Number(parsed.startingEquityInr)
        : PAPER_STARTING_EQUITY_INR,
      cashInr: Number.isFinite(Number(parsed.cashInr))
        ? Number(parsed.cashInr)
        : PAPER_STARTING_EQUITY_INR,
      positions: parsed.positions && typeof parsed.positions === "object" ? parsed.positions : {},
      closedTrades: Array.isArray(parsed.closedTrades) ? parsed.closedTrades : [],
      dailyRealizedPnl:
        parsed.dailyRealizedPnl && typeof parsed.dailyRealizedPnl === "object"
          ? parsed.dailyRealizedPnl
          : {},
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    paperState = defaultPaperState();
  }
  return paperState;
}

function savePaperState() {
  const state = loadPaperState();
  state.updatedAt = Date.now();
  state.closedTrades = state.closedTrades.slice(-500);
  fs.writeFileSync(PAPER_STATE_FILE, JSON.stringify(state, null, 2));
}

function paperMarkPrice(position, markets) {
  const market = markets.find(
    (item) =>
      item.pair === position.pair ||
      item.pair === position.symbol ||
      (position.market && item.market === position.market),
  );
  return market?.price > 0 ? market.price : null;
}

function paperPortfolioView(markets) {
  const state = loadPaperState();
  const positions = Object.values(state.positions).map((position) => {
    const mark = paperMarkPrice(position, markets) ?? position.entryPrice;
    const unrealizedPnlInr = (mark - position.entryPrice) * position.qty;
    return {
      ...position,
      markPrice: mark,
      valueInr: mark * position.qty,
      unrealizedPnlInr,
      unrealizedR:
        position.riskPerUnit > 0 ? (mark - position.entryPrice) / position.riskPerUnit : null,
    };
  });

  const positionsValueInr = positions.reduce((sum, position) => sum + position.valueInr, 0);
  const unrealizedPnlInr = positions.reduce((sum, position) => sum + position.unrealizedPnlInr, 0);
  const equityInr = state.cashInr + positionsValueInr;
  const realizedTodayInr = state.dailyRealizedPnl[todayKey()] || 0;
  const totalRealizedPnlInr = state.closedTrades.reduce(
    (sum, trade) => sum + (Number(trade.netPnlInr) || 0),
    0,
  );

  return {
    startingEquityInr: state.startingEquityInr,
    cashInr: state.cashInr,
    equityInr,
    totalReturnPct:
      state.startingEquityInr > 0 ? (equityInr / state.startingEquityInr - 1) * 100 : null,
    openPositionCount: positions.length,
    maxPositions: risk.MAX_CONCURRENT_POSITIONS,
    unrealizedPnlInr,
    realizedTodayInr,
    totalRealizedPnlInr,
    dailyLossCapped: risk.isDailyLossCapped({
      equity: equityInr,
      realizedTodayInr,
      unrealizedInr: unrealizedPnlInr,
    }),
    positions,
    closedTrades: [...state.closedTrades].slice(-50).reverse(),
    updatedAt: Date.now(),
  };
}

async function getWatchlistSignals() {
  const state = loadPaperState();
  const intervalMs = INTERVAL_MS[SIGNAL_INTERVAL] || INTERVAL_MS["4h"];
  const marketResult = await getMarkets().catch(() => ({ markets: [] }));
  const regimeInfo = await getMarketRegime();
  let positionsTouched = false;

  const signals = await Promise.all(
    WATCHLIST.map(async (symbol) => {
      const position = state.positions[symbol] || null;
      try {
        const { candles, pair, stale: fetchStale } = await getCandles(symbol, SIGNAL_INTERVAL, 400);
        const closed = dropFormingCandle(candles, intervalMs);
        const lastClosed = closed.at(-1);
        const candlesBehind = lastClosed
          ? (Date.now() - (lastClosed.time + intervalMs)) / intervalMs
          : Infinity;
        const stale = fetchStale || candlesBehind > 2;

        const snapshot = momentum.snapshot(closed);
        const signal = stale
          ? {
              action: "HOLD",
              reason: `Degraded to HOLD: candle data is stale (${Math.floor(candlesBehind)} candles behind)`,
              stopLoss: null,
              takeProfit: null,
              sizeR: null,
            }
          : momentum.generateSignal(closed, position, undefined, regimeInfo.regimeForGate);

        saveSignal({
          symbol,
          interval: SIGNAL_INTERVAL,
          timestamp: lastClosed?.time ?? Math.floor(Date.now() / intervalMs) * intervalMs,
          action: signal.action,
          price: marketResult.markets.find((item) => item.pair === pair)?.price ?? lastClosed?.close,
          reason: signal.reason,
          rsi: snapshot?.rsi,
          adx: snapshot?.adx,
          ema20: snapshot?.emaFast,
          ema50: snapshot?.emaSlow,
          ema200: snapshot?.emaLong,
          atr: snapshot?.atr,
          roc: snapshot?.roc,
        });

        // Keep the trailing-stop watermark current while a position is open.
        if (position && lastClosed) {
          position.highestClose = Math.max(
            position.highestClose ?? position.entryPrice,
            lastClosed.close,
          );
          if (Number.isFinite(signal.stopLoss)) {
            position.stopLoss = Math.max(position.stopLoss ?? -Infinity, signal.stopLoss);
          }
          positionsTouched = true;
        }

        const market = marketResult.markets.find((item) => item.pair === pair) || null;
        return {
          symbol,
          pair,
          market: market?.market ?? null,
          price: market?.price ?? lastClosed?.close ?? null,
          candleTime: lastClosed?.time ?? null,
          stale,
          indicators: snapshot,
          signal,
          position,
        };
      } catch (error) {
        const signal = {
          action: "HOLD",
          reason: `Degraded to HOLD: ${error.message}`,
          stopLoss: null,
          takeProfit: null,
          sizeR: null,
        };
        saveSignal({
          symbol,
          interval: SIGNAL_INTERVAL,
          timestamp: Math.floor(Date.now() / intervalMs) * intervalMs,
          action: signal.action,
          price: null,
          reason: signal.reason,
        });
        return {
          symbol,
          pair: null,
          market: null,
          price: null,
          candleTime: null,
          stale: true,
          error: error.message,
          indicators: null,
          signal,
          position,
        };
      }
    }),
  );

  if (positionsTouched) savePaperState();

  return {
    interval: SIGNAL_INTERVAL,
    watchlist: WATCHLIST,
    params: momentum.DEFAULT_PARAMS,
    regime: regimeInfo,
    signals,
    updatedAt: Date.now(),
  };
}

// Cross-sectional momentum ranking across the watchlist (see
// strategy/cross-sectional.js). Informational only — reports which coins
// would be held under the current regime, but does not auto-trade.
async function getCrossSectionalRanking() {
  const regimeInfo = await getMarketRegime();
  const neededDailyCandles = CROSS_SECTIONAL_LOOKBACK_DAYS + 10;
  const rebalanceAt = crossSectional.latestRebalanceAt(Date.now());

  const candlesBySymbol = {};
  await Promise.all(
    WATCHLIST.map(async (symbol) => {
      try {
        const { candles } = await getCandles(symbol, "1d", neededDailyCandles);
        candlesBySymbol[symbol] = dropFormingCandle(candles, INTERVAL_MS["1d"]);
      } catch {
        candlesBySymbol[symbol] = [];
      }
    }),
  );

  // "Current ranking" uses the latest closed daily candles. Actual held
  // coins come from the last Monday 00:00 IST decision and remain unchanged
  // until next week's rebalance.
  const currentRanking = crossSectional.rankAndSelect({
    candlesBySymbol,
    lookbackDays: CROSS_SECTIONAL_LOOKBACK_DAYS,
    topN: CROSS_SECTIONAL_TOP_N,
  });

  const { candles: benchmarkCandles } = await getCandles(
    regimeModule.REGIME_BENCHMARK_SYMBOL,
    "1d",
    400,
  );
  const closedBenchmark = dropFormingCandle(benchmarkCandles, INTERVAL_MS["1d"]);
  const regimeAtRebalance = regimeModule.getRegime(
    crossSectional.candlesClosedBy(closedBenchmark, rebalanceAt),
  );
  const weeklyRanking = crossSectional.rankAndSelect({
    candlesBySymbol: Object.fromEntries(
      Object.entries(candlesBySymbol).map(([symbol, candles]) => [
        symbol,
        crossSectional.candlesClosedBy(candles, rebalanceAt),
      ]),
    ),
    lookbackDays: CROSS_SECTIONAL_LOOKBACK_DAYS,
    topN: CROSS_SECTIONAL_TOP_N,
    regime: regimeAtRebalance || regimeModule.REGIME.RANGE,
  });
  const heldBySymbol = new Map(weeklyRanking.map((row) => [row.symbol, row]));
  const ranking = currentRanking.map((row) => {
    const weekly = heldBySymbol.get(row.symbol);
    const held = Boolean(weekly?.selected);
    return {
      symbol: row.symbol,
      score: row.score,
      weight: held ? weekly.weight : 0,
      held,
      selected: held,
      currentTop: row.selected,
    };
  });

  return {
    regime: regimeInfo.regime,
    regimeKnown: regimeInfo.known,
    regimeAtRebalance,
    benchmark: regimeInfo.benchmark,
    lookbackDays: CROSS_SECTIONAL_LOOKBACK_DAYS,
    topN: CROSS_SECTIONAL_TOP_N,
    rebalanceAt,
    nextRebalanceAt: rebalanceAt + 7 * INTERVAL_MS["1d"],
    ranking,
    updatedAt: Date.now(),
  };
}

function closePaperQuantity(state, position, qty, price, reason) {
  const notional = qty * price;
  const fee = (notional * risk.DEFAULT_FEE_PCT) / 100;
  const tds = (notional * risk.TDS_PCT) / 100;
  const entryFeeShare = (position.entryFee || 0) * (qty / position.initialQty);
  const netPnlInr = notional - fee - tds - qty * position.entryPrice - entryFeeShare;

  state.cashInr += notional - fee - tds;
  state.dailyRealizedPnl[todayKey()] = (state.dailyRealizedPnl[todayKey()] || 0) + netPnlInr;
  const exitTime = Date.now();
  state.closedTrades.push({
    symbol: position.symbol,
    market: position.market,
    qty,
    entryPrice: position.entryPrice,
    exitPrice: price,
    entryTime: position.entryTime,
    exitTime,
    feesInr: fee + entryFeeShare,
    tdsInr: tds,
    netPnlInr,
    rMultiple:
      position.riskPerUnit * qty > 0 ? netPnlInr / (position.riskPerUnit * qty) : null,
    reason,
  });

  saveTrade({
    symbol: position.symbol,
    side: "SELL",
    quantity: qty,
    entry_price: position.entryPrice,
    exit_price: price,
    entry_time: position.entryTime,
    exit_time: exitTime,
    pnl: netPnlInr,
    fees: fee + entryFeeShare + tds,
  });

  position.qty -= qty;
  if (position.qty <= 1e-12) delete state.positions[position.symbol];
  return { netPnlInr, fee, tds };
}

// Simulated fills at the latest ticker price. Never touches real orders.
async function executePaper(body) {
  const auto = Boolean(body.auto);
  const symbolFilter = typeof body.symbol === "string" ? body.symbol.trim() : null;
  const manualAction = typeof body.action === "string" ? body.action.trim().toUpperCase() : null;

  if (!auto && (!symbolFilter || !["BUY", "SELL", "REDUCE_50"].includes(manualAction))) {
    const error = new Error(
      'Send {"auto":true} to execute all current signals, or {"symbol":"I-BTC_INR","action":"BUY"|"SELL"|"REDUCE_50"} for one market.',
    );
    error.code = "INVALID_REQUEST";
    throw error;
  }

  const state = loadPaperState();
  const payload = await getWatchlistSignals();
  const marketResult = await getMarkets().catch(() => ({ markets: [] }));
  const executed = [];
  const skipped = [];

  const rows = auto
    ? payload.signals
    : payload.signals.filter((row) => row.symbol === symbolFilter);
  if (!auto && rows.length === 0) {
    const error = new Error(`"${symbolFilter}" is not in the watchlist (${WATCHLIST.join(", ")})`);
    error.code = "INVALID_REQUEST";
    throw error;
  }

  for (const row of rows) {
    const action = auto ? row.signal.action : manualAction;
    if (action === "HOLD") continue;

    const position = state.positions[row.symbol] || null;
    const fillPrice = Number(row.price);
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
      skipped.push({ symbol: row.symbol, action, reason: "No live price available" });
      continue;
    }

    if (action === "BUY") {
      if (position) {
        skipped.push({ symbol: row.symbol, action, reason: "Already in a paper position" });
        continue;
      }
      if (row.stale) {
        skipped.push({ symbol: row.symbol, action, reason: "Candle data is stale" });
        continue;
      }
      if (!risk.canOpenPosition(Object.keys(state.positions).length)) {
        skipped.push({
          symbol: row.symbol,
          action,
          reason: `Portfolio cap: already ${risk.MAX_CONCURRENT_POSITIONS} open positions`,
        });
        continue;
      }

      const view = paperPortfolioView(marketResult.markets);
      if (view.dailyLossCapped) {
        skipped.push({
          symbol: row.symbol,
          action,
          reason: `Daily loss cap hit (> ${risk.DAILY_LOSS_CAP_PCT}% of equity) — no new entries today`,
        });
        continue;
      }

      let stopLoss = Number(row.signal.stopLoss);
      if (!Number.isFinite(stopLoss) && row.indicators?.atr > 0) {
        stopLoss = fillPrice - momentum.DEFAULT_PARAMS.atrMultiple * row.indicators.atr;
      }
      if (!(stopLoss > 0 && stopLoss < fillPrice)) {
        skipped.push({ symbol: row.symbol, action, reason: "No valid stop-loss to size against" });
        continue;
      }

      const size = risk.positionSize({ equity: view.equityInr, entry: fillPrice, stopLoss });
      const qty = Math.min(
        size.qty || 0,
        state.cashInr / (fillPrice * (1 + risk.DEFAULT_FEE_PCT / 100)),
      );
      const notional = qty * fillPrice;
      if (!(qty > 0) || notional < MIN_PAPER_ORDER_INR) {
        skipped.push({
          symbol: row.symbol,
          action,
          reason: size.reason || `Sized below minimum order (₹${MIN_PAPER_ORDER_INR}) or out of cash`,
        });
        continue;
      }

      const fee = (notional * risk.DEFAULT_FEE_PCT) / 100;
      state.cashInr -= notional + fee;
      const entryTime = Date.now();
      state.positions[row.symbol] = {
        symbol: row.symbol,
        pair: row.pair,
        market: row.market,
        entryPrice: fillPrice,
        qty,
        initialQty: qty,
        entryFee: fee,
        stopLoss,
        initialStop: stopLoss,
        riskPerUnit: fillPrice - stopLoss,
        highestClose: fillPrice,
        tookPartial: false,
        entryTime,
      };
      saveTrade({
        symbol: row.symbol,
        side: "BUY",
        quantity: qty,
        entry_price: fillPrice,
        exit_price: null,
        entry_time: entryTime,
        exit_time: null,
        pnl: null,
        fees: fee,
      });
      executed.push({
        symbol: row.symbol,
        action: "BUY",
        qty,
        price: fillPrice,
        feeInr: fee,
        stopLoss,
        reason: auto ? row.signal.reason : "Manual paper buy",
      });
    } else if (action === "SELL" || action === "REDUCE_50") {
      if (!position) {
        skipped.push({ symbol: row.symbol, action, reason: "No open paper position" });
        continue;
      }
      if (action === "REDUCE_50" && position.tookPartial) {
        skipped.push({ symbol: row.symbol, action, reason: "Partial take-profit already taken" });
        continue;
      }

      const qty = action === "REDUCE_50" ? position.qty / 2 : position.qty;
      const reason = auto ? row.signal.reason : `Manual paper ${action.toLowerCase()}`;
      const result = closePaperQuantity(state, position, qty, fillPrice, reason);
      if (action === "REDUCE_50" && state.positions[row.symbol]) {
        position.tookPartial = true;
        position.stopLoss = Math.max(position.stopLoss, position.entryPrice);
      }
      executed.push({
        symbol: row.symbol,
        action,
        qty,
        price: fillPrice,
        netPnlInr: result.netPnlInr,
        feeInr: result.fee,
        tdsInr: result.tds,
        reason,
      });
    } else {
      skipped.push({ symbol: row.symbol, action, reason: "Unknown action" });
    }
  }

  savePaperState();
  return { executed, skipped, portfolio: paperPortfolioView(marketResult.markets) };
}

function readJsonBody(request, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error("Request body too large");
        error.code = "INVALID_REQUEST";
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        const error = new Error("Request body must be valid JSON");
        error.code = "INVALID_REQUEST";
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendLiveGateError(response, error, fallbackMessage) {
  const status = Number.isInteger(Number(error?.status))
    ? Math.min(599, Math.max(400, Number(error.status)))
    : error?.code === "INVALID_REQUEST" ? 400 : 502;
  sendJson(response, status, {
    error: fallbackMessage,
    detail: error?.message || fallbackMessage,
    code: error?.code || "LIVE_GATE_FAILED",
    details: error?.details || null,
  });
}

function serveStatic(request, response) {
  const requestPath = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600",
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'self'; script-src 'self' https://cdn.jsdelivr.net; img-src 'self' data:; connect-src 'self'",
  );

  const routePath = request.url.split("?")[0];

  if (request.method === "POST" && routePath === "/api/trade/execute") {
    sendJson(response, 403, {
      error: "Live trading is locked in this dashboard.",
      detail:
        "No real orders were placed. The current implementation supports dry-run planning, paper trading and signal monitoring only.",
    });
    return;
  }

  if (request.method === "POST" && routePath === "/api/paper/execute") {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, await executePaper(body));
    } catch (error) {
      sendJson(response, error.code === "INVALID_REQUEST" ? 400 : 502, {
        error:
          error.code === "INVALID_REQUEST"
            ? "Invalid paper trade request."
            : "Paper execution is currently unavailable.",
        detail: error.message,
      });
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/session-momentum/paper/start") {
    try {
      await readJsonBody(request);
      await paperSessionMomentum.startSession({ mode: "paper" });
      await paperSessionMomentum.tick();
      sendJson(response, 200, await sessionMomentumPayload());
    } catch (error) {
      sendJson(response, error.code === "OPEN_POSITIONS_REMAIN" ? 409 : 400, {
        error: "Paper Session Momentum could not start.",
        detail: error.message,
      });
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/session-momentum/paper/renew") {
    try {
      await readJsonBody(request);
      await paperSessionMomentum.renewSession();
      sendJson(response, 200, await sessionMomentumPayload());
    } catch (error) {
      sendJson(response, error.code === "SESSION_NOT_RUNNING" ? 409 : 400, {
        error: "Paper session could not be renewed.",
        detail: error.message,
      });
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/session-momentum/paper/end") {
    try {
      await readJsonBody(request);
      await paperSessionMomentum.endSession({ reason: "SESSION_ENDED" });
      sendJson(response, 200, await sessionMomentumPayload());
    } catch (error) {
      sendJson(response, 502, {
        error: "Paper session close failed safely; any failed position remains tracked.",
        detail: error.message,
      });
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/session-momentum/live/preflight") {
    try {
      await readJsonBody(request);
      sendJson(response, 200, await liveSessionService.preflight());
    } catch (error) {
      sendLiveGateError(response, error, "Live balance preflight failed.");
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/session-momentum/live/prepare") {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, await liveSessionService.prepare({
        gateId: body.gateId,
        convertToInr: body.convertToInr,
      }));
    } catch (error) {
      sendLiveGateError(response, error, "Live balance choice failed.");
    }
    return;
  }

  if (request.method === "POST" &&
      routePath === "/api/session-momentum/live/approve-conversion") {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, await liveSessionService.approveConversion({ gateId: body.gateId }));
    } catch (error) {
      sendLiveGateError(response, error, "Conversion approval failed.");
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/session-momentum/live/start") {
    try {
      const body = await readJsonBody(request);
      const activation = await liveSessionService.start({
        gateId: body.gateId,
        confirmation: body.confirmation,
      });
      sendJson(response, 200, { ...(await sessionMomentumPayload()), activation });
    } catch (error) {
      sendLiveGateError(response, error, "Server-side live gate rejected the session.");
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/session-momentum/live/renew") {
    try {
      await readJsonBody(request);
      await liveSessionService.renew();
      sendJson(response, 200, await sessionMomentumPayload());
    } catch (error) {
      sendLiveGateError(response, error, "Live session could not be renewed.");
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/session-momentum/live/stop") {
    try {
      await readJsonBody(request);
      const killSwitch = await liveSessionService.stop();
      sendJson(response, 200, { ...(await sessionMomentumPayload()), killSwitch });
    } catch (error) {
      sendLiveGateError(response, error, "Kill switch could not verify every live position closed.");
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/session-momentum/backtest") {
    let started = false;
    try {
      const body = await readJsonBody(request);
      const window = beginBacktestRun("sessionMomentum", body);
      started = true;
      const result = await runSessionMomentumBacktest({
        from: window.fromMs,
        to: window.toMs,
        interval: body.interval === "15m" ? "15m" : "1h",
        sessionMinutes: Number(body.sessionMinutes) || 60,
        trailPct: Number(body.trailPct) || 6,
        leverage: Number(body.leverage) || 5,
        maxPositions: Number(body.maxPositions) || 2,
        smallCoinMaxHoldHours: Number(body.smallCoinMaxHoldHours) || 24,
        cooldownMinutes: Number(body.cooldownMinutes) || 30,
        minVolumeINR: Number(body.minVolumeINR) || 1_000_000,
        initialEquity: Number(body.equity) > 0 ? Number(body.equity) : 100_000,
        onLog: captureBacktestLine,
      });
      assertTradesInsideWindow(result, window);
      finishBacktestRun(result);
      sendJson(response, 200, result);
    } catch (error) {
      if (started) finishBacktestRun(null, error);
      sendJson(
        response,
        error.code === "BACKTEST_BUSY" ? 409 : error.code === "INVALID_REQUEST" ? 400 : 502,
        { error: "Session Momentum backtest failed.", detail: error.message },
      );
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/top-gainers/toggle") {
    try {
      const body = await readJsonBody(request);
      if (typeof body.enabled !== "boolean") {
        sendJson(response, 400, { error: "enabled must be true or false" });
        return;
      }
      sendJson(response, 200, body.enabled ? topGainersRunner.start() : topGainersRunner.stop());
    } catch (error) {
      sendJson(response, 400, { error: "Top-gainers toggle failed", detail: error.message });
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/top-gainers/reset") {
    if (process.env.NODE_ENV === "production") {
      sendJson(response, 403, { error: "Top-gainers reset is disabled in production" });
      return;
    }
    console.warn("[top-gainers] DEV RESET requested through the API");
    sendJson(response, 200, topGainersRunner.reset());
    return;
  }

  if (request.method === "POST" && routePath === "/api/top-gainers/backtest") {
    let started = false;
    try {
      const body = await readJsonBody(request);
      const window = beginBacktestRun("topGainers", body);
      started = true;
      const result = await runTopGainersBacktest({
        from: window.fromMs,
        to: window.toMs,
        minVolumeINR: Number(body.minVolumeINR) || 1_000_000,
        maxPositions: Number(body.maxPositions) || 15,
        trailPct: Number(body.trailPct) || 2,
        tpPct: Number(body.tpPct) || 50,
        initialEquity: Number(body.equity) > 0 ? Number(body.equity) : 100_000,
        onLog: captureBacktestLine,
      });
      assertTradesInsideWindow(result, window);
      finishBacktestRun(result);
      sendJson(response, 200, result);
    } catch (error) {
      if (started) finishBacktestRun(null, error);
      sendJson(response, error.code === "BACKTEST_BUSY" ? 409 : error.code === "INVALID_REQUEST" ? 400 : 502, {
        error: "Top-gainers backtest failed.",
        detail: error.message,
      });
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/backtest/cross-sectional") {
    let started = false;
    try {
      const body = await readJsonBody(request);
      const allowed = new Set(["csPrevious", "cs30ema", "cs60ema"]);
      const strategy = allowed.has(body.strategy) ? body.strategy : "csPrevious";
      const window = beginBacktestRun(strategy, body);
      started = true;
      const result = await runCrossSectionalForApi(strategy, body, window);
      assertTradesInsideWindow(result, window);
      finishBacktestRun(result);
      sendJson(response, 200, result);
    } catch (error) {
      if (started) finishBacktestRun(null, error);
      sendJson(response, error.code === "BACKTEST_BUSY" ? 409 : error.code === "INVALID_REQUEST" ? 400 : 502, {
        error: "Cross-sectional backtest failed.",
        detail: error.message,
      });
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/backtest/btc-hold") {
    let started = false;
    try {
      const body = await readJsonBody(request);
      const window = beginBacktestRun("btcHold", body);
      started = true;
      const result = await runBtcHoldForApi(body, window);
      assertTradesInsideWindow(result, window);
      finishBacktestRun(result);
      sendJson(response, 200, result);
    } catch (error) {
      if (started) finishBacktestRun(null, error);
      sendJson(response, error.code === "BACKTEST_BUSY" ? 409 : error.code === "INVALID_REQUEST" ? 400 : 502, {
        error: "BTC buy-and-hold backtest failed.",
        detail: error.message,
      });
    }
    return;
  }

  if (request.method === "POST" && routePath === "/api/backtest") {
    let started = false;
    try {
      const body = await readJsonBody(request);
      const window = beginBacktestRun("momentum4h", body);
      started = true;
      const result = await runBacktest({
        symbol: typeof body.symbol === "string" && body.symbol.trim() ? body.symbol.trim() : "I-BTC_INR",
        interval: typeof body.interval === "string" && body.interval.trim() ? body.interval.trim() : "4h",
        from: window.fromMs,
        to: window.toMs,
        initialEquity: Number(body.equity) > 0 ? Number(body.equity) : 100_000,
        riskPerTradePct:
          Number(body.riskPerTradePct) > 0 ? Number(body.riskPerTradePct) : risk.DEFAULT_RISK_PER_TRADE_PCT,
        params: body.params && typeof body.params === "object" ? body.params : {},
        onLog: backtestLog,
      });
      assertTradesInsideWindow(result, window);
      finishBacktestRun(result);
      sendJson(response, 200, result);
    } catch (error) {
      if (started) finishBacktestRun(null, error);
      const upstream = /HTTP \d|fetch|network|timeout|abort/i.test(error.message);
      sendJson(response, error.code === "BACKTEST_BUSY" ? 409 : error.code === "INVALID_REQUEST" ? 400 : upstream ? 502 : 400, {
        error: upstream
          ? "CoinDCX historical data is currently unavailable."
          : "Backtest request failed.",
        detail: error.message,
      });
    }
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (routePath === "/api/session-momentum/status") {
    try {
      sendJson(response, 200, await sessionMomentumPayload());
    } catch (error) {
      sendJson(response, 502, {
        error: "Session Momentum status is currently unavailable.",
        detail: error.message,
      });
    }
    return;
  }

  if (routePath === "/api/backtest/stream") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`retry: 2000\n\n`);
    const streamQuery = new URL(request.url, "http://localhost").searchParams;
    if (streamQuery.get("tail") !== "0") {
      for (const line of backtestRunState.lines.slice(-500)) {
        response.write(`data: ${JSON.stringify({ line, running: backtestRunState.running })}\n\n`);
      }
    }
    backtestStreamClients.add(response);
    const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
    keepAlive.unref?.();
    request.on("close", () => {
      clearInterval(keepAlive);
      backtestStreamClients.delete(response);
    });
    return;
  }

  if (routePath === "/api/top-gainers/universe") {
    try {
      const query = new URL(request.url, "http://localhost").searchParams;
      const config = topGainersRunner.config;
      const universe = await fetchQualifiedGainers({
        minVolumeINR: Number(query.get("minVolumeINR")) || config.minVolumeINR,
        maxPositions: Number(query.get("maxPositions")) || config.maxPositions,
      });
      const held = new Set(topGainersRunner.state.positions.map((position) => position.symbol));
      universe.rows = universe.rows.map((row) => ({
        ...row,
        held: held.has(row.market),
        cooldownUntil: Number(topGainersRunner.state.cooldowns[row.market]) || null,
      }));
      sendJson(response, 200, universe);
    } catch (error) {
      sendJson(response, 502, { error: "Top-gainers universe is currently unavailable", detail: error.message });
    }
    return;
  }

  if (routePath === "/api/top-gainers/positions") {
    try {
      sendJson(response, 200, { positions: await topGainersRunner.positionsView() });
    } catch (error) {
      sendJson(response, 502, { error: "Top-gainers positions are currently unavailable", detail: error.message });
    }
    return;
  }

  if (routePath === "/api/top-gainers/log") {
    const query = new URL(request.url, "http://localhost").searchParams;
    sendJson(response, 200, { log: topGainersRunner.log(Number(query.get("n")) || 200) });
    return;
  }

  if (routePath === "/api/top-gainers/status") {
    sendJson(response, 200, topGainersRunner.status());
    return;
  }

  if (routePath === "/api/candles") {
    try {
      const query = new URL(request.url, "http://localhost").searchParams;
      const symbol = (query.get("symbol") || "").trim();
      const interval = (query.get("interval") || "4h").trim();
      const limit = Math.min(Math.max(Number(query.get("limit")) || 500, 1), 1000);
      if (!symbol) {
        sendJson(response, 400, { error: "Missing required query parameter: symbol (e.g. I-BTC_INR)" });
        return;
      }
      const result = await getCandles(symbol, interval, limit);
      sendJson(response, 200, {
        symbol,
        interval,
        count: result.candles.length,
        stale: Boolean(result.stale),
        candles: result.candles,
      });
    } catch (error) {
      sendJson(response, error.code === "INVALID_REQUEST" ? 400 : 502, {
        error:
          error.code === "INVALID_REQUEST"
            ? "Invalid candles request."
            : "CoinDCX candle data is currently unavailable.",
        detail: error.message,
      });
    }
    return;
  }

  if (routePath === "/api/signals") {
    try {
      sendJson(response, 200, await getWatchlistSignals());
    } catch (error) {
      sendJson(response, 502, {
        error: "Momentum signals are currently unavailable.",
        detail: error.message,
      });
    }
    return;
  }

  if (routePath === "/api/ranking") {
    try {
      sendJson(response, 200, await getCrossSectionalRanking());
    } catch (error) {
      sendJson(response, 502, {
        error: "Cross-sectional ranking is currently unavailable.",
        detail: error.message,
      });
    }
    return;
  }

  if (routePath === "/api/positions/paper") {
    try {
      const marketResult = await getMarkets().catch(() => ({ markets: [] }));
      sendJson(response, 200, {
        watchlist: WATCHLIST,
        interval: SIGNAL_INTERVAL,
        ...paperPortfolioView(marketResult.markets),
      });
    } catch (error) {
      sendJson(response, 502, {
        error: "Paper portfolio is currently unavailable.",
        detail: error.message,
      });
    }
    return;
  }

  if (routePath === "/api/markets") {
    try {
      const result = await getMarkets();
      sendJson(response, 200, {
        ...result,
        updatedAt: tickerCache.fetchedAt,
      });
    } catch (error) {
      sendJson(response, 502, {
        error: "Live CoinDCX market data is currently unavailable.",
        detail: error.message,
      });
    }
    return;
  }

  if (routePath === "/api/account") {
    try {
      sendJson(response, 200, await getAccount());
    } catch (error) {
      const missingCredentials = error.code === "MISSING_CREDENTIALS";
      const authenticationFailed = error.code === "AUTH_FAILED";
      sendJson(response, missingCredentials ? 503 : authenticationFailed ? 401 : 502, {
        error: missingCredentials
          ? "CoinDCX credentials are not configured."
          : authenticationFailed
            ? "CoinDCX rejected the configured API credentials."
            : "CoinDCX account data is currently unavailable.",
        detail: error.message,
      });
    }
    return;
  }

  if (routePath === "/api/trade-plan") {
    try {
      sendJson(response, 200, await getTradePlan());
    } catch (error) {
      const missingCredentials = error.code === "MISSING_CREDENTIALS";
      const authenticationFailed = error.code === "AUTH_FAILED";
      sendJson(response, missingCredentials ? 503 : authenticationFailed ? 401 : 502, {
        error: missingCredentials
          ? "CoinDCX credentials are not configured."
          : authenticationFailed
            ? "CoinDCX rejected the configured API credentials."
            : "Trade plan is currently unavailable.",
        detail: error.message,
      });
    }
    return;
  }

  serveStatic(request, response);
});

server.listen(PORT, () => {
  console.log(`CoinDCX dashboard running at http://localhost:${PORT}`);
  if (topGainersRunner.config.enabled) topGainersRunner.start();
});
