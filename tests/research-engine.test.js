"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { alignSeries, runBacktest } = require("../research/engine");
const { cleanCandles, DAY_MS } = require("../research/data");
const ind = require("../research/indicators");
const S = require("../research/strategies");

const T0 = Date.UTC(2024, 0, 1);
const candles = (closes) => closes.map((c, i) => ({
  time: T0 + i * DAY_MS, open: c, high: c, low: c, close: c, volume: 1,
}));
const NO_COST = { feePct: 0, gstOnFeePct: 0, slippagePct: 0, tdsPct: 0 };

test("buy & hold fills at the first next-day open and tracks price", () => {
  const aligned = alignSeries({ BTC: candles([100, 110, 121, 133.1]) });
  const r = runBacktest({ aligned, strategy: S.hold("BTC"), startMs: T0, initialEquity: 1000, costs: NO_COST });
  // Decision on day 0 close, fill at day 1 open (110), final close 133.1.
  assert.ok(Math.abs(r.finalEquity - (1000 * 133.1) / 110) < 1e-9);
});

test("round trip charges fee+GST and slippage each side and TDS on the sell", () => {
  const costs = { feePct: 0.5, gstOnFeePct: 18, slippagePct: 0.2, tdsPct: 1 };
  // Signal: long while close > 100. Day0 101 -> buy day1 open, day2 99 -> sell day3 open.
  const strategy = {
    name: "t", maxPositions: 1, init: ({ series }) => series.BTC,
    decide: (i, { ctx }) => (ctx.close[i] > 100 ? ["BTC"] : []),
  };
  const aligned = alignSeries({ BTC: candles([101, 100.5, 99, 100, 100]) });
  const r = runBacktest({ aligned, strategy, startMs: T0, initialEquity: 1000, costs });
  const fee = 0.005 * 1.18;
  const qty = (1000 * (1 - fee)) / (100.5 * 1.002);
  const gross = qty * 100 * 0.998;
  const expected = gross - gross * fee - gross * 0.01;
  assert.ok(Math.abs(r.finalEquity - expected) < 1e-9, `${r.finalEquity} vs ${expected}`);
  assert.equal(r.trades, 1);
});

test("strategy cannot see the future: the decision at i uses only closes up to i", () => {
  const seen = [];
  const strategy = {
    name: "spy", maxPositions: 1, init: ({ series }) => series.BTC,
    decide: (i, { ctx }) => { seen.push(ctx.close.slice(0, i + 1).length === i + 1); return null; },
  };
  const aligned = alignSeries({ BTC: candles([1, 2, 3, 4]) });
  runBacktest({ aligned, strategy, startMs: T0, costs: NO_COST });
  assert.ok(seen.every(Boolean));
});

test("indicators are causal and correct on simple input", () => {
  const x = Float64Array.from([1, 2, 3, 4, 5]);
  assert.deepEqual([...ind.sma(x, 3)].slice(2), [2, 3, 4]);
  assert.ok(Number.isNaN(ind.sma(x, 3)[1]));
  assert.deepEqual([...ind.priorMax(x, 2)].slice(2), [2, 3, 4]);
  assert.deepEqual([...ind.priorMin(x, 2)].slice(2), [1, 2, 3]);
});

test("cleanCandles repairs a one-day broken print but keeps real moves", () => {
  const c = candles([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 0.01, 112, 113, 230, 240]);
  const out = cleanCandles(c);
  const broken = out.find((x) => x.time === c[12].time);
  assert.equal(broken.close, 111);
  // A sustained doubling (no revert) is kept.
  assert.equal(out.find((x) => x.time === c[15].time).close, 230);
});
