"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { fetchHistoricalCandles, INTERVAL_MS, toMillis } = require("./backtest");
const { fetchTickerSnapshot, normalizeInrTicker } = require("./top-gainers");
const { buildBuyAndHold } = require("./top-gainers-backtest");
const { fetchTopMarketCap, getBigCoinsState } = require("./big-coins");
const {
  createLeveragedPosition,
  entryPriceWithSlippage,
  exitPriceWithSlippage,
  liquidationPrice,
  positionEquity,
  settleLeveragedPosition,
} = require("./leverage-sim");
const { saveBacktest } = require("../database");

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_MIN_VOLUME_INR = 1_000_000;
const DEFAULT_UNIVERSE_SIZE = 15;
const DEFAULT_MIN_ORDER_INR = 100;
const DEFAULT_FROM = "2026-01-01T00:00:00Z";

function formatRuntimeTime(timestamp = Date.now()) {
  return new Date(timestamp).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function createLogger(onLog, lines, quiet = false) {
  return (message) => {
    const line = String(message).startsWith("[")
      ? String(message)
      : `[${formatRuntimeTime()}] ${message}`;
    lines.push(line);
    if (!quiet) console.log(line);
    onLog?.(line);
    return line;
  };
}

async function mapLimit(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(items.length, Math.max(1, concurrency)) },
    worker,
  ));
  return output;
}

function normalizeCandles(candles, fromMs, toMs) {
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
      Number.isFinite(candle.time) && candle.time >= fromMs && candle.time <= toMs &&
      [candle.open, candle.high, candle.low, candle.close].every((value) => value > 0),
    )
    .sort((a, b) => a.time - b.time);
}

function buildRollingMetrics(candles, intervalMs) {
  const metrics = new Map();
  let start = 0;
  let volumeSum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    const boundary = candles[index].time;
    const priorIndex = index - 1;
    if (priorIndex < 0) continue;
    const prior = candles[priorIndex];
    if (boundary - prior.time > intervalMs * 1.5) {
      start = index;
      volumeSum = 0;
      continue;
    }

    volumeSum += prior.close * prior.volume;
    const cutoff = boundary - DAY_MS;
    while (start < priorIndex && candles[start].time < cutoff) {
      volumeSum -= candles[start].close * candles[start].volume;
      start += 1;
    }
    const base = candles[start];
    const span = prior.time - base.time + intervalMs;
    if (span < DAY_MS - intervalMs * 1.5 || !(base.close > 0)) continue;
    metrics.set(boundary, {
      change24h: (prior.close / base.close - 1) * 100,
      dailyVolumeINR: Math.max(0, volumeSum),
      signalPrice: prior.close,
    });
  }
  return metrics;
}

function maxDailyNotional(candles) {
  return Math.max(0, ...(candles || []).map((candle) =>
    (Number(candle.close) || 0) * (Number(candle.volume) || 0),
  ));
}

async function candidateMarkets(symbols, candlesBySymbol) {
  if (Array.isArray(symbols) && symbols.length) {
    return [...new Set(symbols.map((symbol) => String(symbol).trim()).filter(Boolean))];
  }
  if (candlesBySymbol && Object.keys(candlesBySymbol).length) return Object.keys(candlesBySymbol);
  const snapshot = await fetchTickerSnapshot();
  return snapshot.rows.map(normalizeInrTicker).filter(Boolean).map((row) => row.market);
}

async function prefilterMarkets({
  symbols,
  fromMs,
  toMs,
  minVolumeINR,
  candlesBySymbol,
  concurrency,
  log,
}) {
  if (candlesBySymbol || symbols.length <= 25) return symbols;
  const dailyFrom = fromMs - 2 * DAY_MS;
  const rows = await mapLimit(symbols, concurrency, async (symbol) => {
    try {
      const daily = await fetchHistoricalCandles(symbol, "1d", dailyFrom, toMs);
      return maxDailyNotional(daily) >= minVolumeINR * 0.25 ? symbol : null;
    } catch (error) {
      log(`PREFILTER_SKIP ${symbol}: ${error.message}`);
      return null;
    }
  });
  const filtered = rows.filter(Boolean);
  log(`Daily liquidity prefilter retained ${filtered.length}/${symbols.length} INR markets`);
  return filtered;
}

