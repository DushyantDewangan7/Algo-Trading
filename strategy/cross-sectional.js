// Cross-sectional momentum: rank the watchlist by risk-adjusted trailing
// return and hold the top N equal-weight — but only while BTC's regime
// (see regime.js) is TREND_UP. Outside TREND_UP the portfolio is 100% cash:
// relative-strength picking has no edge when the whole market is chopping
// or falling together, so there is nothing to rotate into.
//
// CLI usage (backtest):
//   node strategy/cross-sectional.js --from 2025-10-01 --to 2026-07-15
//   node strategy/cross-sectional.js --symbols I-BTC_INR,I-ETH_INR --topN 2 --lookback 30

const fs = require("node:fs");
const path = require("node:path");

const { fetchHistoricalCandles, parseArgs, toMillis, INTERVAL_MS } = require("./backtest");
const regimeModule = require("./regime");
const { ema } = require("./indicators");
const risk = require("./risk");
const { saveBacktest } = require("../database");

const DEFAULT_SYMBOLS = ["I-BTC_INR", "I-ETH_INR", "I-SOL_INR", "I-BNB_INR", "I-XRP_INR"];
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_TOP_N = 2;
const DEFAULT_REBALANCE_WEEKS = 2;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const REBALANCE_ANCHOR_MS = Date.UTC(1970, 0, 4, 18, 30); // Monday 00:00 IST
const EXECUTION_INTERVAL = "30m";
const EXECUTION_MS = INTERVAL_MS[EXECUTION_INTERVAL];
const MIN_ORDER_NOTIONAL_INR = 100;
const MOMENTUM_METRIC = {
  TOTAL_RETURN: "total-return",
  RISK_ADJUSTED: "risk-adjusted",
};
const REGIME_FILTER_MODE = {
  EMA_ONLY: "ema-only",
  EMA_ADX: "ema-adx",
};

const PREVIOUS_VERSION_OPTIONS = Object.freeze({
  lookbackDays: 30,
  topN: 2,
  momentumMetric: MOMENTUM_METRIC.RISK_ADJUSTED,
  regimeFilterMode: REGIME_FILTER_MODE.EMA_ADX,
  rebalanceEveryWeeks: 1,
  skipUnchangedHoldings: false,
  requirePositiveMomentum: true,
});

// Risk-adjusted momentum score: mean daily return ÷ stdev of daily returns
// over the lookback window (a Sharpe ratio of the trailing window, up to a
// scale constant that's the same for every symbol so it doesn't affect
// ranking). This favours steady climbers over a coin that pumped once on
// day 3 and has been chopping sideways since — which a plain % return
// ranking would rate identically to a coin that climbed steadily.
function computeRiskAdjustedMomentumScore(dailyCandles, lookbackDays) {
  if (!Array.isArray(dailyCandles) || dailyCandles.length < lookbackDays + 1) return null;
  const window = dailyCandles.slice(-(lookbackDays + 1));
  const returns = [];
  for (let i = 1; i < window.length; i += 1) {
    if (window[i - 1].close > 0) returns.push(window[i].close / window[i - 1].close - 1);
  }
  if (returns.length === 0) return null;

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.length > 1
      ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
      : 0;
  const std = Math.sqrt(variance);
  return mean / (std + 1e-9); // epsilon guards a near-zero-vol window without producing Infinity
}

// Plain trailing price return. This is the requested cross-sectional signal:
// rank solely by how much each asset gained over the lookback window.
function computeTrailingReturn(dailyCandles, lookbackDays) {
  if (!Array.isArray(dailyCandles) || dailyCandles.length < lookbackDays + 1) return null;
  const start = dailyCandles.at(-(lookbackDays + 1))?.close;
  const end = dailyCandles.at(-1)?.close;
  if (!(start > 0) || !Number.isFinite(end)) return null;
  return end / start - 1;
}

