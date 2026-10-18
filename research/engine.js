"use strict";

// Long-only spot portfolio backtester for daily candles.
//
// Timing: a strategy sees data up to and including day i's close and returns
// the set of symbols it wants to hold. Orders fill at day i+1's open, so there
// is no lookahead. Holdings are equal-slot: a coin that stays selected is not
// trimmed or topped up (a ₹200 account can't do tiny rebalances anyway); new
// entries split the free cash across the empty slots.
//
// Costs per side: exchange fee (+18% GST on the fee) and slippage. Every sell
// also loses TDS on the gross proceeds. TDS can be claimed back in the tax
// return, but it leaves the account immediately, so it is modelled as a cost.

const { DAY_MS } = require("./data");

const DEFAULT_COSTS = { feePct: 0.5, gstOnFeePct: 18, slippagePct: 0.2, tdsPct: 1 };

function alignSeries(data) {
  const days = new Set();
  for (const candles of Object.values(data)) for (const c of candles) days.add(c.time);
  const calendar = [...days].sort((a, b) => a - b);
  const index = new Map(calendar.map((t, i) => [t, i]));
  const series = {};
  for (const [symbol, candles] of Object.entries(data)) {
    const n = calendar.length;
    const s = {
      open: new Float64Array(n).fill(NaN),
      high: new Float64Array(n).fill(NaN),
      low: new Float64Array(n).fill(NaN),
      close: new Float64Array(n).fill(NaN),
      volume: new Float64Array(n).fill(0),
      live: new Uint8Array(n), // 1 when this day has a real candle
    };
    for (const c of candles) {
      const i = index.get(c.time);
      s.open[i] = c.open; s.high[i] = c.high; s.low[i] = c.low; s.close[i] = c.close;
      s.volume[i] = c.volume; s.live[i] = 1;
    }
    // Forward-fill gaps after listing so marks and indicators stay continuous.
    for (let i = 1; i < n; i += 1) {
      if (!s.live[i] && Number.isFinite(s.close[i - 1])) {
        const p = s.close[i - 1];
        s.open[i] = p; s.high[i] = p; s.low[i] = p; s.close[i] = p;
      }
    }
    series[symbol] = s;
  }
  return { calendar, series };
}

function runBacktest({
  aligned,
  strategy,
  startMs,
  endMs = Infinity,
  initialEquity = 100_000,
  costs = DEFAULT_COSTS,
}) {
  const { calendar, series } = aligned;
  const ctx = strategy.init({ calendar, series });
  const maxSlots = strategy.maxPositions || 1;
  const feeRate = (costs.feePct / 100) * (1 + costs.gstOnFeePct / 100);
  const slip = costs.slippagePct / 100;
  const tds = costs.tdsPct / 100;

  let cash = initialEquity;
  const holdings = new Map(); // symbol -> { qty, entryCost, entryDay }
  let pending = null; // target set decided at previous close
  const equity = [];
  const trades = [];
  let totalCosts = 0;
  let exposedDays = 0;

  const startIdx = calendar.findIndex((t) => t >= startMs);
  if (startIdx < 0) throw new Error("start beyond data");

  for (let i = startIdx; i < calendar.length && calendar[i] <= endMs; i += 1) {
    // 1. Execute yesterday's decision at today's open.
    if (pending) {
      for (const [symbol, h] of [...holdings]) {
        if (pending.has(symbol)) continue;
        const px = series[symbol].open[i] * (1 - slip);
        const gross = h.qty * px;
        const fee = gross * feeRate;
        const tdsAmt = gross * tds;
        const slipCost = h.qty * series[symbol].open[i] * slip;
        cash += gross - fee - tdsAmt;
        totalCosts += fee + tdsAmt + slipCost;
        trades.push({
          symbol, entryDay: h.entryDay, exitDay: calendar[i],
          pnlPct: ((gross - fee - tdsAmt) / h.entryCost - 1) * 100,
        });
        holdings.delete(symbol);
      }
      const toBuy = [...pending].filter((s) => !holdings.has(s) && series[s].live[i]);
      const freeSlots = Math.max(0, maxSlots - holdings.size);
      const buys = toBuy.slice(0, freeSlots);
      for (let k = 0; k < buys.length; k += 1) {
        const symbol = buys[k];
        const budget = cash / (freeSlots - k);
        if (budget <= 1e-9) break;
        const px = series[symbol].open[i] * (1 + slip);
        const fee = budget * feeRate;
        const qty = (budget - fee) / px;
        totalCosts += fee + qty * series[symbol].open[i] * slip;
        cash -= budget;
        holdings.set(symbol, { qty, entryCost: budget, entryDay: calendar[i] });
      }
      pending = null;
    }

    // 2. Mark to market at today's close.
    let value = cash;
    for (const [symbol, h] of holdings) value += h.qty * series[symbol].close[i];
    equity.push({ time: calendar[i], value });
    if (holdings.size) exposedDays += 1;

    // 3. Strategy decides on today's close; executed tomorrow.
    const target = strategy.decide(i, { ctx, series, calendar, holdings });
    if (target) {
      const set = new Set(target.slice(0, maxSlots));
      const same = set.size === holdings.size && [...set].every((s) => holdings.has(s));
      if (!same) pending = set;
    }
  }

  return summarize({ equity, trades, totalCosts, exposedDays, initialEquity, holdings });
}

function summarize({ equity, trades, totalCosts, exposedDays, initialEquity }) {
  const n = equity.length;
  const final = equity[n - 1].value;
  const years = (equity[n - 1].time - equity[0].time) / (365 * DAY_MS);
  let peak = -Infinity;
  let maxDd = 0;
  const rets = [];
  for (let i = 0; i < n; i += 1) {
    peak = Math.max(peak, equity[i].value);
    maxDd = Math.max(maxDd, 1 - equity[i].value / peak);
    if (i) rets.push(equity[i].value / equity[i - 1].value - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const byYear = {};
  let prevYearEnd = initialEquity;
  for (let i = 0; i < n; i += 1) {
    const y = new Date(equity[i].time).getUTCFullYear();
    const next = equity[i + 1];
    if (!next || new Date(next.time).getUTCFullYear() !== y) {
      byYear[y] = (equity[i].value / prevYearEnd - 1) * 100;
      prevYearEnd = equity[i].value;
    }
  }
  const wins = trades.filter((t) => t.pnlPct > 0).length;
  return {
    finalEquity: final,
    totalReturnPct: (final / initialEquity - 1) * 100,
    cagrPct: (Math.pow(final / initialEquity, 1 / years) - 1) * 100,
    maxDrawdownPct: maxDd * 100,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(365) : 0,
    trades: trades.length,
    tradesPerYear: trades.length / years,
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    exposurePct: (exposedDays / n) * 100,
    costsPctOfStart: (totalCosts / initialEquity) * 100,
    byYear,
    years,
  };
}

module.exports = { alignSeries, runBacktest, DEFAULT_COSTS };
