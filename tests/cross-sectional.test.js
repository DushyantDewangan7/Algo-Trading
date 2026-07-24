const test = require("node:test");
const assert = require("node:assert/strict");

const {
  rankAndSelect,
  computeMomentumScore,
  computeTrailingReturn,
  computeEmaRegimeSeries,
  isRebalanceCandle,
  latestRebalanceAt,
  rebalanceTimesBetween,
  runCrossSectionalBacktest,
  MOMENTUM_METRIC,
  PREVIOUS_VERSION_OPTIONS,
} = require("../strategy/cross-sectional");

const DAY_MS = 86_400_000;

function makeDailyCandles(count, startTime, driftPerDay, seed = 1) {
  const candles = [];
  let price = 1000;
  let rngState = seed;
  const rand = () => {
    rngState = (rngState * 1103515245 + 12345) % 2 ** 31;
    return rngState / 2 ** 31;
  };
  for (let i = 0; i < count; i += 1) {
    const noise = (rand() - 0.5) * 0.01;
    const open = price;
    const close = Math.max(1, price * (1 + driftPerDay + noise));
    candles.push({
      time: startTime + i * DAY_MS,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 100,
    });
    price = close;
  }
  return candles;
}

test("computeMomentumScore rewards a steady climber over an equally-returning but choppy one", () => {
  const steady = makeDailyCandles(31, 0, 0.01, 1);
  const choppy = makeDailyCandles(31, 0, 0.01, 999).map((candle, i, arr) => {
    // Inject alternating +/- 5% noise on top of the same drift so total
    // return is similar but daily volatility is much higher.
    if (i === 0) return candle;
    const wobble = i % 2 === 0 ? 1.05 : 0.95;
    return { ...candle, close: candle.close * wobble };
  });

  const steadyScore = computeMomentumScore(steady, 30);
  const choppyScore = computeMomentumScore(choppy, 30);
  assert.ok(steadyScore > choppyScore, `expected steady score (${steadyScore}) > choppy score (${choppyScore})`);
});

test("computeMomentumScore returns null with insufficient history", () => {
  assert.equal(computeMomentumScore(makeDailyCandles(10, 0, 0.01), 30), null);
  assert.equal(computeMomentumScore(null, 30), null);
});

test("computeTrailingReturn measures the requested point-to-point lookback return", () => {
  const candles = makeDailyCandles(40, 0, 0.01, 42);
  const expected = candles.at(-1).close / candles.at(-31).close - 1;
  assert.equal(computeTrailingReturn(candles, 30), expected);
  assert.equal(computeTrailingReturn(candles.slice(0, 30), 30), null);
});

test("total-return ranking selects the top two even when the whole cross-section is negative", () => {
  const candlesBySymbol = {
    LEAST_BAD: makeDailyCandles(40, 0, -0.002, 1),
    MIDDLE: makeDailyCandles(40, 0, -0.006, 2),
    WORST: makeDailyCandles(40, 0, -0.012, 3),
  };
  const ranking = rankAndSelect({
    candlesBySymbol,
    lookbackDays: 30,
    topN: 2,
    regime: "TREND_UP",
    momentumMetric: MOMENTUM_METRIC.TOTAL_RETURN,
    requirePositiveMomentum: false,
  });
  assert.deepEqual(
    ranking.filter((row) => row.selected).map((row) => row.symbol),
    ["LEAST_BAD", "MIDDLE"],
  );
});

test("cross-sectional EMA regime depends only on EMA50 versus EMA200, not ADX inputs", () => {
  const base = makeDailyCandles(260, 0, 0.002, 44);
  const differentRanges = base.map((candle, index) => ({
    ...candle,
    high: candle.close * (index % 2 === 0 ? 1.5 : 1.001),
    low: candle.close * (index % 2 === 0 ? 0.5 : 0.999),
  }));
  assert.deepEqual(computeEmaRegimeSeries(differentRanges), computeEmaRegimeSeries(base));
  assert.equal(computeEmaRegimeSeries(base).at(-1), "TREND_UP");
});

