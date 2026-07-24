// Walk-forward backtest of the momentum strategy on CoinDCX historical candles.
//
// No lookahead: indicators are causal (each value only uses candles up to its
// own index), signals are evaluated on the close of bar i and executed at the
// open of bar i+1, and stops/targets fill intrabar at their trigger price
// (or at the open when the bar gaps through the level).
//
// Costs modelled: 0.1% fee per side and 1% TDS withheld on every sell
// notional (Indian tax reality), both deducted from cash as they occur, so
// every reported return is net of costs.
//
// Entries are additionally gated by BTC's daily regime (see regime.js):
// new positions only open while regime === TREND_UP. Pass regimeFilter:
// false to disable and compare against the un-gated strategy.
//
// CLI usage:
//   node strategy/backtest.js --symbol I-BTC_INR --interval 4h --from 2025-07-01 --to 2026-07-01
//   node strategy/backtest.js --symbol I-BTC_INR --regime false   (regime filter off)
//   node strategy/backtest.js --sweep --symbols I-BTC_INR,I-ETH_INR --intervals 1h,4h,1d
//                                                (delegates to sweep.js)

const fs = require("node:fs");
const path = require("node:path");

const {
  computeIndicators,
  evaluateSignalAt,
  requiredHistory,
  DEFAULT_PARAMS,
} = require("./momentum");
const risk = require("./risk");
const regimeModule = require("./regime");
const {
  saveCandles,
  getCandles: getStoredCandles,
  saveBacktest,
} = require("../database");

const PUBLIC_MARKET_API = "https://public.coindcx.com";
const MAX_CANDLE_PAGES = 30;
const MIN_ORDER_NOTIONAL_INR = 100;

const INTERVAL_MS = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

// The public candles API only serves these interval tokens (verified against
// the live API); everything else is built by aggregating a finer interval.
const NATIVE_INTERVALS = new Set(["1m", "15m", "1h", "1d"]);
const AGGREGATE_SOURCE = {
  "5m": "1m",
  "30m": "15m",
  "2h": "1h",
  "4h": "1h",
  "6h": "1h",
  "8h": "1h",
  "3d": "1d",
  "1w": "1d",
};

