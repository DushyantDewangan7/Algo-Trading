"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fetchHistoricalCandles, toMillis } = require("./backtest");
const { fetchTickerSnapshot, normalizeInrTicker } = require("./top-gainers");
const { openPosition, realizePnL, isCooldownActive } = require("./trailing-stop");
const { saveBacktest } = require("../database");

const DAY_MS = 86_400_000;
const DEFAULT_FROM = "2022-01-01T00:00:00Z";
const DEFAULT_TO = "2025-12-31T23:59:59Z";
const FEE_PCT = 0.1;
const TDS_PCT = 1;

function formatRuntimeTime(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function slippagePct(positionSizeINR, dailyVolumeINR) {
  const participation = dailyVolumeINR > 0 ? positionSizeINR / dailyVolumeINR : Infinity;
  return Math.min(2, Math.max(0.1, 0.5 * participation * 100));
}

function createLogger(onLog, logLines, quiet = false) {
  return (message) => {
    const line = `[${formatRuntimeTime()}] ${message}`;
    logLines.push(line);
    if (!quiet) console.log(line);
    onLog?.(line);
    return line;
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function normalizeSeries(candles, fetchFromMs, toMs) {
  return (candles || [])
    .map((candle) => ({
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume) || 0,
    }))
    .filter((candle) =>
      Number.isFinite(candle.time) &&
      candle.time >= fetchFromMs && candle.time <= toMs &&
      [candle.open, candle.high, candle.low, candle.close].every((value) => value > 0),
    )
    .sort((a, b) => a.time - b.time);
}

function continuousWindow(candles, fromMs, toMs, minimumCoverage = 0.9) {
  const window = candles.filter((candle) => candle.time >= fromMs && candle.time <= toMs);
  const expected = Math.floor((toMs - fromMs) / DAY_MS) + 1;
  if (!window.length) return { continuous: false, coverage: 0, window };
  const coverage = window.length / expected;
  const startsOnTime = window[0].time <= fromMs + DAY_MS;
  const endsOnTime = window.at(-1).time >= toMs - 2 * DAY_MS;
  let largestGap = 0;
  for (let i = 1; i < window.length; i += 1) {
    largestGap = Math.max(largestGap, window[i].time - window[i - 1].time);
  }
  return {
    // CoinDCX's public daily history has a market-wide April 2024 hole of
    // roughly 22 days (including BTC). Treat boundary-to-boundary series with
    // >=90% coverage as continuous, then separately refuse to rank across a
    // gap longer than two days below.
    continuous: coverage >= minimumCoverage && startsOnTime && endsOnTime && largestGap <= 30 * DAY_MS,
    coverage,
    window,
  };
}

function summarize({
  equityCurve,
  trades,
  initialEquity,
  totalFees,
  totalTds,
  totalSlippageCost,
  fromMs,
  toMs,
  btcBuyAndHold,
}) {
  const finalEquity = equityCurve.at(-1)?.equity ?? initialEquity;
  const growth = finalEquity / initialEquity;
  const durationDays = (toMs - fromMs) / DAY_MS;
  const dailyReturns = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const previous = equityCurve[i - 1].equity;
    if (previous > 0) dailyReturns.push(equityCurve[i].equity / previous - 1);
  }
  const mean = dailyReturns.length
    ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length
    : 0;
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const std = Math.sqrt(variance);
  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }
  const wins = trades.filter((trade) => trade.netPnL > 0).length;
  const rValues = trades.map((trade) => trade.netR).filter(Number.isFinite);
  const netReturnPct = (growth - 1) * 100;
  const btcNetPct = btcBuyAndHold?.summary?.netReturnPct;
  return {
    finalEquityInr: finalEquity,
    netReturnPct,
    grossReturnPct: ((finalEquity + totalFees + totalTds + totalSlippageCost) / initialEquity - 1) * 100,
    cagrPct: durationDays > 0 ? (growth ** (365 / durationDays) - 1) * 100 : null,
    sharpe: std > 0 ? (mean / std) * Math.sqrt(365) : null,
    maxDrawdownPct,
    tradeCount: trades.length,
    winRatePct: trades.length ? (wins / trades.length) * 100 : null,
    avgRMultiple: rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null,
    totalFeesInr: totalFees,
    totalTdsInr: totalTds,
    totalSlippageCostInr: totalSlippageCost,
    captureRatio: Number.isFinite(btcNetPct) && btcNetPct !== 0 ? netReturnPct / btcNetPct : null,
    durationDays,
  };
}