test("rankAndSelect picks the top N positive-momentum symbols equal-weight in TREND_UP", () => {
  const candlesBySymbol = {
    WINNER: makeDailyCandles(40, 0, 0.02, 1),
    RUNNER_UP: makeDailyCandles(40, 0, 0.01, 2),
    LAGGARD: makeDailyCandles(40, 0, -0.01, 3),
  };

  const ranking = rankAndSelect({ candlesBySymbol, lookbackDays: 30, topN: 2, regime: "TREND_UP" });
  const bySymbol = Object.fromEntries(ranking.map((row) => [row.symbol, row]));

  assert.equal(bySymbol.WINNER.selected, true);
  assert.equal(bySymbol.RUNNER_UP.selected, true);
  assert.equal(bySymbol.LAGGARD.selected, false);
  assert.equal(bySymbol.WINNER.weight, 0.5);
  assert.equal(bySymbol.RUNNER_UP.weight, 0.5);
  assert.equal(bySymbol.LAGGARD.weight, 0);
  // WINNER (steeper drift) should rank strictly above RUNNER_UP.
  assert.ok(ranking.findIndex((r) => r.symbol === "WINNER") < ranking.findIndex((r) => r.symbol === "RUNNER_UP"));
});

test("rankAndSelect forces 100% cash (all weights 0) outside TREND_UP", () => {
  const candlesBySymbol = {
    WINNER: makeDailyCandles(40, 0, 0.02, 1),
    RUNNER_UP: makeDailyCandles(40, 0, 0.01, 2),
  };

  for (const regime of ["TREND_DOWN", "RANGE"]) {
    const ranking = rankAndSelect({ candlesBySymbol, lookbackDays: 30, topN: 2, regime });
    assert.ok(ranking.every((row) => row.weight === 0 && row.selected === false), `regime ${regime} should force cash`);
    // Ranking itself should still be populated (informational, "who would have won").
    assert.equal(ranking.length, 2);
  }
});

test("rankAndSelect gives a lone qualifier one slot's weight (1/topN), not the whole portfolio", () => {
  const candlesBySymbol = {
    ONLY_WINNER: makeDailyCandles(40, 0, 0.02, 1),
    LAGGARD: makeDailyCandles(40, 0, -0.01, 2),
  };
  const ranking = rankAndSelect({ candlesBySymbol, lookbackDays: 30, topN: 2, regime: "TREND_UP" });
  const winner = ranking.find((row) => row.symbol === "ONLY_WINNER");
  assert.equal(winner.selected, true);
  assert.equal(winner.weight, 0.5); // 1/topN, not 1/1 — the unfilled slot stays in cash
});

test("rankAndSelect never selects a symbol with negative momentum even with cash to spare", () => {
  const candlesBySymbol = {
    ONLY_LOSER: makeDailyCandles(40, 0, -0.01, 1),
  };
  const ranking = rankAndSelect({ candlesBySymbol, lookbackDays: 30, topN: 2, regime: "TREND_UP" });
  assert.equal(ranking[0].selected, false);
  assert.equal(ranking[0].weight, 0);
});

test("rebalance helpers fire at exactly Monday 00:00 IST", () => {
  // Monday 2026-01-05 00:00 IST is Sunday 2026-01-04 18:30 UTC.
  const mondayIst = Date.UTC(2026, 0, 4, 18, 30, 0);
  assert.equal(isRebalanceCandle({ time: mondayIst }), true);
  assert.equal(isRebalanceCandle({ time: mondayIst - 30 * 60_000 }), false);
  assert.equal(isRebalanceCandle({ time: mondayIst + 30 * 60_000 }), false);
  assert.equal(latestRebalanceAt(mondayIst + 3 * DAY_MS), mondayIst);

  assert.deepEqual(
    rebalanceTimesBetween(mondayIst - DAY_MS, mondayIst + 8 * DAY_MS),
    [mondayIst, mondayIst + 7 * DAY_MS],
  );

  const biweeklyStart = latestRebalanceAt(mondayIst + 14 * DAY_MS, 2);
  assert.equal(isRebalanceCandle({ time: biweeklyStart }, 2), true);
  assert.equal(isRebalanceCandle({ time: biweeklyStart + 7 * DAY_MS }, 2), false);
  assert.deepEqual(
    rebalanceTimesBetween(biweeklyStart, biweeklyStart + 28 * DAY_MS, 2),
    [biweeklyStart, biweeklyStart + 14 * DAY_MS, biweeklyStart + 28 * DAY_MS],
  );
});

