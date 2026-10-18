"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runFutures } = require("../research/futures-engine");

const H = 3_600_000;
const T0 = Date.UTC(2024, 0, 1);
function bars(rows) {
  // rows: [open, high, low, close]
  return {
    time: rows.map((_, i) => T0 + i * H),
    open: Float64Array.from(rows.map((r) => r[0])),
    high: Float64Array.from(rows.map((r) => r[1])),
    low: Float64Array.from(rows.map((r) => r[2])),
    close: Float64Array.from(rows.map((r) => r[3])),
    volume: new Float64Array(rows.length),
  };
}
const flat = (n, p = 100) => Array.from({ length: n }, () => [p, p, p, p]);
const always = (side) => ({ init: () => ({}), signal: () => side });
const NO_COST = { feePct: 0, slippagePct: 0, fundingPct8h: 0, tdsPct: 0, maintenancePct: 0.5 };

test("1x long on a flat price only loses funding: 0.01% per 8h", () => {
  const r = runFutures({ bars: bars(flat(1 + 24 * 3 + 1)), strategy: always(1), leverage: 1, costs: { ...NO_COST, fundingPct8h: 0.01 } });
  // Entry at bar 1; bars 1..73 cross 9 funding boundaries in 3 days.
  assert.ok(Math.abs(r.finalMultiple - (1 - 9 * 0.0001)) < 1e-6, String(r.finalMultiple));
});

test("short earns funding and profits when price falls", () => {
  const rows = [[100, 100, 100, 100], [100, 100, 100, 100], [100, 100, 90, 90]];
  const r = runFutures({ bars: bars(rows), strategy: always(-1), leverage: 2, costs: NO_COST });
  assert.ok(Math.abs(r.finalMultiple - 1.2) < 1e-9, String(r.finalMultiple));
});

test("10x long is liquidated by a 10% intrabar drop and the account is wiped", () => {
  const rows = [[100, 100, 100, 100], [100, 100, 100, 100], [100, 101, 89, 99], [99, 99, 99, 99]];
  const r = runFutures({ bars: bars(rows), strategy: always(1), leverage: 10, costs: NO_COST });
  assert.equal(r.liquidated, true);
  assert.equal(r.finalMultiple, 0);
});

test("2x long survives a 10% drop and loses 20%", () => {
  const rows = [[100, 100, 100, 100], [100, 100, 100, 100], [100, 100, 90, 90]];
  const r = runFutures({ bars: bars(rows), strategy: always(1), leverage: 2, costs: NO_COST });
  assert.equal(r.liquidated, false);
  assert.ok(Math.abs(r.finalMultiple - 0.8) < 1e-9);
});

test("taker fee is charged on notional at entry and exit", () => {
  const strategy = { init: () => ({}), signal: (i) => (i < 2 ? 1 : 0) };
  const r = runFutures({ bars: bars(flat(5)), strategy, leverage: 3, costs: { ...NO_COST, feePct: 0.059 } });
  // Entry fee 3 × 0.059% of equity; exit fee on (slightly smaller) notional.
  const afterEntry = 1 - 3 * 0.00059;
  const expected = afterEntry - 3 * 0.00059; // qty × price = original notional (flat price)
  assert.ok(Math.abs(r.finalMultiple - expected) < 1e-9, `${r.finalMultiple} vs ${expected}`);
});