function buildBuyAndHold(candles, fromMs, toMs, initialEquity) {
  const window = candles.filter((candle) => candle.time >= fromMs && candle.time <= toMs);
  if (window.length < 2) return null;
  const entry = window[0];
  const exit = window.at(-1);
  const buyFee = (initialEquity * FEE_PCT) / 100;
  const buyNotional = initialEquity - buyFee;
  const qty = buyNotional / entry.open;
  const sellNotional = qty * exit.close;
  const sellFee = (sellNotional * FEE_PCT) / 100;
  const tds = (sellNotional * TDS_PCT) / 100;
  const finalEquity = sellNotional - sellFee - tds;
  const equityCurve = window.map((candle) => ({ time: candle.time, equity: qty * candle.close }));
  equityCurve[equityCurve.length - 1].equity = finalEquity;
  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }
  return {
    symbol: "BTCINR",
    entryTime: entry.time,
    exitTime: exit.time,
    entryPrice: entry.open,
    exitPrice: exit.close,
    equityCurve,
    summary: {
      finalEquityInr: finalEquity,
      netReturnPct: (finalEquity / initialEquity - 1) * 100,
      grossReturnPct: (exit.close / entry.open - 1) * 100,
      maxDrawdownPct,
      tradeCount: 1,
      winRatePct: finalEquity > initialEquity ? 100 : 0,
      totalFeesInr: buyFee + sellFee,
      totalTdsInr: tds,
    },
  };
}

async function getCandidateMarkets(symbols) {
  if (Array.isArray(symbols) && symbols.length) return [...new Set(symbols.map((value) => String(value).trim()))];
  const snapshot = await fetchTickerSnapshot();
  return snapshot.rows.map(normalizeInrTicker).filter(Boolean).map((row) => row.market);
}