test("previous cross-sectional version rebalances continuing holdings back to equal weight", async () => {
  const start = Date.UTC(2024, 0, 1);
  const btc = makeDailyCandles(280, start, 0.01, 11);
  const alt = makeDailyCandles(280, start, 0.015, 12);
  const from = start + 230 * DAY_MS;
  const to = from + 21 * DAY_MS;
  const events = rebalanceTimesBetween(from, to);

  function executionSeries(basePrice) {
    return [
      ...events.map((time, index) => ({
        time,
        open: basePrice * (1 + index * 0.03),
        high: basePrice * (1 + index * 0.03),
        low: basePrice * (1 + index * 0.03),
        close: basePrice * (1 + index * 0.03),
        volume: 100,
      })),
      {
        time: to - 30 * 60_000,
        open: basePrice * 1.1,
        high: basePrice * 1.1,
        low: basePrice * 1.1,
        close: basePrice * 1.1,
        volume: 100,
      },
    ];
  }

  const result = await runCrossSectionalBacktest({
    ...PREVIOUS_VERSION_OPTIONS,
    symbols: ["I-BTC_INR", "ALT"],
    from,
    to,
    lookbackDays: 30,
    topN: 2,
    feePct: 0,
    tdsPct: 0,
    candlesBySymbol: { "I-BTC_INR": btc, ALT: alt },
    regimeCandles: btc,
    executionCandlesBySymbol: {
      "I-BTC_INR": executionSeries(1000),
      ALT: executionSeries(1200),
    },
  });

  assert.equal(result.rebalanceCount, events.length);
  assert.ok(result.rebalanceLog.some((entry) => entry.holdings.length === 2));
  for (const entry of result.rebalanceLog.filter((item) => item.holdings.length === 2)) {
    assert.ok(isRebalanceCandle({ time: entry.time }));
    for (const holding of entry.holdings) {
      assert.ok(Math.abs(holding.weight - 0.5) < 1e-9, `${holding.symbol} weight was ${holding.weight}`);
    }
  }
});

test("requested cross-sectional version skips a scheduled rebalance when holdings are unchanged", async () => {
  const start = Date.UTC(2024, 0, 1);
  const btc = makeDailyCandles(300, start, 0.01, 21);
  const alt = makeDailyCandles(300, start, 0.015, 22);
  const from = start + 230 * DAY_MS;
  const to = from + 42 * DAY_MS;
  const events = rebalanceTimesBetween(from, to, 2);

  function executionSeries(basePrice) {
    return [
      ...events.map((time, index) => ({
        time,
        open: basePrice * (1 + index * 0.04),
        high: basePrice * (1 + index * 0.04),
        low: basePrice * (1 + index * 0.04),
        close: basePrice * (1 + index * 0.04),
        volume: 100,
      })),
      {
        time: to - 30 * 60_000,
        open: basePrice * 1.15,
        high: basePrice * 1.15,
        low: basePrice * 1.15,
        close: basePrice * 1.15,
        volume: 100,
      },
    ];
  }

  const result = await runCrossSectionalBacktest({
    symbols: ["I-BTC_INR", "ALT"],
    from,
    to,
    feePct: 0,
    tdsPct: 0,
    candlesBySymbol: { "I-BTC_INR": btc, ALT: alt },
    regimeCandles: btc,
    executionCandlesBySymbol: {
      "I-BTC_INR": executionSeries(1000),
      ALT: executionSeries(1200),
    },
  });

  assert.equal(result.rebalanceDecisionCount, events.length);
  assert.equal(result.rebalanceCount, 1);
  assert.equal(result.skippedRebalanceCount, events.length - 1);
  assert.equal(result.rebalanceLog[0].skipped, false);
  assert.ok(result.rebalanceLog.slice(1).every((entry) => entry.skipped));
  for (const event of events.slice(1)) {
    assert.equal(result.trades.some((trade) => trade.time === event), false);
  }
});
