"use strict";

// Tests the popular GitHub bot strategies (freqtrade BinHV45, ClucMay72018,
// CombinedBinHAndCluc; Jesse SimpleBollinger) on CoinDCX INR 1h and 15m
// candles. Faithful to their entry rules and their ROI / stop-loss exits.
//
// Fills: entry at the next bar's open. While in a trade, each bar checks the
// stop first (conservative), then the take-profit, using the bar's low/high.
// Signal exits fill at the next open. Results are shown with zero costs (the
// raw edge) and with CoinDCX INR costs.

const fs = require("node:fs");
const path = require("node:path");
const ind = require("./indicators");

const DATA_DIR = path.join(__dirname, "data");
const API = "https://public.coindcx.com/market_data/candles";
const COSTS = { fee: 0.005 * 1.18, slip: 0.002, tds: 0.01 };
const ZERO = { fee: 0, slip: 0, tds: 0 };

async function fetchCandles(pair, interval, fromMs) {
  const file = path.join(DATA_DIR, `${pair}_${interval}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const byTime = new Map();
  let endTime = Date.now();
  for (let page = 0; page < 40; page += 1) {
    const res = await fetch(`${API}?pair=${pair}&interval=${interval}&startTime=${fromMs}&endTime=${endTime}&limit=1000`);
    const batch = await res.json();
    if (!Array.isArray(batch) || !batch.length) break;
    let oldest = Infinity;
    for (const c of batch) {
      const k = { time: Number(c.time), open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 0 };
      if (k.open > 0 && k.close > 0) byTime.set(k.time, k);
      oldest = Math.min(oldest, k.time);
    }
    if (batch.length < 1000 || oldest <= fromMs) break;
    endTime = oldest - 1;
  }
  const out = [...byTime.values()].filter((c) => c.time >= fromMs).sort((a, b) => a.time - b.time);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

function arrays(candles) {
  const pick = (k) => Float64Array.from(candles.map((c) => c[k]));
  return { time: candles.map((c) => c.time), open: pick("open"), high: pick("high"), low: pick("low"), close: pick("close"), volume: pick("volume") };
}

function bollinger(values, period, k) {
  const mid = ind.sma(values, period);
  const sd = ind.stdev(values, period);
  return { mid, lower: mid.map((m, i) => m - k * sd[i]), upper: mid.map((m, i) => m + k * sd[i]) };
}

// --- strategy definitions: entry(i) -> bool, exitSignal(i) -> bool, roi, stop
function binHV45(a, t = { bb: 0.008, close: 0.0175, tail: 0.25 }) {
  const bb = bollinger(a.close, 40, 2);
  return (i) => {
    if (i < 1 || !Number.isFinite(bb.lower[i - 1])) return false;
    const bbdelta = Math.abs(bb.mid[i] - bb.lower[i]);
    const closedelta = Math.abs(a.close[i] - a.close[i - 1]);
    const tail = Math.abs(a.close[i] - a.low[i]);
    return bb.lower[i - 1] > 0 && bbdelta > a.close[i] * t.bb && closedelta > a.close[i] * t.close &&
      tail < bbdelta * t.tail && a.close[i] < bb.lower[i - 1] && a.close[i] <= a.close[i - 1];
  };
}

function clucParts(a) {
  const typical = a.close.map((c, i) => (a.high[i] + a.low[i] + c) / 3);
  const bb = bollinger(typical, 20, 2);
  const ema50 = ind.ema(a.close, 50);
  const volMa = ind.sma(a.volume, 30);
  const entry = (i) => i > 0 && a.close[i] < ema50[i] && a.close[i] < 0.985 * bb.lower[i] &&
    a.volume[i] < volMa[i - 1] * 20;
  return { entry, mid: bb.mid };
}

const STRATEGIES = {
  "BinHV45 (freqtrade)": (a) => ({ entry: binHV45(a, { bb: 0.007, close: 0.017, tail: 0.025 }), exit: () => false, roi: 0.0125, stop: 0.05 }),
  "ClucMay72018 (freqtrade)": (a) => {
    const c = clucParts(a);
    return { entry: c.entry, exit: (i) => a.close[i] > c.mid[i], roi: 0.01, stop: 0.05 };
  },
  "CombinedBinHAndCluc (freqtrade)": (a) => {
    const c = clucParts(a);
    const b = binHV45(a);
    return { entry: (i) => b(i) || c.entry(i), exit: (i) => a.close[i] > c.mid[i], roi: 0.05, stop: 0.05, exitOnlyInProfit: true };
  },
  "SimpleBollinger (Jesse)": (a) => {
    const hl2 = a.high.map((h, i) => (h + a.low[i]) / 2);
    const bb = bollinger(hl2, 20, 2);
    const hhll = (n) => {
      const hi = ind.priorMax(a.high, n); const lo = ind.priorMin(a.low, n);
      return hi.map((h, i) => {
        const nh = i + 1 < hi.length ? hi[i + 1] : NaN; const nl = i + 1 < lo.length ? lo[i + 1] : NaN;
        return (nh + nl) / 2;
      });
    };
    const tenkan = hhll(9); const kijun = hhll(26); const mid52 = hhll(52);
    return {
      entry: (i) => i >= 26 && a.close[i] > bb.upper[i] &&
        a.close[i] > Math.max((tenkan[i - 26] + kijun[i - 26]) / 2, mid52[i - 26]),
      exit: (i) => a.close[i] < bb.mid[i],
      roi: Infinity,
      stop: Infinity,
    };
  },
};

function simulate(a, spec, costs) {
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  const trades = [];
  let pos = null;
  let pendingEntry = false;
  let pendingExit = false;
  const exitAt = (price, i) => {
    const sell = price * (1 - costs.slip);
    const net = (sell * (1 - costs.fee - costs.tds)) / pos.cost;
    trades.push({ net: net - 1, gross: price / pos.entry - 1, bars: i - pos.i });
    equity *= net;
    pos = null;
  };
  for (let i = 1; i < a.close.length; i += 1) {
    if (pendingEntry && !pos) {
      const px = a.open[i];
      pos = { entry: px, cost: (px * (1 + costs.slip)) / (1 - costs.fee), i };
      pendingEntry = false;
    }
    if (pendingExit && pos) { exitAt(a.open[i], i); pendingExit = false; }
    if (pos) {
      const stopPx = pos.entry * (1 - spec.stop);
      const tpPx = pos.entry * (1 + spec.roi);
      if (a.low[i] <= stopPx) exitAt(Math.min(stopPx, a.open[i]), i);
      else if (a.high[i] >= tpPx) exitAt(Math.max(tpPx, a.open[i]), i);
      else if (spec.exit(i) && (!spec.exitOnlyInProfit || a.close[i] > pos.entry)) pendingExit = true;
    } else if (spec.entry(i)) {
      pendingEntry = true;
    }
    const mark = pos ? equity * (a.close[i] / pos.entry) : equity;
    peak = Math.max(peak, mark);
    maxDd = Math.max(maxDd, 1 - mark / peak);
  }
  if (pos) exitAt(a.close[a.close.length - 1], a.close.length - 1);
  const wins = trades.filter((t) => t.net > 0).length;
  const avg = (k) => (trades.length ? trades.reduce((s, t) => s + t[k], 0) / trades.length : 0);
  return { trades: trades.length, winPct: trades.length ? (wins / trades.length) * 100 : 0, avgGrossPct: avg("gross") * 100, avgNetPct: avg("net") * 100, totalPct: (equity - 1) * 100, maxDdPct: maxDd * 100 };
}

async function main() {
  const now = Date.now();
  const sets = [
    ["1h", now - 2 * 365 * 86_400_000],
    ["15m", now - 180 * 86_400_000],
  ];
  const coins = ["BTC", "ETH", "SOL", "XRP", "DOGE"];
  const lines = ["| Strategy | Candles | Coin | Trades | Win % (net) | Avg gross/trade % | Avg net/trade % | Total, no costs % | Total, with costs % | Max DD (with costs) % |", "|---|---|---|---:|---:|---:|---:|---:|---:|---:|"];
  for (const [interval, from] of sets) {
    for (const coin of coins) {
      const candles = await fetchCandles(`I-${coin}_INR`, interval, from);
      if (candles.length < 500) { console.error(`skip ${coin} ${interval}: ${candles.length} candles`); continue; }
      const a = arrays(candles);
      for (const [name, make] of Object.entries(STRATEGIES)) {
        const zero = simulate(a, make(a), ZERO);
        const real = simulate(a, make(a), COSTS);
        lines.push(`| ${name} | ${interval} (${new Date(a.time[0]).toISOString().slice(0, 10)}→) | ${coin} | ${real.trades} | ${real.winPct.toFixed(0)} | ${real.avgGrossPct.toFixed(2)} | ${real.avgNetPct.toFixed(2)} | ${zero.totalPct.toFixed(1)} | ${real.totalPct.toFixed(1)} | ${real.maxDdPct.toFixed(1)} |`);
      }
    }
  }
  const md = ["# GitHub bot strategies on CoinDCX INR intraday candles", "", "Costs: 0.59% fee per side (0.5% + GST), 0.2% slippage per side, 1% TDS on sells ≈ 2.6% per round trip.", "", ...lines, ""].join("\n");
  fs.writeFileSync(path.join(__dirname, "results-intraday.md"), md);
  console.log(md);
}

main().catch((e) => { console.error(e); process.exit(1); });