function summaryFromRun({
  equityCurve,
  trades,
  initialEquity,
  totalFees,
  totalTds,
  totalSlippageCost,
  sessionsRun,
  positionsOpened,
  fromMs,
  toMs,
  btcBuyAndHold,
}) {
  const finalEquity = equityCurve.at(-1)?.equity ?? initialEquity;
  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.max(
      maxDrawdownPct,
      ((peak - point.equity) / peak) * 100,
    );
  }
  const wins = trades.filter((trade) => trade.netPnL > 0).length;
  const rValues = trades.map((trade) => trade.netR).filter(Number.isFinite);
  const netReturnPct = (finalEquity / initialEquity - 1) * 100;
  const btcNetPct = Number(btcBuyAndHold?.summary?.netReturnPct);
  return {
    finalEquityInr: finalEquity,
    netReturnPct,
    grossReturnPct:
      ((finalEquity + totalFees + totalTds + totalSlippageCost) / initialEquity - 1) * 100,
    maxDrawdownPct,
    sessionsRun,
    positionsOpened,
    tradeCount: positionsOpened,
    closedTradeCount: trades.length,
    winRatePct: trades.length ? (wins / trades.length) * 100 : null,
    avgRMultiple: rValues.length
      ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length
      : null,
    liquidations: trades.filter((trade) => trade.reason === "LIQUIDATION").length,
    totalFeesInr: totalFees,
    totalTdsInr: totalTds,
    totalSlippageCostInr: totalSlippageCost,
    captureRatio: Number.isFinite(btcNetPct) && btcNetPct !== 0
      ? netReturnPct / btcNetPct
      : null,
    durationDays: (toMs - fromMs) / DAY_MS,
  };
}