function computeMomentumScore(
  dailyCandles,
  lookbackDays,
  momentumMetric = MOMENTUM_METRIC.RISK_ADJUSTED,
) {
  if (momentumMetric === MOMENTUM_METRIC.TOTAL_RETURN) {
    return computeTrailingReturn(dailyCandles, lookbackDays);
  }
  if (momentumMetric === MOMENTUM_METRIC.RISK_ADJUSTED) {
    return computeRiskAdjustedMomentumScore(dailyCandles, lookbackDays);
  }
  throw new Error(`Unsupported momentum metric "${momentumMetric}"`);
}

// Rank the watchlist and decide which symbols to hold this week.
//
// candlesBySymbol: { symbol: dailyCandles[] } — ascending, closed candles.
// regime: a value from regime.js's getRegime()/computeRegimeSeries(); when
// it is anything other than TREND_UP every weight is forced to 0 (100%
// cash), but the ranking itself is still returned so callers (dashboard,
// backtest) can show "who would have won" even while sitting in cash.
function rankAndSelect({
  candlesBySymbol,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  topN = DEFAULT_TOP_N,
  regime = null,
  momentumMetric = MOMENTUM_METRIC.RISK_ADJUSTED,
  requirePositiveMomentum = true,
} = {}) {
  const scored = Object.entries(candlesBySymbol || {})
    .map(([symbol, candles]) => ({
      symbol,
      score: computeMomentumScore(candles, lookbackDays, momentumMetric),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);

  const inCash = regime !== null && regime !== regimeModule.REGIME.TREND_UP;
  const selectedSymbols = inCash
    ? new Set()
    : new Set(
        scored
          .filter((item) => !requirePositiveMomentum || item.score > 0)
          .slice(0, topN)
          .map((item) => item.symbol),
      );
  // Fixed 1/topN per filled slot — not 1/selectedSymbols.size. If only one
  // symbol has positive momentum this week, it gets one slot's worth (e.g.
  // 50% with topN=2), and the other slot stays in cash. Resizing the winner
  // up to fill unclaimed slots would turn "top-2 equal-weight" into
  // "top-1 concentrated" exactly when fewer names qualify — the opposite of
  // what equal-weighting is supposed to protect against.
  const weight = selectedSymbols.size > 0 ? 1 / topN : 0;

  return scored.map((item) => ({
    ...item,
    selected: selectedSymbols.has(item.symbol),
    weight: selectedSymbols.has(item.symbol) ? weight : 0,
  }));
}

// Cross-sectional-only regime gate. It deliberately does not call classify()
// in regime.js, because that shared classifier includes ADX and remains the
// unchanged gate for the existing momentum strategy.
function computeEmaRegimeSeries(dailyCandles) {
  if (!Array.isArray(dailyCandles) || dailyCandles.length === 0) return [];
  const closes = dailyCandles.map((candle) => candle.close);
  const emaFast = ema(closes, regimeModule.EMA_FAST_PERIOD);
  const emaSlow = ema(closes, regimeModule.EMA_SLOW_PERIOD);
  return dailyCandles.map((_, index) => {
    if (emaFast[index] === null || emaSlow[index] === null) return null;
    return emaFast[index] > emaSlow[index]
      ? regimeModule.REGIME.TREND_UP
      : regimeModule.REGIME.TREND_DOWN;
  });
}

function getEmaRegime(dailyCandles) {
  const series = computeEmaRegimeSeries(dailyCandles);
  return series.length > 0 ? series.at(-1) : null;
}

function requiredEmaRegimeHistory() {
  return regimeModule.EMA_SLOW_PERIOD + 5;
}

// Monday 00:00 IST is Sunday 18:30 UTC. Keep the rebalance timestamps
// explicit so a UTC-midnight daily candle cannot silently move execution
// five and a half hours late.
function latestRebalanceAt(time = Date.now(), rebalanceEveryWeeks = 1) {
  if (!Number.isInteger(rebalanceEveryWeeks) || rebalanceEveryWeeks < 1) {
    throw new Error("rebalanceEveryWeeks must be a positive integer");
  }
  const local = new Date(time + IST_OFFSET_MS);
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const latestMonday = localMidnight - daysSinceMonday * DAY_MS - IST_OFFSET_MS;
  const weeksSinceAnchor = Math.floor((latestMonday - REBALANCE_ANCHOR_MS) / WEEK_MS);
  const periodIndex = Math.floor(weeksSinceAnchor / rebalanceEveryWeeks);
  return REBALANCE_ANCHOR_MS + periodIndex * rebalanceEveryWeeks * WEEK_MS;
}

function rebalanceTimesBetween(fromMs, toMs, rebalanceEveryWeeks = 1) {
  let cursor = latestRebalanceAt(fromMs, rebalanceEveryWeeks);
  const intervalMs = rebalanceEveryWeeks * WEEK_MS;
  if (cursor < fromMs) cursor += intervalMs;
  const times = [];
  while (cursor <= toMs) {
    times.push(cursor);
    cursor += intervalMs;
  }
  return times;
}

function isRebalanceCandle(candle, rebalanceEveryWeeks = 1) {
  if (!candle || !Number.isFinite(candle.time)) return false;
  const local = new Date(candle.time + IST_OFFSET_MS);
  return (
    local.getUTCDay() === 1 &&
    local.getUTCHours() === 0 &&
    local.getUTCMinutes() === 0 &&
    local.getUTCSeconds() === 0 &&
    latestRebalanceAt(candle.time, rebalanceEveryWeeks) === candle.time
  );
}

function candlesClosedBy(candles, time) {
  return (candles || []).filter((candle) => candle.time + DAY_MS <= time);
}

function lastClosedDailyIndex(candles, time) {
  let low = 0;
  let high = candles.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (candles[mid].time + DAY_MS <= time) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

// Walk-forward backtest using closed daily candles for ranking/regime and
// 30-minute candles for exact Monday 00:00 IST fills. The experiment defaults
// to 30-day total return, EMA-only BTC regime, and a two-week schedule.
async function runCrossSectionalBacktest({
  symbols = DEFAULT_SYMBOLS,
  from,
  to,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  topN = DEFAULT_TOP_N,
  initialEquity = 100_000,
  feePct = risk.DEFAULT_FEE_PCT,
  tdsPct = risk.TDS_PCT,
  momentumMetric = MOMENTUM_METRIC.TOTAL_RETURN,
  regimeFilterMode = REGIME_FILTER_MODE.EMA_ONLY,
  rebalanceEveryWeeks = DEFAULT_REBALANCE_WEEKS,
  skipUnchangedHoldings = true,
  requirePositiveMomentum = false,
  candlesBySymbol = null, // inject pre-fetched { symbol: dailyCandles[] } to skip the network
  regimeCandles = null, // inject pre-fetched BTC daily candles to skip the network
  executionCandlesBySymbol = null, // inject 30m candles for exact Monday 00:00 IST fills
} = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new Error("symbols must be a non-empty array");
  }
  if (!Object.values(MOMENTUM_METRIC).includes(momentumMetric)) {
    throw new Error(`Unsupported momentumMetric "${momentumMetric}"`);
  }
  if (!Object.values(REGIME_FILTER_MODE).includes(regimeFilterMode)) {
    throw new Error(`Unsupported regimeFilterMode "${regimeFilterMode}"`);
  }
  if (!Number.isInteger(rebalanceEveryWeeks) || rebalanceEveryWeeks < 1) {
    throw new Error("rebalanceEveryWeeks must be a positive integer");
  }

  const toMs = toMillis(to, Date.now());
  const fromMs = toMillis(from, toMs - 270 * DAY_MS);
  if (fromMs >= toMs) throw new Error("`from` must be before `to`");

  const regimeHistory =
    regimeFilterMode === REGIME_FILTER_MODE.EMA_ONLY
      ? requiredEmaRegimeHistory()
      : regimeModule.requiredRegimeHistory();
  const warmupDays = Math.max(regimeHistory, lookbackDays + 1) + 5;
  const fetchFromMs = fromMs - warmupDays * DAY_MS;

  const fetchedCandles =
    candlesBySymbol ||
    Object.fromEntries(
      await Promise.all(
        symbols.map(async (symbol) => [symbol, await fetchHistoricalCandles(symbol, "1d", fetchFromMs, toMs)]),
      ),
    );
  const btcCandles =
    regimeCandles ||
    fetchedCandles[regimeModule.REGIME_BENCHMARK_SYMBOL] ||
    (await fetchHistoricalCandles(regimeModule.REGIME_BENCHMARK_SYMBOL, "1d", fetchFromMs, toMs));

  const executionCandles =
    executionCandlesBySymbol ||
    Object.fromEntries(
      await Promise.all(
        symbols.map(async (symbol) => [
          symbol,
          await fetchHistoricalCandles(symbol, EXECUTION_INTERVAL, fromMs - EXECUTION_MS, toMs),
        ]),
      ),
    );

  const regimeSeries =
    regimeFilterMode === REGIME_FILTER_MODE.EMA_ONLY
      ? computeEmaRegimeSeries(btcCandles)
      : regimeModule.computeRegimeSeries(btcCandles);
  const dailyMapBySymbol = new Map(
    symbols.map((symbol) => [symbol, new Map((fetchedCandles[symbol] || []).map((c) => [c.time, c]))]),
  );
  const executionMapBySymbol = new Map(
    symbols.map((symbol) => [symbol, new Map((executionCandles[symbol] || []).map((c) => [c.time, c]))]),
  );

  const dailyMarks = btcCandles
    .map((candle) => candle.time + DAY_MS)
    .filter((time) => time > fromMs && time <= toMs);
  if (dailyMarks.length < 14) {
    throw new Error(`Not enough daily candles in range: got ${dailyMarks.length}, need at least 14. Widen the date range.`);
  }
  const rebalanceTimes = rebalanceTimesBetween(fromMs, toMs, rebalanceEveryWeeks);

  let cash = initialEquity;
  const holdings = new Map(); // symbol -> { qty, entryPrice, costBasisInr, entryTime, lastPrice }
  const equityCurve = [{ time: fromMs, equity: initialEquity }];
  const rebalanceLog = [];
  const trades = [];
  let totalFees = 0;
  let totalTds = 0;
  let totalNotional = 0;
  function dailyCandle(symbol, time) {
    return dailyMapBySymbol.get(symbol)?.get(time) || null;
  }

  function executionCandle(symbol, time) {
    return executionMapBySymbol.get(symbol)?.get(time) || null;
  }

  function markToMarketAtDailyClose(closeTime) {
    let value = cash;
    for (const [symbol, position] of holdings) {
      const candle = dailyCandle(symbol, closeTime - DAY_MS);
      const price = candle ? candle.close : position.lastPrice;
      if (candle) position.lastPrice = candle.close;
      value += position.qty * price;
    }
    return value;
  }

  function pricesAtRebalance(time, requiredSymbols) {
    const prices = new Map();
    for (const symbol of requiredSymbols) {
      const candle = executionCandle(symbol, time);
      if (!candle) {
        throw new Error(
          `Missing ${EXECUTION_INTERVAL} execution candle for ${symbol} at ${new Date(time).toISOString()} (Monday 00:00 IST)`,
        );
      }
      prices.set(symbol, candle.open);
    }
    return prices;
  }

  function executeSell(symbol, qtyRequested, price, time, reason) {
    const position = holdings.get(symbol);
    if (!position || !(qtyRequested > 0)) return;
    const qty = Math.min(qtyRequested, position.qty);
    const fraction = qty / position.qty;
    const notional = qty * price;
    const fee = (notional * feePct) / 100;
    const tds = (notional * tdsPct) / 100;
    const costBasisShare = position.costBasisInr * fraction;
    const netPnlInr = notional - fee - tds - costBasisShare;

    cash += notional - fee - tds;
    totalFees += fee;
    totalTds += tds;
    totalNotional += notional;
    trades.push({
      symbol,
      side: "SELL",
      qty,
      price,
      time,
      entryPrice: position.entryPrice,
      entryTime: position.entryTime,
      feeInr: fee,
      tdsInr: tds,
      netPnlInr,
      returnPct: position.entryPrice > 0 ? (price / position.entryPrice - 1) * 100 : null,
      reason,
    });
    position.qty -= qty;
    position.costBasisInr -= costBasisShare;
    position.lastPrice = price;
    if (position.qty <= 1e-12) holdings.delete(symbol);
  }

  function executeBuy(symbol, desiredNotionalInr, price, time, reason) {
    const affordableNotional = cash / (1 + feePct / 100);
    const notional = Math.min(desiredNotionalInr, affordableNotional);
    if (notional < MIN_ORDER_NOTIONAL_INR) return;
    const qty = notional / price;
    const fee = (notional * feePct) / 100;
    cash -= notional + fee;
    totalFees += fee;
    totalNotional += notional;
    const existing = holdings.get(symbol);
    if (existing) {
      const previousQty = existing.qty;
      existing.qty += qty;
      existing.entryPrice = (existing.entryPrice * previousQty + price * qty) / existing.qty;
      existing.costBasisInr += notional + fee;
      existing.lastPrice = price;
    } else {
      holdings.set(symbol, {
        qty,
        entryPrice: price,
        costBasisInr: notional + fee,
        entryTime: time,
        lastPrice: price,
      });
    }
    trades.push({ symbol, side: "BUY", qty, price, time, feeInr: fee, reason });
  }

  const timeline = [
    ...dailyMarks.map((time) => ({ time, type: "mark" })),
    ...rebalanceTimes.map((time) => ({ time, type: "rebalance" })),
  ].sort((a, b) => a.time - b.time || (a.type === "rebalance" ? -1 : 1));

  for (const event of timeline) {
    if (event.type === "mark") {
      equityCurve.push({ time: event.time, equity: markToMarketAtDailyClose(event.time) });
      continue;
    }

    const regimeIndex = lastClosedDailyIndex(btcCandles, event.time);
    const regime = regimeIndex >= 0 ? regimeSeries[regimeIndex] : null;
    const candlesForRanking = Object.fromEntries(
      symbols.map((symbol) => [symbol, candlesClosedBy(fetchedCandles[symbol], event.time)]),
    );
    const ranking = rankAndSelect({
      candlesBySymbol: candlesForRanking,
      lookbackDays,
      topN,
      regime: regime || regimeModule.REGIME.RANGE,
      momentumMetric,
      requirePositiveMomentum,
    });
    const targetWeights = new Map(ranking.map((row) => [row.symbol, row.weight]));
    const selection = ranking.filter((row) => row.weight > 0).map((row) => row.symbol);
    const pricedSymbols = new Set([...holdings.keys(), ...selection]);
    const prices = pricesAtRebalance(event.time, pricedSymbols);
    const equityBefore =
      cash +
      [...holdings].reduce(
        (sum, [symbol, position]) => sum + position.qty * prices.get(symbol),
        0,
      );
    const currentSymbols = [...holdings.keys()].sort();
    const targetSymbols = [...selection].sort();
    const holdingsUnchanged =
      currentSymbols.length === targetSymbols.length &&
      currentSymbols.every((symbol, index) => symbol === targetSymbols[index]);
    const skipped = skipUnchangedHoldings && holdingsUnchanged;
    const rebalanceReason = `${rebalanceEveryWeeks}-week equal-weight rebalance`;

    if (!skipped) {
      for (const [symbol, position] of [...holdings]) {
        const price = prices.get(symbol);
        const targetNotional = equityBefore * (targetWeights.get(symbol) || 0);
        const currentNotional = position.qty * price;
        const sellNotional = currentNotional - targetNotional;
        if (sellNotional >= MIN_ORDER_NOTIONAL_INR || (targetNotional === 0 && currentNotional > 0)) {
          executeSell(
            symbol,
            targetNotional === 0 ? position.qty : sellNotional / price,
            price,
            event.time,
            rebalanceReason,
          );
        }
      }

      for (const symbol of selection) {
        const price = prices.get(symbol);
        const targetNotional = equityBefore * targetWeights.get(symbol);
        const currentNotional = (holdings.get(symbol)?.qty || 0) * price;
        const buyNotional = targetNotional - currentNotional;
        if (buyNotional >= MIN_ORDER_NOTIONAL_INR) {
          executeBuy(symbol, buyNotional, price, event.time, rebalanceReason);
        }
      }
    }

    const equityAfter =
      cash +
      [...holdings].reduce(
        (sum, [symbol, position]) => sum + position.qty * prices.get(symbol),
        0,
      );
    rebalanceLog.push({
      time: event.time,
      regime,
      skipped,
      skipReason: skipped ? "Holdings unchanged" : null,
      ranking,
      selection,
      equityBeforeInr: equityBefore,
      equityAfterInr: equityAfter,
      holdings: [...holdings].map(([symbol, position]) => ({
        symbol,
        weight: equityAfter > 0 ? (position.qty * prices.get(symbol)) / equityAfter : 0,
      })),
    });
  }

  if (holdings.size > 0) {
    for (const symbol of [...holdings.keys()]) {
      const closed = (executionCandles[symbol] || []).filter(
        (candle) => candle.time + EXECUTION_MS <= toMs,
      );
      const candle = closed.at(-1);
      const price = candle ? candle.close : holdings.get(symbol).lastPrice;
      executeSell(
        symbol,
        holdings.get(symbol).qty,
        price,
        toMs,
        "Backtest end (forced close)",
      );
    }
    if (equityCurve.at(-1)?.time === toMs) equityCurve[equityCurve.length - 1].equity = cash;
    else equityCurve.push({ time: toMs, equity: cash });
  }

  const buyAndHold = buildBuyAndHoldBenchmark({
    symbol: regimeModule.REGIME_BENCHMARK_SYMBOL,
    dailyCandles: btcCandles,
    executionCandles: executionCandles[regimeModule.REGIME_BENCHMARK_SYMBOL] || [],
    fromMs,
    toMs,
    initialEquity,
    feePct,
    tdsPct,
  });

  const usedExecutionCandles = Object.values(executionCandles)
    .flat()
    .filter((candle) => candle.time >= fromMs && candle.time <= toMs);
  const result = {
    symbols,
    from: fromMs,
    to: toMs,
    lookbackDays,
    topN,
    momentumMetric,
    regimeFilterMode,
    rebalanceEveryWeeks,
    skipUnchangedHoldings,
    requirePositiveMomentum,
    initialEquity,
    feePct,
    tdsPct,
    dayCount: dailyMarks.length,
    candleCount: usedExecutionCandles.length,
    candleRange: {
      first: usedExecutionCandles.reduce((value, candle) => Math.min(value, candle.time), Infinity),
      last: usedExecutionCandles.reduce((value, candle) => Math.max(value, candle.time), -Infinity),
    },
    rebalanceDecisionCount: rebalanceLog.length,
    rebalanceCount: rebalanceLog.filter((entry) => !entry.skipped).length,
    skippedRebalanceCount: rebalanceLog.filter((entry) => entry.skipped).length,
    buyAndHold,
    summary: buildCrossSectionalSummary({ equityCurve, trades, initialEquity, totalFees, totalTds, totalNotional, rebalanceLog }),
    rebalanceLog,
    trades,
    equityCurve,
  };

  saveBacktest({
    strategy_name: "cross-sectional-momentum",
    symbol: symbols.join(","),
    interval: `${rebalanceEveryWeeks}w`,
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

function buildBuyAndHoldBenchmark({
  symbol,
  dailyCandles,
  executionCandles,
  fromMs,
  toMs,
  initialEquity,
  feePct,
  tdsPct,
}) {
  const entryCandle = (executionCandles || []).find(
    (candle) => candle.time >= fromMs && candle.time < toMs,
  );
  const exitCandle = (executionCandles || [])
    .filter((candle) => candle.time + EXECUTION_MS <= toMs)
    .at(-1);
  if (!entryCandle || !exitCandle || exitCandle.time < entryCandle.time) return null;

  const entryPrice = entryCandle.open;
  const exitPrice = exitCandle.close;
  const buyNotional = initialEquity / (1 + feePct / 100);
  const buyFee = (buyNotional * feePct) / 100;
  const qty = buyNotional / entryPrice;
  const sellNotional = qty * exitPrice;
  const sellFee = (sellNotional * feePct) / 100;
  const tds = (sellNotional * tdsPct) / 100;
  const finalEquity = sellNotional - sellFee - tds;

  const equityCurve = [{ time: fromMs, equity: initialEquity }];
  for (const candle of dailyCandles || []) {
    const closeTime = candle.time + DAY_MS;
    if (closeTime > fromMs && closeTime < toMs) {
      equityCurve.push({ time: closeTime, equity: qty * candle.close });
    }
  }
  equityCurve.push({ time: toMs, equity: finalEquity });

  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }
  const durationDays = (toMs - fromMs) / DAY_MS;
  const growth = finalEquity / initialEquity;

  return {
    symbol,
    entryTime: entryCandle.time,
    exitTime: exitCandle.time + EXECUTION_MS,
    entryPrice,
    exitPrice,
    summary: {
      finalEquityInr: finalEquity,
      netReturnPct: (growth - 1) * 100,
      grossReturnPct: (exitPrice / entryPrice - 1) * 100,
      cagrPct: durationDays > 0 ? (growth ** (365 / durationDays) - 1) * 100 : null,
      maxDrawdownPct,
      totalFeesInr: buyFee + sellFee,
      totalTdsInr: tds,
      durationDays,
    },
    equityCurve,
  };
}

function buildCrossSectionalSummary({ equityCurve, trades, initialEquity, totalFees, totalTds, totalNotional, rebalanceLog }) {
  const finalEquity = equityCurve.length > 0 ? equityCurve.at(-1).equity : initialEquity;
  const days = equityCurve.length > 1 ? (equityCurve.at(-1).time - equityCurve[0].time) / DAY_MS : 0;
  const growth = finalEquity / initialEquity;

  const barReturns = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    if (equityCurve[i - 1].equity > 0) barReturns.push(equityCurve[i].equity / equityCurve[i - 1].equity - 1);
  }
  const mean = barReturns.length > 0 ? barReturns.reduce((sum, v) => sum + v, 0) / barReturns.length : 0;
  const variance =
    barReturns.length > 1
      ? barReturns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (barReturns.length - 1)
      : 0;
  const std = Math.sqrt(variance);

  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }

  // Weekly equal-weight maintenance can partially trim a position, so report
  // realized sell legs rather than pretending every sell is a full round trip.
  const sellLegs = trades.filter((trade) => trade.side === "SELL");
  const wins = sellLegs.filter((trade) => trade.netPnlInr > 0).length;
  const returns = sellLegs.map((trade) => trade.returnPct).filter((value) => Number.isFinite(value));

  const periodsInCash = rebalanceLog.filter((entry) => entry.selection.length === 0).length;
  const completedRebalances = rebalanceLog.filter((entry) => !entry.skipped).length;
  const skippedRebalances = rebalanceLog.length - completedRebalances;

  return {
    finalEquityInr: finalEquity,
    netReturnPct: (growth - 1) * 100,
    grossReturnPct: ((finalEquity + totalFees + totalTds) / initialEquity - 1) * 100,
    cagrPct: days > 0 ? (growth ** (365 / days) - 1) * 100 : null,
    sharpe: std > 0 ? (mean / std) * Math.sqrt(365) : null,
    maxDrawdownPct,
    tradeCount: sellLegs.length,
    winRatePct: sellLegs.length > 0 ? (wins / sellLegs.length) * 100 : null,
    avgReturnPct: returns.length > 0 ? returns.reduce((sum, v) => sum + v, 0) / returns.length : null,
    turnover: totalNotional / initialEquity,
    totalFeesInr: totalFees,
    totalTdsInr: totalTds,
    durationDays: days,
    rebalanceDecisionCount: rebalanceLog.length,
    rebalanceCount: completedRebalances,
    skippedRebalanceCount: skippedRebalances,
    periodsInCashCount: periodsInCash,
    periodsInCashPct: rebalanceLog.length > 0 ? (periodsInCash / rebalanceLog.length) * 100 : null,
    // Backward-compatible aliases for existing result consumers.
    weeksInCashCount: periodsInCash,
    weeksInCashPct: rebalanceLog.length > 0 ? (periodsInCash / rebalanceLog.length) * 100 : null,
  };
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function printCrossSectionalSummary(result) {
  const s = result.summary;
  const lines = [
    `Cross-sectional backtest  ${result.symbols.join(", ")}` +
      `  ${new Date(result.from).toISOString().slice(0, 10)} → ${new Date(result.to).toISOString().slice(0, 10)}` +
      `  (${result.dayCount} days, ${result.rebalanceDecisionCount} decisions)`,
    `Configuration    ${result.momentumMetric}, BTC ${result.regimeFilterMode}, every ${result.rebalanceEveryWeeks} week(s), skip unchanged ${result.skipUnchangedHoldings}`,
    `Initial equity   ₹${formatNumber(result.initialEquity)}   lookback ${result.lookbackDays}d   top ${result.topN}   fee ${result.feePct}%/side   TDS ${result.tdsPct}% on sells`,
    "",
    `Final equity     ₹${formatNumber(s.finalEquityInr)}`,
    `Net return       ${formatNumber(s.netReturnPct)}%  (gross before costs: ${formatNumber(s.grossReturnPct)}%)`,
    `CAGR             ${formatNumber(s.cagrPct)}%`,
    `Sharpe           ${formatNumber(s.sharpe)}`,
    `Max drawdown     ${formatNumber(s.maxDrawdownPct)}%`,
    `Realized sells   ${s.tradeCount}   profitable ${formatNumber(s.winRatePct, 1)}%   avg price return ${formatNumber(s.avgReturnPct)}%`,
    `Turnover         ${formatNumber(s.turnover)}x of initial equity`,
    `Fees paid        ₹${formatNumber(s.totalFeesInr)}   TDS withheld ₹${formatNumber(s.totalTdsInr)}`,
    `Rebalances       ${s.rebalanceCount} executed, ${s.skippedRebalanceCount} skipped (holdings unchanged)`,
    `Periods in cash  ${s.periodsInCashCount}/${s.rebalanceDecisionCount} (${formatNumber(s.periodsInCashPct, 1)}%) — regime was not TREND_UP`,
  ];
  if (result.buyAndHold) {
    lines.push(
      `BTC buy-and-hold ${formatNumber(result.buyAndHold.summary.netReturnPct)}% net, ${formatNumber(result.buyAndHold.summary.maxDrawdownPct)}% max drawdown`,
    );
  }
  console.log(lines.join("\n"));
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const symbols = args.symbols
    ? String(args.symbols).split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SYMBOLS;

  const result = await runCrossSectionalBacktest({
    symbols,
    from: args.from,
    to: args.to,
    lookbackDays: Number(args.lookback) || DEFAULT_LOOKBACK_DAYS,
    topN: Number(args.topN) || DEFAULT_TOP_N,
    initialEquity: Number(args.equity) || 100_000,
    momentumMetric: args.metric || MOMENTUM_METRIC.TOTAL_RETURN,
    regimeFilterMode: args.regime || REGIME_FILTER_MODE.EMA_ONLY,
    rebalanceEveryWeeks: Number(args.rebalanceWeeks) || DEFAULT_REBALANCE_WEEKS,
    skipUnchangedHoldings: args.skipUnchanged !== "false",
    requirePositiveMomentum: args.positiveOnly === "true",
  });

  printCrossSectionalSummary(result);

  const outDir = path.join(__dirname, "..", "backtest-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `cross-sectional-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`\nEquity curve, trade log and rebalance history written to ${outFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Cross-sectional backtest failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  rankAndSelect,
  computeMomentumScore,
  computeRiskAdjustedMomentumScore,
  computeTrailingReturn,
  computeEmaRegimeSeries,
  getEmaRegime,
  requiredEmaRegimeHistory,
  buildBuyAndHoldBenchmark,
  runCrossSectionalBacktest,
  isRebalanceCandle,
  latestRebalanceAt,
  rebalanceTimesBetween,
  candlesClosedBy,
  DEFAULT_SYMBOLS,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_TOP_N,
  DEFAULT_REBALANCE_WEEKS,
  MOMENTUM_METRIC,
  REGIME_FILTER_MODE,
  PREVIOUS_VERSION_OPTIONS,
  EXECUTION_INTERVAL,
};
