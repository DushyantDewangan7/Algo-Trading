const test = require("node:test");
const assert = require("node:assert/strict");

const { generateSignal, requiredHistory } = require("../strategy/momentum");

function makeCandles(count) {
  return Array.from({ length: count }, (_, index) => ({
    time: index * 3_600_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 100,
  }));
}

test("flat momentum entries fail safe to HOLD unless regime is TREND_UP", () => {
  const candles = makeCandles(requiredHistory());

  for (const regime of [null, undefined, "RANGE", "TREND_DOWN"]) {
    const signal = generateSignal(candles, null, {}, regime);
    assert.equal(signal.action, "HOLD");
    assert.match(signal.reason, /Regime filter/);
  }

  const explicitlyDisabled = generateSignal(candles, null, {}, false);
  assert.equal(explicitlyDisabled.action, "HOLD");
  assert.doesNotMatch(explicitlyDisabled.reason, /Regime filter/);
});