// Roll fine candles up into fixed epoch-aligned buckets: first open, max
// high, min low, last close, summed volume. Input must be ascending.
function aggregateCandles(candles, targetMs) {
  const buckets = new Map();
  for (const candle of candles) {
    const bucketTime = Math.floor(candle.time / targetMs) * targetMs;
    const bucket = buckets.get(bucketTime);
    if (!bucket) {
      buckets.set(bucketTime, { ...candle, time: bucketTime });
    } else {
      bucket.high = Math.max(bucket.high, candle.high);
      bucket.low = Math.min(bucket.low, candle.low);
      bucket.close = candle.close;
      bucket.volume += candle.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

async function fetchJsonWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "coindcx-market-dashboard/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`CoinDCX returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

function normalizeCandle(raw) {
  const candle = {
    time: Number(raw.time),
    open: Number(raw.open),
    high: Number(raw.high),
    low: Number(raw.low),
    close: Number(raw.close),
    volume: Number(raw.volume) || 0,
  };
  const valid =
    Number.isFinite(candle.time) &&
    [candle.open, candle.high, candle.low, candle.close].every(
      (value) => Number.isFinite(value) && value > 0,
    );
  return valid ? candle : null;
}

let marketDetailsCache = null;

// Map whatever the caller sent (I-BTC_INR, B-BTC_INR, BTCINR) onto the pair
// name the public candles API actually accepts. INR markets use the I- prefix.
async function resolveCandlePair(symbol) {
  const requested = String(symbol || "").trim();
  try {
    if (!marketDetailsCache) {
      marketDetailsCache = await fetchJsonWithRetry(
        "https://api.coindcx.com/exchange/v1/markets_details",
      );
    }
    const upper = requested.toUpperCase();
    const exact = marketDetailsCache.find(
      (item) => item.pair === requested || item.coindcx_name === upper,
    );
    if (exact?.pair) return exact.pair;

    const suffix = upper.match(/^[A-Z]+-(.+)$/);
    if (suffix) {
      const bySuffix = marketDetailsCache.find((item) => item.pair?.endsWith(`-${suffix[1]}`));
      if (bySuffix?.pair) return bySuffix.pair;
    }
  } catch {
    // markets_details unavailable — try the symbol as-is
  }
  return requested;
}

async function downloadCandleRange(pair, nativeInterval, interval, intervalMs, fromMs, toMs) {
  const collected = new Map();
  let endTime = toMs;

  for (let page = 0; page < MAX_CANDLE_PAGES; page += 1) {
    const url =
      `${PUBLIC_MARKET_API}/market_data/candles?pair=${encodeURIComponent(pair)}` +
      `&interval=${encodeURIComponent(nativeInterval)}&startTime=${fromMs}&endTime=${endTime}&limit=1000`;
    const batch = await fetchJsonWithRetry(url);
    if (!Array.isArray(batch) || batch.length === 0) break;

    let oldest = Infinity;
    for (const raw of batch) {
      const candle = normalizeCandle(raw);
      if (!candle) continue;
      collected.set(candle.time, candle);
      if (candle.time < oldest) oldest = candle.time;
    }

    if (!Number.isFinite(oldest) || oldest <= fromMs || batch.length < 1000) break;
    endTime = oldest - 1;
  }

  const candles = [...collected.values()]
    .filter((candle) => candle.time >= fromMs && candle.time <= toMs)
    .sort((a, b) => a.time - b.time);

  return nativeInterval === interval ? candles : aggregateCandles(candles, intervalMs);
}

function findMissingCandleRanges(candles, intervalMs, fromMs, toMs, includePartialFirst) {
  const firstTimestamp = (includePartialFirst ? Math.floor : Math.ceil)(fromMs / intervalMs) * intervalMs;
  const lastTimestamp = Math.floor(toMs / intervalMs) * intervalMs;
  if (firstTimestamp > lastTimestamp) return [];

  const storedTimestamps = new Set(candles.map((candle) => candle.time));
  const currentBucket = Math.floor(Date.now() / intervalMs) * intervalMs;
  const ranges = [];
  let missingFrom = null;
  let missingTo = null;

  for (let timestamp = firstTimestamp; timestamp <= lastTimestamp; timestamp += intervalMs) {
    // The current bucket may have changed since it was stored, so refresh it
    // until it becomes a closed historical candle.
    const isForming = timestamp === currentBucket && timestamp + intervalMs > Date.now();
    if (!storedTimestamps.has(timestamp) || isForming) {
      if (missingFrom === null) missingFrom = timestamp;
      missingTo = timestamp;
    } else if (missingFrom !== null) {
      ranges.push([missingFrom, Math.min(missingTo + intervalMs - 1, toMs)]);
      missingFrom = null;
      missingTo = null;
    }
  }

  if (missingFrom !== null) {
    ranges.push([missingFrom, Math.min(missingTo + intervalMs - 1, toMs)]);
  }
  return ranges;
}

// Read SQLite first, then page backwards through CoinDCX only for gaps in the
// requested window. Non-native intervals (e.g. 4h) are still aggregated from
// a finer native interval before being saved under the requested interval.
async function fetchHistoricalCandles(symbol, interval, fromMs, toMs) {
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) {
    throw new Error(`Unsupported interval "${interval}". Use one of: ${Object.keys(INTERVAL_MS).join(", ")}`);
  }
  const nativeInterval = NATIVE_INTERVALS.has(interval) ? interval : AGGREGATE_SOURCE[interval];
  if (!nativeInterval) {
    throw new Error(`Interval "${interval}" cannot be served by the CoinDCX candles API`);
  }

  const pair = await resolveCandlePair(symbol);
  const includePartialFirst = nativeInterval !== interval;
  const storedFrom = (includePartialFirst ? Math.floor : Math.ceil)(fromMs / intervalMs) * intervalMs;
  const storedTo = Math.floor(toMs / intervalMs) * intervalMs;
  const stored = getStoredCandles(pair, interval, { from: storedFrom, to: storedTo });
  const missingRanges = findMissingCandleRanges(
    stored,
    intervalMs,
    fromMs,
    toMs,
    includePartialFirst,
  );
  const candlesByTime = new Map(stored.map((candle) => [candle.time, candle]));

  for (const [missingFrom, missingTo] of missingRanges) {
    const downloadFrom = Math.max(fromMs, missingFrom);
    const downloaded = await downloadCandleRange(
      pair,
      nativeInterval,
      interval,
      intervalMs,
      downloadFrom,
      missingTo,
    );
    saveCandles(pair, interval, downloaded);
    for (const candle of downloaded) candlesByTime.set(candle.time, candle);
  }

  return [...candlesByTime.values()]
    .filter((candle) => candle.time >= storedFrom && candle.time <= storedTo)
    .sort((a, b) => a.time - b.time);
}

function toMillis(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Cannot parse date "${value}"`);
  return parsed;
}

async function runBacktest({
  symbol = "I-BTC_INR",
  interval = "4h",
  from,
  to,
  params = {},
  initialEquity = 100_000,
  riskPerTradePct = risk.DEFAULT_RISK_PER_TRADE_PCT,
  feePct = risk.DEFAULT_FEE_PCT,
  tdsPct = risk.TDS_PCT,
  candles = null, // inject pre-fetched candles to skip the network
  regimeFilter = true, // gate entries on BTC's daily regime (see regime.js)
  regimeCandles = null, // inject pre-fetched BTC daily candles to skip the network
  onLog = null,
} = {}) {
  const intervalMs = INTERVAL_MS[interval];
  if (!intervalMs) throw new Error(`Unsupported interval "${interval}"`);

  const toMs = toMillis(to, Date.now());
  const fromMs = toMillis(from, toMs - 365 * 86_400_000);
  if (fromMs >= toMs) throw new Error("`from` must be before `to`");

  const mergedParams = { ...DEFAULT_PARAMS, ...params };
  const emit = (message) => {
    if (typeof onLog === "function") onLog(message);
  };
  emit(`Fetching candles...`);
  let series = candles || (await fetchHistoricalCandles(symbol, interval, fromMs, toMs));

  // Drop the still-forming candle so signals only ever see closed bars.
  if (series.length > 0 && series.at(-1).time + intervalMs > Date.now()) {
    series = series.slice(0, -1);
  }

  emit(
    `Received ${series.length} candles, first=${series.length ? new Date(series[0].time).toISOString() : "n/a"}, last=${series.length ? new Date(series.at(-1).time).toISOString() : "n/a"}`,
  );

  const warmup = requiredHistory(mergedParams);
  if (series.length < warmup + 10) {
    throw new Error(
      `Not enough candles for ${symbol} ${interval}: got ${series.length}, need at least ${warmup + 10}. Widen the date range.`,
    );
  }
  emit(`Warmup complete at index ${warmup}`);

  const indicators = computeIndicators(series, mergedParams);

  // Regime series aligned onto `series` (null until it fails safe to blocking
  // entries — see the loop below). Fetches BTC's own daily candles with a
  // warmup buffer before `fromMs` so EMA(200)/ADX(14) are defined by the
  // time the backtest window starts.
  let alignedRegime = null;
  let regimeCoverage = { trendUp: 0, trendDown: 0, range: 0, unknown: 0 };
  if (regimeFilter) {
    const regimeWarmupMs = (regimeModule.requiredRegimeHistory() + 5) * 86_400_000;
    const dailyCandles =
      regimeCandles ||
      (await fetchHistoricalCandles(
        regimeModule.REGIME_BENCHMARK_SYMBOL,
        "1d",
        fromMs - regimeWarmupMs,
        toMs,
      ));
    const regimeSeries = regimeModule.computeRegimeSeries(dailyCandles);
    alignedRegime = regimeModule.alignDailyRegime(series, dailyCandles, regimeSeries);
    for (const value of alignedRegime) {
      if (value === "TREND_UP") regimeCoverage.trendUp += 1;
      else if (value === "TREND_DOWN") regimeCoverage.trendDown += 1;
      else if (value === "RANGE") regimeCoverage.range += 1;
      else regimeCoverage.unknown += 1;
    }
  }

  let cash = initialEquity;
  let position = null;
  let tradeCounter = 0;
  let totalFees = 0;
  let totalTds = 0;
  let totalNotional = 0;
  const legs = [];
  const equityCurve = [];

  function sellLeg(qty, price, time, reason, kind) {
    const notional = qty * price;
    const fee = (notional * feePct) / 100;
    const tds = (notional * tdsPct) / 100;
    const entryFeeShare = position.entryFee * (qty / position.initialQty);
    const netPnl = notional - fee - tds - qty * position.entryPrice - entryFeeShare;

    cash += notional - fee - tds;
    totalFees += fee;
    totalTds += tds;
    totalNotional += notional;

    legs.push({
      tradeId: position.id,
      symbol,
      kind, // "partial" | "final"
      qty,
      initialQty: position.initialQty,
      riskPerUnitInr: position.riskPerUnit,
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      exitTime: time,
      exitPrice: price,
      grossPnlInr: notional - qty * position.entryPrice,
      feesInr: fee + entryFeeShare,
      tdsInr: tds,
      netPnlInr: netPnl,
      rMultiple: position.riskPerUnit * qty > 0 ? netPnl / (position.riskPerUnit * qty) : null,
      reason,
    });
    emit(`SELL ${symbol} at price ${price}, reason ${reason}, netR=${position.riskPerUnit * qty > 0 ? (netPnl / (position.riskPerUnit * qty)).toFixed(3) : "n/a"}`);
  }

  for (let i = warmup; i < series.length; i += 1) {
    const candle = series[i];

    // 1. Intrabar management of an open position. Conservative ordering:
    //    when both the stop and the partial target sit inside one bar,
    //    assume the stop fills first.
    if (position && candle.low <= position.stopLoss) {
      const fill = candle.open < position.stopLoss ? candle.open : position.stopLoss;
      const reason =
        position.stopLoss <= position.initialStop
          ? "Hard stop hit"
          : position.tookPartial && position.stopLoss <= position.entryPrice
            ? "Breakeven stop hit"
            : "Trailing stop hit";
      sellLeg(position.qty, fill, candle.time, reason, "final");
      position = null;
    } else if (position && !position.tookPartial && candle.high >= position.partialTarget) {
      const half = position.qty / 2;
      const fill = candle.open > position.partialTarget ? candle.open : position.partialTarget;
      sellLeg(half, fill, candle.time, `Partial take-profit at +${mergedParams.partialTakeR}R`, "partial");
      position.qty -= half;
      position.tookPartial = true;
      position.stopLoss = Math.max(position.stopLoss, position.entryPrice);
    }

    if (position) {
      position.highestClose = Math.max(position.highestClose, candle.close);
    }

    // 2. Signal on this bar's close, executed at the next bar's open.
    if (i + 1 < series.length) {
      const next = series[i + 1];
      // Unknown regime (insufficient BTC daily history at this point) fails
      // safe to RANGE — i.e. no new entries — rather than bypassing the gate.
      const regimeAtBar = regimeFilter ? alignedRegime[i] || "RANGE" : false;
      const signal = evaluateSignalAt(series, indicators, i, position, mergedParams, regimeAtBar);

      if (!position && signal.action === "BUY" && signal.stopLoss < next.open) {
        const size = risk.positionSize({
          equity: cash,
          riskPerTradePct,
          entry: next.open,
          stopLoss: signal.stopLoss,
          feePct,
        });
        const qty = Math.min(size.qty || 0, cash / (next.open * (1 + feePct / 100)));
        const notional = qty * next.open;

        if (qty > 0 && notional >= MIN_ORDER_NOTIONAL_INR) {
          const fee = (notional * feePct) / 100;
          cash -= notional + fee;
          totalFees += fee;
          totalNotional += notional;
          tradeCounter += 1;

          const riskPerUnit = next.open - signal.stopLoss;
          position = {
            id: tradeCounter,
            entryTime: next.time,
            entryPrice: next.open,
            qty,
            initialQty: qty,
            entryFee: fee,
            stopLoss: signal.stopLoss,
            initialStop: signal.stopLoss,
            riskPerUnit,
            partialTarget: next.open + mergedParams.partialTakeR * riskPerUnit,
            highestClose: next.open,
            tookPartial: false,
          };
          emit(`BUY ${symbol} at price ${next.open}, stop ${signal.stopLoss}, TP ${position.partialTarget}`);
        }
      } else if (position && signal.action === "SELL") {
        sellLeg(position.qty, next.open, next.time, signal.reason, "final");
        position = null;
      } else if (position && signal.action === "REDUCE_50" && !position.tookPartial) {
        const half = position.qty / 2;
        sellLeg(half, next.open, next.time, signal.reason, "partial");
        position.qty -= half;
        position.tookPartial = true;
        position.stopLoss = Math.max(position.stopLoss, position.entryPrice);
      } else if (position && Number.isFinite(signal.stopLoss)) {
        // Ratchet the trailing stop upward, never down.
        const previousStop = position.stopLoss;
        position.stopLoss = Math.max(position.stopLoss, signal.stopLoss);
        if (position.stopLoss > previousStop) {
          emit(`Stop raised: ${symbol} stop was ${previousStop}, now ${position.stopLoss}`);
        }
      }
    }

    equityCurve.push({
      time: candle.time,
      equity: cash + (position ? position.qty * candle.close : 0),
    });
  }

  // Flatten any open position at the final close so accounting is complete.
  if (position) {
    const last = series.at(-1);
    sellLeg(position.qty, last.close, last.time, "Backtest end (forced close)", "final");
    position = null;
    equityCurve[equityCurve.length - 1].equity = cash;
  }

  const regimeBarCount = alignedRegime?.length || 0;
  const regime = regimeFilter
    ? {
        benchmark: regimeModule.REGIME_BENCHMARK_SYMBOL,
        trendUpPct: regimeBarCount > 0 ? (regimeCoverage.trendUp / regimeBarCount) * 100 : null,
        trendDownPct: regimeBarCount > 0 ? (regimeCoverage.trendDown / regimeBarCount) * 100 : null,
        rangePct: regimeBarCount > 0 ? (regimeCoverage.range / regimeBarCount) * 100 : null,
        unknownPct: regimeBarCount > 0 ? (regimeCoverage.unknown / regimeBarCount) * 100 : null,
      }
    : null;

  const result = {
    symbol,
    interval,
    from: fromMs,
    to: toMs,
    params: mergedParams,
    initialEquity,
    riskPerTradePct,
    feePct,
    tdsPct,
    regimeFilter,
    regime,
    candleCount: series.length,
    candleRange: {
      first: series[0]?.time ?? null,
      last: series.at(-1)?.time ?? null,
    },
    summary: buildSummary({ equityCurve, legs, initialEquity, intervalMs, totalFees, totalTds, totalNotional }),
    trades: legs,
    equityCurve,
  };

  saveBacktest({
    strategy_name: "momentum",
    symbol,
    interval,
    from_date: fromMs,
    to_date: toMs,
    net_return: result.summary.netReturnPct,
    gross_return: result.summary.grossReturnPct,
    sharpe: result.summary.sharpe,
    max_drawdown: result.summary.maxDrawdownPct,
    win_rate: result.summary.winRatePct,
    total_trades: result.summary.tradeCount,
    created_at: Date.now(),
  });

  return result;
}

function buildSummary({ equityCurve, legs, initialEquity, intervalMs, totalFees, totalTds, totalNotional }) {
  const finalEquity = equityCurve.length > 0 ? equityCurve.at(-1).equity : initialEquity;
  const days =
    equityCurve.length > 1
      ? (equityCurve.at(-1).time - equityCurve[0].time) / 86_400_000
      : 0;
  const growth = finalEquity / initialEquity;

  // Sharpe from per-bar equity returns, annualized for a 24/7 market.
  const barReturns = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    if (equityCurve[i - 1].equity > 0) {
      barReturns.push(equityCurve[i].equity / equityCurve[i - 1].equity - 1);
    }
  }
  const mean = barReturns.length > 0
    ? barReturns.reduce((sum, value) => sum + value, 0) / barReturns.length
    : 0;
  const variance = barReturns.length > 1
    ? barReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (barReturns.length - 1)
    : 0;
  const std = Math.sqrt(variance);
  const barsPerYear = (365 * 86_400_000) / intervalMs;

  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }

  // Aggregate partial + final legs into whole trades for win rate / avg R.
  // A trade's R multiple is its total net P&L over the risk taken at entry
  // (riskPerUnit * initialQty), so a straight stop-out scores ≈ -1R.
  const tradesById = new Map();
  for (const leg of legs) {
    const trade = tradesById.get(leg.tradeId) || {
      netPnlInr: 0,
      initialRiskInr: leg.riskPerUnitInr * leg.initialQty,
    };
    trade.netPnlInr += leg.netPnlInr;
    tradesById.set(leg.tradeId, trade);
  }
  const tradeResults = [...tradesById.values()].map((trade) => ({
    netPnlInr: trade.netPnlInr,
    rMultiple: trade.initialRiskInr > 0 ? trade.netPnlInr / trade.initialRiskInr : null,
  }));

  const wins = tradeResults.filter((trade) => trade.netPnlInr > 0).length;
  const rMultiples = tradeResults
    .map((trade) => trade.rMultiple)
    .filter((value) => Number.isFinite(value));

  return {
    finalEquityInr: finalEquity,
    netReturnPct: (growth - 1) * 100, // effective return AFTER fees + TDS
    grossReturnPct: ((finalEquity + totalFees + totalTds) / initialEquity - 1) * 100,
    cagrPct: days > 0 ? (growth ** (365 / days) - 1) * 100 : null,
    sharpe: std > 0 ? (mean / std) * Math.sqrt(barsPerYear) : null,
    maxDrawdownPct,
    tradeCount: tradeResults.length,
    winRatePct: tradeResults.length > 0 ? (wins / tradeResults.length) * 100 : null,
    avgRMultiple:
      rMultiples.length > 0
        ? rMultiples.reduce((sum, value) => sum + value, 0) / rMultiples.length
        : null,
    turnover: totalNotional / initialEquity,
    totalFeesInr: totalFees,
    totalTdsInr: totalTds,
    durationDays: days,
  };
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function printSummary(result) {
  const summary = result.summary;
  const lines = [
    `Backtest ${result.symbol} ${result.interval}  ` +
      `${new Date(result.from).toISOString().slice(0, 10)} → ${new Date(result.to).toISOString().slice(0, 10)}  ` +
      `(${result.candleCount} candles)`,
    `Initial equity   ₹${formatNumber(result.initialEquity)}   risk/trade ${result.riskPerTradePct}%   fee ${result.feePct}%/side   TDS ${result.tdsPct}% on sells`,
    result.regimeFilter
      ? `Regime filter    ON (${result.regime.benchmark}) — TREND_UP ${formatNumber(result.regime.trendUpPct, 1)}%   TREND_DOWN ${formatNumber(result.regime.trendDownPct, 1)}%   RANGE ${formatNumber(result.regime.rangePct, 1)}%`
      : `Regime filter    OFF`,
    "",
    `Final equity     ₹${formatNumber(summary.finalEquityInr)}`,
    `Net return       ${formatNumber(summary.netReturnPct)}%  (gross before costs: ${formatNumber(summary.grossReturnPct)}%)`,
    `CAGR             ${formatNumber(summary.cagrPct)}%`,
    `Sharpe           ${formatNumber(summary.sharpe)}`,
    `Max drawdown     ${formatNumber(summary.maxDrawdownPct)}%`,
    `Trades           ${summary.tradeCount}   win rate ${formatNumber(summary.winRatePct, 1)}%   avg R ${formatNumber(summary.avgRMultiple)}`,
    `Turnover         ${formatNumber(summary.turnover)}x of initial equity`,
    `Fees paid        ₹${formatNumber(summary.totalFeesInr)}   TDS withheld ₹${formatNumber(summary.totalTdsInr)}`,
  ];
  console.log(lines.join("\n"));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")
        ? argv[(i += 1)]
        : true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // `--sweep` delegates to the symbol × timeframe matrix runner in sweep.js
  // rather than a single backtest.
  if (args.sweep) {
    return require("./sweep").main(process.argv.slice(2));
  }

  const result = await runBacktest({
    symbol: args.symbol || "I-BTC_INR",
    interval: args.interval || "4h",
    from: args.from,
    to: args.to,
    initialEquity: Number(args.equity) || 100_000,
    riskPerTradePct: Number(args.risk) || risk.DEFAULT_RISK_PER_TRADE_PCT,
    regimeFilter: args.regime !== "false",
  });

  printSummary(result);

  const outDir = path.join(__dirname, "..", "backtest-results");
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = `${result.symbol.replaceAll("/", "_")}-${result.interval}-${Date.now()}.json`;
  const outFile = path.join(outDir, fileName);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`\nEquity curve and trade log written to ${outFile}`);
}

// Export before invoking main. The --sweep path loads sweep.js, which imports
// runBacktest from this module; publishing the API first prevents CommonJS
// from exposing a half-initialized module during that intentional cycle.
module.exports = {
  runBacktest,
  fetchHistoricalCandles,
  aggregateCandles,
  resolveCandlePair,
  parseArgs,
  toMillis,
  INTERVAL_MS,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Backtest failed: ${error.message}`);
    process.exit(1);
  });
}