async function runTopGainersBacktest({
  from = DEFAULT_FROM,
  to = DEFAULT_TO,
  minVolumeINR = 1_000_000,
  maxPositions = 15,
  trailPct = 2,
  tpPct = 50,
  cooldownHours = 24,
  cashReservePct = 10,
  initialEquity = 100_000,
  symbols = null,
  candlesBySymbol = null,
  onLog = null,
  concurrency = Math.max(1, Number(process.env.TOP_GAINERS_BACKTEST_CONCURRENCY) || 6),
  quiet = false,
} = {}) {
  const fromMs = toMillis(from, Date.parse(DEFAULT_FROM));
  const toMs = toMillis(to, Date.parse(DEFAULT_TO));
  if (fromMs >= toMs) throw new Error("`from` must be before `to`");
  const floor = Math.max(0, Number(minVolumeINR) || 1_000_000);
  const cap = Math.max(1, Math.floor(Number(maxPositions) || 15));
  const logLines = [];
  const log = createLogger(onLog, logLines, quiet);
  const fetchFromMs = fromMs - 31 * DAY_MS;

  log(`Strategy=topGainers from=${new Date(fromMs).toISOString()} to=${new Date(toMs).toISOString()} symbol=ALL_INR`);
  log("Fetching candles...");
  const candidateMarkets = await getCandidateMarkets(symbols);
  const loaded = await mapLimit(candidateMarkets, concurrency, async (symbol) => {
    try {
      const source = candlesBySymbol?.[symbol] ||
        await fetchHistoricalCandles(symbol, "1d", fetchFromMs, toMs);
      return { symbol, candles: normalizeSeries(source, fetchFromMs, toMs) };
    } catch (error) {
      log(`WARN ${symbol} candles unavailable: ${error.message}`);
      return { symbol, candles: [], error: error.message };
    }
  });
  const totalCandles = loaded.reduce((sum, item) => sum + item.candles.length, 0);
  const allTimes = loaded.flatMap((item) => item.candles.map((candle) => candle.time));
  const firstCandleTime = allTimes.reduce((minimum, value) => Math.min(minimum, value), Infinity);
  const lastCandleTime = allTimes.reduce((maximum, value) => Math.max(maximum, value), -Infinity);
  log(
    `Received ${totalCandles} candles across ${loaded.length} INR pairs, first=${allTimes.length ? new Date(firstCandleTime).toISOString() : "n/a"}, last=${allTimes.length ? new Date(lastCandleTime).toISOString() : "n/a"}`,
  );

  const eligible = [];
  for (const item of loaded) {
    const continuity = continuousWindow(item.candles, fromMs, toMs);
    if (!continuity.continuous) continue;
    const volumes = continuity.window.map((candle) => candle.close * candle.volume);
    const averageVolumeINR = volumes.reduce((sum, value) => sum + value, 0) / volumes.length;
    if (averageVolumeINR < floor) continue;
    eligible.push({ ...item, averageVolumeINR, coverage: continuity.coverage });
  }
  log(`Warmup complete at index 30; fixed universe=${eligible.length}/${candidateMarkets.length} continuous pairs above ₹${floor}`);
  if (!eligible.length) {
    throw new Error(`No continuous INR candle series met the ₹${floor} average-volume floor`);
  }

  const bySymbol = new Map();
  const timeIndex = new Map();
  for (const item of eligible) {
    bySymbol.set(item.symbol, item);
    timeIndex.set(item.symbol, new Map(item.candles.map((candle, index) => [candle.time, index])));
  }
  let btcCandles = loaded.find((item) => /(^I-|^B-)?BTC_?INR$/i.test(item.symbol))?.candles;
  if (!btcCandles?.length && !candlesBySymbol) {
    btcCandles = normalizeSeries(await fetchHistoricalCandles("I-BTC_INR", "1d", fetchFromMs, toMs), fetchFromMs, toMs);
  }
  const btcBuyAndHold = buildBuyAndHold(btcCandles || [], fromMs, toMs, initialEquity);

  const eventTimes = [...new Set(eligible.flatMap((item) =>
    item.candles.filter((candle) => candle.time >= fromMs && candle.time <= toMs).map((candle) => candle.time),
  ))].sort((a, b) => a - b);
  let cash = initialEquity;
  let positions = [];
  const cooldowns = {};
  const trades = [];
  const equityCurve = [];
  let pendingSelection = [];
  let totalFees = 0;
  let totalTds = 0;
  let totalSlippageCost = 0;

  function closeBacktestPosition(position, rawExitPrice, dailyVolumeINR, reason, time) {
    const slip = slippagePct(position.sizeINR, dailyVolumeINR);
    const exitPrice = rawExitPrice * (1 - slip / 100);
    const pnl = realizePnL(position, exitPrice);
    const slipCost = position.qty * (rawExitPrice - exitPrice);
    totalFees += pnl.sellFee;
    totalTds += pnl.tds;
    totalSlippageCost += slipCost;
    cash += pnl.netProceeds;
    positions = positions.filter((item) => item !== position);
    cooldowns[position.symbol] = time + cooldownHours * 60 * 60 * 1000;
    const trade = {
      symbol: position.symbol,
      entryTime: position.entryTime,
      exitTime: time,
      entryPrice: position.entryPrice,
      exitPrice,
      rawExitPrice,
      entrySlippagePct: position.entrySlippagePct,
      exitSlippagePct: slip,
      entrySlippageCostInr: position.entrySlippageCostInr,
      exitSlippageCostInr: slipCost,
      reason,
      ...pnl,
    };
    trades.push(trade);
    log(`SELL ${position.symbol} at price ${exitPrice.toFixed(8)}, reason ${reason}, netR=${pnl.netR.toFixed(3)}`);
  }

  for (const time of eventTimes) {
    const candlesNow = new Map();
    for (const item of eligible) {
      const index = timeIndex.get(item.symbol).get(time);
      if (index !== undefined) candlesNow.set(item.symbol, item.candles[index]);
    }

    const openEquity = cash + positions.reduce((sum, position) => {
      const candle = candlesNow.get(position.symbol);
      return sum + position.qty * (candle?.open || position.currentPrice || position.entryPrice);
    }, 0);
    const slotSizeINR = (openEquity * (1 - cashReservePct / 100)) / cap;

    for (const selected of pendingSelection) {
      if (positions.length >= cap) break;
      if (positions.some((position) => position.symbol === selected.symbol)) continue;
      if (isCooldownActive(cooldowns, selected.symbol, time)) continue;
      if (cash < slotSizeINR) continue;
      const candle = candlesNow.get(selected.symbol);
      if (!candle) continue;
      const slip = slippagePct(slotSizeINR, selected.dailyVolumeINR);
      const entryPrice = candle.open * (1 + slip / 100);
      const position = openPosition({
        symbol: selected.symbol,
        price: entryPrice,
        sizeINR: slotSizeINR,
        timestamp: time,
        trailPct,
        tpPct,
      });
      position.entrySlippagePct = slip;
      position.entrySlippageCostInr = position.qty * (entryPrice - candle.open);
      position.currentPrice = entryPrice;
      cash -= slotSizeINR;
      totalFees += position.entryFee;
      totalSlippageCost += position.entrySlippageCostInr;
      positions.push(position);
      log(`BUY ${position.symbol} at price ${entryPrice.toFixed(8)}, stop ${position.stopPrice.toFixed(8)}, TP ${position.takeProfitPrice.toFixed(8)}`);
    }

    for (const position of [...positions]) {
      const candle = candlesNow.get(position.symbol);
      if (!candle) continue;
      const dailyVolumeINR = candle.close * candle.volume;
      if (candle.open <= position.stopPrice) {
        closeBacktestPosition(position, candle.open, dailyVolumeINR, "STOP_HIT", time);
        continue;
      }
      if (candle.open >= position.takeProfitPrice) {
        closeBacktestPosition(position, candle.open, dailyVolumeINR, "TP_HIT", time);
        continue;
      }
      // With daily OHLC the intraday path is unknown. Resolve a bar touching
      // both levels conservatively in favour of the existing stop.
      if (candle.low <= position.stopPrice) {
        closeBacktestPosition(position, position.stopPrice, dailyVolumeINR, "STOP_HIT", time);
        continue;
      }
      if (candle.high >= position.takeProfitPrice) {
        closeBacktestPosition(position, position.takeProfitPrice, dailyVolumeINR, "TP_HIT", time);
        continue;
      }
      if (candle.high > position.highestPrice) {
        const previousStop = position.stopPrice;
        position.highestPrice = candle.high;
        position.stopPrice = Math.max(position.stopPrice, candle.high * (1 - trailPct / 100));
        if (position.stopPrice > previousStop) {
          log(`Stop raised: ${position.symbol} stop was ${previousStop.toFixed(8)}, now ${position.stopPrice.toFixed(8)}`);
        }
      }
      position.currentPrice = candle.close;
    }

    const ranking = [];
    for (const item of eligible) {
      const index = timeIndex.get(item.symbol).get(time);
      if (index === undefined || index < 30) continue;
      const current = item.candles[index];
      const previous = item.candles[index - 1];
      if (current.time - previous.time > 2 * DAY_MS) continue;
      const recentVolumes = item.candles
        .slice(index - 29, index + 1)
        .map((candle) => candle.close * candle.volume);
      const rollingMedianVolumeINR = median(recentVolumes);
      if (!(rollingMedianVolumeINR >= floor)) continue;
      ranking.push({
        symbol: item.symbol,
        change24h: (current.close / previous.close - 1) * 100,
        dailyVolumeINR: rollingMedianVolumeINR,
      });
    }
    pendingSelection = ranking
      .sort((a, b) => b.change24h - a.change24h || b.dailyVolumeINR - a.dailyVolumeINR)
      .slice(0, cap);

    const closeEquity = cash + positions.reduce((sum, position) => {
      const candle = candlesNow.get(position.symbol);
      return sum + position.qty * (candle?.close || position.currentPrice || position.entryPrice);
    }, 0);
    equityCurve.push({ time, equity: closeEquity });
  }

  const finalTime = eventTimes.at(-1) || toMs;
  for (const position of [...positions]) {
    const item = bySymbol.get(position.symbol);
    const candle = item?.candles.filter((row) => row.time <= finalTime).at(-1);
    if (candle) closeBacktestPosition(position, candle.close, candle.close * candle.volume, "BACKTEST_END", finalTime);
  }
  if (equityCurve.length) equityCurve[equityCurve.length - 1].equity = cash;
  else equityCurve.push({ time: fromMs, equity: initialEquity });

  const summary = summarize({
    equityCurve,
    trades,
    initialEquity,
    totalFees,
    totalTds,
    totalSlippageCost,
    fromMs,
    toMs,
    btcBuyAndHold,
  });
  log(`Backtest complete: netPct=${summary.netReturnPct.toFixed(2)} trades=${summary.tradeCount} winRate=${Number(summary.winRatePct || 0).toFixed(1)}`);

  const result = {
    strategy: "topGainers",
    from: fromMs,
    to: toMs,
    interval: "1d",
    initialEquity,
    minVolumeINR: floor,
    maxPositions: cap,
    trailPct,
    tpPct,
    cooldownHours,
    cashReservePct,
    universe: {
      totalINRPairs: candidateMarkets.length,
      continuousPairs: loaded.filter((item) => continuousWindow(item.candles, fromMs, toMs).continuous).length,
      aboveAverageVolumeFloor: eligible.length,
      symbols: eligible.map((item) => item.symbol),
    },
    candleCount: totalCandles,
    candleRange: {
      first: allTimes.length ? firstCandleTime : null,
      last: allTimes.length ? lastCandleTime : null,
    },
    summary,
    trades,
    equityCurve,
    btcBuyAndHold,
    log: logLines,
  };

  saveBacktest({
    strategy_name: "top-gainers-trailing-stop",
    symbol: "ALL_INR",
    interval: "1d",
    from_date: fromMs,
    to_date: toMs,
    net_return: summary.netReturnPct,
    gross_return: summary.grossReturnPct,
    sharpe: summary.sharpe,
    max_drawdown: summary.maxDrawdownPct,
    win_rate: summary.winRatePct,
    total_trades: summary.tradeCount,
    created_at: Date.now(),
  });
  return result;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((entries, value, index, all) => {
    if (value.startsWith("--")) entries.push([value.slice(2), all[index + 1]]);
    return entries;
  }, []));
  const result = await runTopGainersBacktest({
    from: args.from || DEFAULT_FROM,
    to: args.to || DEFAULT_TO,
    minVolumeINR: Number(args.minVolumeINR) || 1_000_000,
    maxPositions: Number(args.maxPositions) || 15,
    trailPct: Number(args.trailPct) || 2,
    tpPct: Number(args.tpPct) || 50,
  });
  const outDir = path.join(__dirname, "..", "backtest-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `top-gainers-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`Result written to ${outFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Top-gainers backtest failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  runTopGainersBacktest,
  slippagePct,
  median,
  continuousWindow,
  buildBuyAndHold,
  DEFAULT_FROM,
  DEFAULT_TO,
};
