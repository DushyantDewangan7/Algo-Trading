"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runTopGainersBacktest } = require("../strategy/top-gainers-backtest");

const DAY_MS = 86_400_000;

function makeCandles(start, end, phase = 0) {
  const candles = [];
  let previous = 100 + phase;
  for (let time = start; time <= end; time += DAY_MS) {
    const day = Math.round((time - start) / DAY_MS);
    const direction = (day + phase) % 4 < 2 ? 1.04 : 0.96;
    const open = previous;
    const close = open * direction;
    candles.push({
      time,
      open,
      high: Math.max(open, close) * 1.015,
      low: Math.min(open, close) * 0.985,
      close,
      volume: 1_000_000,
    });
    previous = close;
  }
  return candles;
}

test("2024-01-01 through 2024-06-30 returns no trade timestamp outside the submitted UTC date range", async () => {
  const from = Date.parse("2024-01-01T00:00:00Z");
  const to = Date.parse("2024-06-30T23:59:59Z");
  const warmupStart = from - 31 * DAY_MS;
  const result = await runTopGainersBacktest({
    from,
    to,
    symbols: ["AAAINR", "BBBINR"],
    candlesBySymbol: {
      AAAINR: makeCandles(warmupStart, to, 0),
      BBBINR: makeCandles(warmupStart, to, 1),
    },
    minVolumeINR: 1,
    maxPositions: 2,
    initialEquity: 10_000,
    onLog: () => {},
    quiet: true,
  });

  assert.ok(result.trades.length > 0, "fixture should produce at least one completed trade");
  for (const trade of result.trades) {
    assert.ok(trade.entryTime >= from && trade.entryTime <= to, `${trade.symbol} entry was outside range`);
    assert.ok(trade.exitTime >= from && trade.exitTime <= to, `${trade.symbol} exit was outside range`);
  }
});
