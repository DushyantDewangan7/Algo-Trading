"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  openPosition,
  updatePosition,
  realizePnL,
  isCooldownActive,
} = require("../strategy/trailing-stop");

function position(overrides = {}) {
  return openPosition({
    symbol: "BTCINR",
    price: 100,
    sizeINR: 10_000,
    timestamp: Date.UTC(2024, 0, 1),
    trailPct: 2,
    tpPct: 50,
    ...overrides,
  });
}

test("ratchet raises the stop with price and never lowers it on a drop", () => {
  const open = position();
  updatePosition(open, 110);
  assert.equal(open.highestPrice, 110);
  assert.equal(open.stopPrice, 107.8);
  updatePosition(open, 108);
  assert.equal(open.highestPrice, 110);
  assert.equal(open.stopPrice, 107.8);
});

test("take-profit fires exactly at entry * 1.50", () => {
  const open = position();
  assert.equal(open.takeProfitPrice, 150);
  assert.equal(updatePosition(open, 150).reason, "TP_HIT");
});

test("stop fires at 2% off the highest price since entry, not entry", () => {
  const open = position();
  assert.equal(updatePosition(open, 120).action, "HOLD");
  assert.equal(open.stopPrice, 117.6);
  const result = updatePosition(open, 117.6);
  assert.equal(result.action, "SELL");
  assert.equal(result.reason, "STOP_HIT");
});

test("winning trade PnL includes entry/sell fees and sell-side TDS", () => {
  const open = position();
  const pnl = realizePnL(open, 110);
  assert.ok(pnl.grossPnL > 0);
  assert.ok(pnl.fees > open.entryFee);
  assert.ok(pnl.tds > 0);
  assert.ok(pnl.netPnL < pnl.grossPnL);
  assert.ok(Math.abs(pnl.netPnL - 868.121) < 1e-6, `got ${pnl.netPnL}`);
});

test("losing trade PnL still includes entry/sell fees and sell-side TDS", () => {
  const open = position();
  const pnl = realizePnL(open, 98);
  assert.ok(pnl.grossPnL < 0);
  assert.ok(pnl.fees > 0);
  assert.ok(pnl.tds > 0);
  assert.ok(Math.abs(pnl.netPnL - (-317.4922)) < 1e-6, `got ${pnl.netPnL}`);
});

test("cooldown blocks re-entry inside 24 hours and allows it after expiry", () => {
  const exitTime = Date.UTC(2024, 0, 1);
  const cooldowns = { BTCINR: exitTime + 24 * 60 * 60 * 1000 };
  assert.equal(isCooldownActive(cooldowns, "BTCINR", exitTime + 23 * 60 * 60 * 1000), true);
  assert.equal(isCooldownActive(cooldowns, "BTCINR", exitTime + 24 * 60 * 60 * 1000), false);
});