async function runSessionMomentumBacktest({
  from = DEFAULT_FROM,
  to = Date.now(),
  interval = "1h",
  sessionMinutes = 60,
  trailPct = 6,
  leverage = 5,
  maxPositions = 2,
  smallCoinMaxHoldHours = 24,
  cooldownMinutes = 30,
  minVolumeINR = DEFAULT_MIN_VOLUME_INR,
  universeSize = DEFAULT_UNIVERSE_SIZE,
  minOrderINR = DEFAULT_MIN_ORDER_INR,
  initialEquity = 100_000,
  feePct = 0.1,
  tdsPct = 1,
  symbols = null,
  candlesBySymbol = null,
  bigCoinSymbols = null,
  concurrency = Math.max(1, Number(process.env.SESSION_BACKTEST_CONCURRENCY) || 10),
  onLog = null,
  quiet = false,
} = {}) {
  if (!new Set(["15m", "1h"]).has(interval)) {
    throw new Error('Session Momentum interval must be "15m" or "1h"');
  }
  const intervalMs = INTERVAL_MS[interval];
  const fromMs = toMillis(from, Date.parse(DEFAULT_FROM));
  const toMs = toMillis(to, Date.now());
  if (!(fromMs < toMs)) throw new Error("`from` must be before `to`");
  const sessionMs = Math.max(1, Number(sessionMinutes)) * 60_000;
  const cap = Math.max(1, Math.floor(Number(maxPositions) || 2));
  const leverageValue = Math.min(5, Math.max(1, Number(leverage) || 5));
  const floor = Math.max(0, Number(minVolumeINR) || DEFAULT_MIN_VOLUME_INR);
  const logs = [];
  const log = createLogger(onLog, logs, quiet);
  const fetchFromMs = fromMs - DAY_MS - 2 * intervalMs;

  log(
    `Strategy=sessionMomentum from=${new Date(fromMs).toISOString()} ` +
    `to=${new Date(toMs).toISOString()} interval=${interval}`,
  );
  log(
    `Config session=${sessionMinutes}m trail=${trailPct}% leverage=${leverageValue}x ` +
    `maxPositions=${cap} smallMaxHold=${smallCoinMaxHoldHours}h`,
  );
  log("Fetching qualified top-gainers history...");

  const allCandidates = await candidateMarkets(symbols, candlesBySymbol);
  const selectedCandidates = await prefilterMarkets({
    symbols: allCandidates,
    fromMs,
    toMs,
    minVolumeINR: floor,
    candlesBySymbol,
    concurrency,
    log,
  });
  const loaded = await mapLimit(selectedCandidates, concurrency, async (symbol) => {
    try {
      const source = candlesBySymbol?.[symbol] ||
        await fetchHistoricalCandles(symbol, interval, fetchFromMs, toMs);
      const candles = normalizeCandles(source, fetchFromMs, toMs);
      return { symbol, candles };
    } catch (error) {
      log(`HISTORY_SKIP ${symbol}: ${error.message}`);
      return { symbol, candles: [], error: error.message };
    }
  });
  const usable = loaded.filter((item) => item.candles.length > Math.ceil(DAY_MS / intervalMs));
  const candleCount = usable.reduce((sum, item) => sum + item.candles.length, 0);
  const allTimes = usable.flatMap((item) => item.candles.map((candle) => candle.time));
  log(`Received ${candleCount} ${interval} candles across ${usable.length} usable INR markets`);
  if (!usable.length) throw new Error("No INR markets had enough intraday history for a 24h ranking");

  const fetchedBigCoins = bigCoinSymbols || await fetchTopMarketCap();
  const bigCoinResult = bigCoinSymbols
    ? { symbols: bigCoinSymbols, source: "provided" }
    : { ...getBigCoinsState(), symbols: fetchedBigCoins };
  const bigCoins = new Set((bigCoinResult.symbols || []).map((item) =>
    String(item).toUpperCase(),
  ));
  log(`Big coins (${bigCoinResult.source || "provided"}): ${[...bigCoins].join(", ")}`);

  const bySymbol = new Map();
  for (const item of usable) {
    bySymbol.set(item.symbol, {
      ...item,
      byTime: new Map(item.candles.map((candle) => [candle.time, candle])),
      metrics: buildRollingMetrics(item.candles, intervalMs),
    });
  }
  const eventTimes = [...new Set(usable.flatMap((item) => item.candles
    .filter((candle) => candle.time >= fromMs && candle.time <= toMs)
    .map((candle) => candle.time)))].sort((a, b) => a - b);
  if (!eventTimes.length) throw new Error("No interval boundaries fell inside the requested range");

  let cash = Number(initialEquity);
  let positions = [];
  let sessionExpiresAt = null;
  const cooldowns = {};
  const trades = [];
  const equityCurve = [];
  let positionsOpened = 0;
  let sessionsRun = 0;
  let totalFees = 0;
  let totalTds = 0;
  let totalSlippageCost = 0;

  function dailyVolumeFor(symbol, time, candle) {
    return bySymbol.get(symbol)?.metrics.get(time)?.dailyVolumeINR ||
      (candle ? candle.close * candle.volume * (DAY_MS / intervalMs) : floor);
  }

  function markFor(position, time, field = "open") {
    const candle = bySymbol.get(position.symbol)?.byTime.get(time);
    return candle?.[field] || position.currentPrice || position.entryPrice;
  }

  function closePosition(position, rawPrice, time, reason, dailyVolumeINR) {
    const slip = exitPriceWithSlippage(
      rawPrice,
      Number(position.exposureINR) || Number(position.marginINR) * leverageValue,
      dailyVolumeINR,
    );
    const trade = settleLeveragedPosition(position, slip.fillPrice, {
      timestamp: time,
      reason,
      feePct,
      tdsPct,
      rawExitPrice: rawPrice,
      exitSlippagePct: slip.slippagePct,
    });
    cash += trade.cashReturnedINR;
    positions = positions.filter((item) => item !== position);
    cooldowns[position.symbol] = time + cooldownMinutes * 60_000;
    totalFees += trade.sellFee;
    totalTds += trade.tds;
    totalSlippageCost += trade.exitSlippageCostINR;
    trades.push(trade);
    if (reason === "LIQUIDATION" || reason === "MAX_HOLD_EXPIRED") {
      log(
        `SELL ${position.symbol} ${reason} raw=${rawPrice.toFixed(8)} ` +
        `fill=${slip.fillPrice.toFixed(8)} net=${trade.netPnL.toFixed(2)}`,
      );
    }
    return trade;
  }

  for (const time of eventTimes) {
    const candlesNow = new Map();
    for (const [symbol, item] of bySymbol) {
      const candle = item.byTime.get(time);
      if (candle) candlesNow.set(symbol, candle);
    }

    // A boundary is the historical equivalent of the user starting or
    // renewing a session. At a boundary on/after the absolute deadline the
    // old session is flattened first; a sub-hour interval renews it before
    // the deadline, matching the requested "start at every boundary" rule.
    if (sessionExpiresAt !== null && time >= sessionExpiresAt) {
      for (const position of [...positions]) {
        const candle = candlesNow.get(position.symbol);
        const rawPrice = candle?.open || markFor(position, time);
        closePosition(
          position,
          rawPrice,
          time,
          "SESSION_EXPIRED",
          dailyVolumeFor(position.symbol, time, candle),
        );
      }
    }
    sessionExpiresAt = time + sessionMs;
    sessionsRun += 1;

    for (const position of [...positions]) {
      const candle = candlesNow.get(position.symbol);
      if (!candle) continue;
      const volume = dailyVolumeFor(position.symbol, time, candle);
      const liquidation = liquidationPrice(position);
      if (candle.open <= liquidation) {
        closePosition(position, candle.open, time, "LIQUIDATION", volume);
        continue;
      }
      if (candle.open <= position.stopPrice) {
        closePosition(position, candle.open, time, "STOP_HIT", volume);
        continue;
      }
      if (!position.isBigCoin && time - position.entryTime >= smallCoinMaxHoldHours * HOUR_MS) {
        closePosition(position, candle.open, time, "MAX_HOLD_EXPIRED", volume);
      }
    }

    const ranking = [];
    for (const [symbol, item] of bySymbol) {
      const metric = item.metrics.get(time);
      const candle = item.byTime.get(time);
      if (!metric || !candle || metric.dailyVolumeINR < floor) continue;
      ranking.push({
        symbol,
        change24h: metric.change24h,
        dailyVolumeINR: metric.dailyVolumeINR,
        candle,
      });
    }
    ranking.sort((a, b) => b.change24h - a.change24h || b.dailyVolumeINR - a.dailyVolumeINR);
    const universe = ranking.slice(0, Math.max(1, Number(universeSize) || DEFAULT_UNIVERSE_SIZE));

    if (cash > 0 && positions.length < cap) {
      const held = new Set(positions.map((position) => position.symbol));
      const selected = universe.find((row) =>
        !held.has(row.symbol) && !(Number(cooldowns[row.symbol]) > time),
      );
      if (selected) {
        const remainingSlots = cap - positions.length;
        const marginINR = cash / remainingSlots;
        const exposureINR = marginINR * leverageValue;
        if (exposureINR >= Number(minOrderINR)) {
          const entrySlip = entryPriceWithSlippage(
            selected.candle.open,
            exposureINR,
            selected.dailyVolumeINR,
          );
          const position = createLeveragedPosition({
            symbol: selected.symbol,
            entryPrice: entrySlip.fillPrice,
            rawEntryPrice: selected.candle.open,
            sizeINR: marginINR,
            leverage: leverageValue,
            timestamp: time,
            trailPct,
            feePct,
            entrySlippagePct: entrySlip.slippagePct,
          });
          const asset = String(selected.symbol).toUpperCase().replace(/^[A-Z]+-/, "")
            .replace(/_?INR$/, "");
          position.isBigCoin = bigCoins.has(asset);
          position.entryDailyVolumeINR = selected.dailyVolumeINR;
          position.entryRank = universe.indexOf(selected) + 1;
          positions.push(position);
          cash -= marginINR;
          positionsOpened += 1;
          totalFees += position.entryFee;
          totalSlippageCost += position.entrySlippageCostINR;
        }
      }
    }

    // Continuous paths touch the 6% stop before the 18% (at 5x) liquidation
    // level. Liquidation is therefore a gap-at-open event; ordinary intrabar
    // lows fill the existing stop first. The high ratchets only after that
    // conservative stop check, avoiding an unknowable OHLC path assumption.
    for (const position of [...positions]) {
      const candle = candlesNow.get(position.symbol);
      if (!candle) continue;
      const volume = dailyVolumeFor(position.symbol, time, candle);
      if (candle.low <= position.stopPrice) {
        closePosition(position, position.stopPrice, time, "STOP_HIT", volume);
        continue;
      }
      if (candle.high > position.highestPrice) {
        position.highestPrice = candle.high;
        position.stopPrice = Math.max(
          position.stopPrice,
          candle.high * (1 - Number(trailPct) / 100),
        );
      }
      position.currentPrice = candle.close;
      position.updatedAt = time;
    }

    const equity = cash + positions.reduce((sum, position) =>
      sum + positionEquity(position, markFor(position, time, "close")), 0);
    equityCurve.push({ time, equity });
  }

  const finalTime = eventTimes.at(-1);
  for (const position of [...positions]) {
    const candle = bySymbol.get(position.symbol)?.byTime.get(finalTime);
    const rawPrice = candle?.close || position.currentPrice || position.entryPrice;
    closePosition(
      position,
      rawPrice,
      finalTime,
      "BACKTEST_END",
      dailyVolumeFor(position.symbol, finalTime, candle),
    );
  }
  if (equityCurve.length) equityCurve[equityCurve.length - 1].equity = cash;

  let btcCandles = usable.find((item) => /(^I-|^B-)?BTC_?INR$/i.test(item.symbol))?.candles;
  if (!btcCandles?.length && !candlesBySymbol) {
    btcCandles = normalizeCandles(
      await fetchHistoricalCandles("I-BTC_INR", interval, fromMs, toMs),
      fromMs,
      toMs,
    );
  }
  const btcBuyAndHold = buildBuyAndHold(btcCandles || [], fromMs, toMs, Number(initialEquity));
  const summary = summaryFromRun({
    equityCurve,
    trades,
    initialEquity: Number(initialEquity),
    totalFees,
    totalTds,
    totalSlippageCost,
    sessionsRun,
    positionsOpened,
    fromMs,
    toMs,
    btcBuyAndHold,
  });

  log("FINAL STATS — SESSION MOMENTUM");
  log(
    `net=${summary.netReturnPct.toFixed(2)}% gross=${summary.grossReturnPct.toFixed(2)}% ` +
    `maxDD=${summary.maxDrawdownPct.toFixed(2)}% sessions=${summary.sessionsRun}`,
  );
  log(
    `positions=${summary.positionsOpened} winRate=${Number(summary.winRatePct || 0).toFixed(2)}% ` +
    `avgR=${Number(summary.avgRMultiple || 0).toFixed(3)} liquidations=${summary.liquidations}`,
  );
  log(
    `fees=₹${summary.totalFeesInr.toFixed(2)} TDS=₹${summary.totalTdsInr.toFixed(2)} ` +
    `capture=${Number(summary.captureRatio || 0).toFixed(3)}x`,
  );
  if (btcBuyAndHold) {
    log(
      `BTC BUY & HOLD net=${btcBuyAndHold.summary.netReturnPct.toFixed(2)}% ` +
      `gross=${btcBuyAndHold.summary.grossReturnPct.toFixed(2)}% ` +
      `maxDD=${btcBuyAndHold.summary.maxDrawdownPct.toFixed(2)}%`,
    );
  }
  log(
    `Backtest complete: netPct=${summary.netReturnPct.toFixed(2)} ` +
    `trades=${summary.positionsOpened} winRate=${Number(summary.winRatePct || 0).toFixed(1)}`,
  );

  const label = interval === "1h"
    ? "Session Momentum @ YTD 2026 1h"
    : "Session Momentum @ Last 7 days 15m";
  const result = {
    strategy: "sessionMomentum",
    label,
    from: fromMs,
    to: toMs,
    interval,
    initialEquity: Number(initialEquity),
    config: {
      universe: "Qualified CoinDCX INR top gainers",
      minVolumeINR: floor,
      universeSize,
      sessionMinutes: Number(sessionMinutes),
      trailPct: Number(trailPct),
      leverage: leverageValue,
      maxPositions: cap,
      smallCoinMaxHoldHours: Number(smallCoinMaxHoldHours),
      cooldownMinutes: Number(cooldownMinutes),
      feePct: Number(feePct),
      tdsPct: Number(tdsPct),
    },
    candleCount,
    candleRange: {
      first: allTimes.reduce((minimum, value) => Math.min(minimum, value), Infinity),
      last: allTimes.reduce((maximum, value) => Math.max(maximum, value), -Infinity),
    },
    universe: {
      candidateCount: allCandidates.length,
      prefilteredCount: selectedCandidates.length,
      usableCount: usable.length,
      maxRanked: Number(universeSize),
      minVolumeINR: floor,
      symbols: usable.map((item) => item.symbol),
      bigCoins: [...bigCoins],
    },
    summary,
    trades,
    equityCurve,
    btcBuyAndHold,
    comparison: {
      period: { from: fromMs, to: toMs, interval },
      strategy: { label, summary },
      benchmark: { label: "BTC Buy & Hold (1x, no session)", summary: btcBuyAndHold?.summary || null },
    },
    log: logs,
  };

  saveBacktest({
    strategy_name: "session-momentum",
    symbol: "ALL_INR",
    interval,
    from_date: fromMs,
    to_date: toMs,
    net_return: summary.netReturnPct,
    gross_return: summary.grossReturnPct,
    sharpe: null,
    max_drawdown: summary.maxDrawdownPct,
    win_rate: summary.winRatePct,
    total_trades: summary.positionsOpened,
    created_at: Date.now(),
  });
  return result;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) args[argv[index].slice(2)] = argv[index + 1];
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await runSessionMomentumBacktest({
    from: args.from || DEFAULT_FROM,
    to: args.to || Date.now(),
    interval: args.interval || "1h",
    sessionMinutes: Number(args.sessionMinutes) || 60,
    trailPct: Number(args.trailPct) || 6,
    leverage: Number(args.leverage) || 5,
    maxPositions: Number(args.maxPositions) || 2,
    smallCoinMaxHoldHours: Number(args.smallCoinMaxHoldHours) || 24,
    initialEquity: Number(args.equity) || 100_000,
  });
  const outputDirectory = path.join(__dirname, "..", "backtest-results");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputFile = path.join(
    outputDirectory,
    `session-momentum-${result.interval}-${Date.now()}.json`,
  );
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  console.log(`Result written to ${outputFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Session Momentum backtest failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_FROM,
  DEFAULT_MIN_ORDER_INR,
  DEFAULT_MIN_VOLUME_INR,
  buildRollingMetrics,
  normalizeCandles,
  runSessionMomentumBacktest,
  summaryFromRun,
};
