const test = require("node:test");
const assert = require("node:assert/strict");

const { getRegime, computeRegimeSeries, REGIME, requiredRegimeHistory, alignDailyRegime } = require("../strategy/regime");

const DAY_MS = 86_400_000;

function makeTrendingCandles(count, driftPerDay) {
  const candles = [];
  let price = 1000;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const close = price * (1 + driftPerDay);
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    candles.push({ time: i * DAY_MS, open, high, low, close, volume: 100 });
    price = close;
  }
  return candles;
}

function makeFlatCandles(count) {
  const candles = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  for (let i = 0; i < count; i += 1) {
    const wiggle = 1 + (rand() - 0.5) * 0.004; // tiny, directionless noise
    const open = 1000 * wiggle;
    const close = 1000 * (1 + (rand() - 0.5) * 0.004);
    candles.push({
      time: i * DAY_MS,
      open,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      close,
      volume: 100,
    });
  }
  return candles;
}

test("returns null before there is enough history", () => {
  const candles = makeTrendingCandles(50, 0.01);
  assert.equal(getRegime(candles), null);
  assert.equal(getRegime([]), null);
});

test("classifies a strong sustained uptrend as TREND_UP", () => {
  const candles = makeTrendingCandles(requiredRegimeHistory() + 40, 0.015);
  assert.equal(getRegime(candles), REGIME.TREND_UP);
});

test("classifies a strong sustained downtrend as TREND_DOWN", () => {
  const candles = makeTrendingCandles(requiredRegimeHistory() + 40, -0.015);
  assert.equal(getRegime(candles), REGIME.TREND_DOWN);
});

test("classifies flat, directionless chop as RANGE", () => {
  const candles = makeFlatCandles(requiredRegimeHistory() + 40);
  assert.equal(getRegime(candles), REGIME.RANGE);
});

test("computeRegimeSeries is causal: earlier values don't change as later candles are appended", () => {
  const base = makeTrendingCandles(requiredRegimeHistory() + 10, 0.01);
  const extended = [...base, ...makeTrendingCandles(20, -0.02).map((c, i) => ({ ...c, time: base.length * DAY_MS + i * DAY_MS }))];

  const seriesBase = computeRegimeSeries(base);
  const seriesExtended = computeRegimeSeries(extended);

  for (let i = 0; i < seriesBase.length; i += 1) {
    assert.equal(seriesExtended[i], seriesBase[i], `regime at index ${i} should be unchanged by future candles`);
  }
});

test("alignDailyRegime never lets an intraday bar see a same-day (unclosed) daily regime", () => {
  const dailyCandles = makeTrendingCandles(requiredRegimeHistory() + 20, 0.01);
  const regimeSeries = computeRegimeSeries(dailyCandles);
  const lastDailyIndex = dailyCandles.length - 1;
  const lastDailyTime = dailyCandles[lastDailyIndex].time;

  // An intraday bar opening mid-way through the LAST daily candle's day
  // must only see the regime as of the PREVIOUS daily close.
  const intraday = [{ time: lastDailyTime + 4 * 3_600_000 }];
  const aligned = alignDailyRegime(intraday, dailyCandles, regimeSeries);

  assert.equal(aligned[0], regimeSeries[lastDailyIndex - 1]);
});
