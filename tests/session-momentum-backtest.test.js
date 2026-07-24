"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runSessionMomentumBacktest } = require("../strategy/session-momentum-backtest");

const HOUR_MS = 3_600_000;

function candles(start, count, drift, volume = 20_000) {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 * (1 + drift) ** index;
    return {
      time: start + index * HOUR_MS,
      open,
      high: open * 1.01,
      low: open * 0.997,
      close: open * (1 + drift),
      volume,
    };
  });
}

test("Session Momentum backtest reports required metrics and a same-window BTC benchmark", async () => {
  const start = Date.UTC(2026, 0, 1);
  const from = start + 25 * HOUR_MS;
  const to = start + 36 * HOUR_MS;
  const result = await runSessionMomentumBacktest({
    from,
    to,
    interval: "1h",
    initialEquity: 1_000,
    symbols: ["BTCINR", "ALTINR"],
    candlesBySymbol: {
      BTCINR: candles(start, 48, 0.001),
      ALTINR: candles(start, 48, 0.002),
    },
    bigCoinSymbols: ["BTC"],
    quiet: true,
  });

  assert.equal(result.strategy, "sessionMomentum");
  assert.equal(result.interval, "1h");
  assert.ok(result.summary.sessionsRun > 0);
  assert.ok(result.summary.positionsOpened > 0);
  assert.ok(Number.isFinite(result.summary.netReturnPct));
  assert.ok(Number.isFinite(result.summary.grossReturnPct));
  assert.ok(Number.isFinite(result.summary.maxDrawdownPct));
  assert.ok(result.summary.totalFeesInr > 0);
  assert.ok(result.summary.totalTdsInr > 0);
  assert.ok(result.btcBuyAndHold);
  assert.equal(result.comparison.benchmark.label, "BTC Buy & Hold (1x, no session)");
  assert.ok(result.trades.every((trade) => trade.entryTime >= from && trade.exitTime <= to));
  assert.ok(result.trades.some((trade) => trade.reason === "SESSION_EXPIRED"));
});
