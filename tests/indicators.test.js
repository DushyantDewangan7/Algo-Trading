const test = require("node:test");
const assert = require("node:assert/strict");

const { ema, rsi, atr, adx, roc, volumeMA } = require("../strategy/indicators");

function assertClose(actual, expected, tolerance, label) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ±${tolerance}, got ${actual}`,
  );
}

test("ema is null before the seed index and SMA-seeded at it", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = ema(values, 3);

  assert.equal(result[0], null);
  assert.equal(result[1], null);
  assert.equal(result[2], 2); // SMA of 1,2,3
  // With period 3 the smoothing factor is 0.5, so on the ramp 1..10 the EMA
  // lands exactly one unit behind the price: 3, 4, 5, ... 9.
  for (let i = 3; i < values.length; i += 1) {
    assertClose(result[i], values[i] - 1, 1e-12, `ema[${i}]`);
  }
});

test("ema of a constant series equals the constant", () => {
  const result = ema(new Array(50).fill(42), 20);
  assert.equal(result[19], 42);
  assertClose(result[49], 42, 1e-12, "ema[49]");
});

test("ema returns all nulls when there is not enough data", () => {
  assert.deepEqual(ema([1, 2, 3], 5), [null, null, null]);
});

test("rsi matches Wilder's reference series (StockCharts QQQQ sample)", () => {
  // Well-known 14-period RSI worked example. First three defined values are
  // 70.53, 66.32, 66.55.
  const closes = [
    44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245,
    45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028,
    46.0328,
  ];
  const result = rsi(closes, 14);

  for (let i = 0; i < 14; i += 1) assert.equal(result[i], null);
  assertClose(result[14], 70.53, 0.05, "rsi[14]");
  assertClose(result[15], 66.32, 0.05, "rsi[15]");
  assertClose(result[16], 66.55, 0.05, "rsi[16]");
});

test("rsi is 100 when the series only rises and 0 when it only falls", () => {
  const rising = rsi([...Array(30)].map((_, i) => 100 + i), 14);
  const falling = rsi([...Array(30)].map((_, i) => 100 - i), 14);
  assert.equal(rising.at(-1), 100);
  assertClose(falling.at(-1), 0, 1e-9, "falling rsi");
});

test("atr matches a hand-computed 3-period example", () => {
  const ohlc = [
    { high: 12, low: 10, close: 11 },
    { high: 13, low: 11, close: 12 }, // TR = max(2, |13-11|, |11-11|) = 2
    { high: 15, low: 12, close: 14 }, // TR = max(3, |15-12|, |12-12|) = 3
    { high: 14, low: 12, close: 13 }, // TR = max(2, |14-14|, |12-14|) = 2
    { high: 16, low: 13, close: 15 }, // TR = max(3, |16-13|, |13-13|) = 3
  ];
  const result = atr(ohlc, 3);

  assert.equal(result[2], null);
  assertClose(result[3], (2 + 3 + 2) / 3, 1e-12, "atr seed"); // ≈ 2.3333
  // Wilder step: (2.3333 * 2 + 3) / 3 ≈ 2.5556
  assertClose(result[4], (result[3] * 2 + 3) / 3, 1e-12, "atr smoothed");
});

test("adx is high in a persistent trend and low in flat chop", () => {
  const trending = [...Array(60)].map((_, i) => ({
    high: 102 + i * 2,
    low: 100 + i * 2,
    close: 101 + i * 2,
  }));
  const flat = [...Array(60)].map(() => ({ high: 101, low: 100, close: 100.5 }));

  const trendAdx = adx(trending, 14).at(-1);
  const flatAdx = adx(flat, 14).at(-1);
  assert.ok(trendAdx > 90, `trending ADX should be near 100, got ${trendAdx}`);
  assertClose(flatAdx, 0, 1e-9, "flat ADX");
});

test("roc measures percentage change over the lookback", () => {
  const result = roc([100, 101, 102, 110, 121], 2);
  assert.equal(result[1], null);
  assertClose(result[2], 2, 1e-12, "roc[2]"); // 102 vs 100
  assertClose(result[4], (121 / 102 - 1) * 100, 1e-12, "roc[4]");
});

test("volumeMA is a simple moving average", () => {
  const result = volumeMA([10, 20, 30, 40], 2);
  assert.deepEqual(result, [null, 15, 25, 35]);
});
