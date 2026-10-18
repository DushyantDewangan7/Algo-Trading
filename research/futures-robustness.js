"use strict";

// 1. Wipe-out odds: start each strategy at every quarter from 2021-04 to
//    2025-10 and run 12 months. Report how many windows ended liquidated, the
//    median 12-month return, and the worst one — per leverage level.
// 2. Holdout coins: run the best SOL/DOGE strategies on XRP and BNB, which
//    were not used to pick them.

const fs = require("node:fs");
const path = require("node:path");
const { loadHourly, rollup, HOUR_MS } = require("./usdt-data");
const { runFutures, toArrays, DEFAULT_FUT_COSTS } = require("./futures-engine");
const ind = require("./indicators");

const COSTS = DEFAULT_FUT_COSTS;

const strategies = {
  "EMA20/50 long/short": () => ({
    init: (b) => ({ f: ind.ema(b.close, 20), s: ind.ema(b.close, 50) }),
    signal: (i, c) => (Number.isFinite(c.s[i]) ? (c.f[i] > c.s[i] ? 1 : -1) : null),
  }),
  "Supertrend(10,3) long/short": () => ({
    init: (b) => ({ d: ind.supertrend(b.high, b.low, b.close, 10, 3) }),
    signal: (i, c) => (c.d[i] ? (c.d[i] > 0 ? 1 : -1) : null),
  }),
  "Donchian 20/10 long/short": () => ({
    init: (b) => ({ b, hi: ind.priorMax(b.close, 20), lo: ind.priorMin(b.close, 20), xlo: ind.priorMin(b.close, 10), xhi: ind.priorMax(b.close, 10) }),
    signal(i, c, side) {
      const px = c.b.close[i];
      if (!Number.isFinite(c.hi[i])) return null;
      if (side <= 0 && px > c.hi[i]) return 1;
      if (side >= 0 && px < c.lo[i]) return -1;
      if (side > 0 && px < c.xlo[i]) return 0;
      if (side < 0 && px > c.xhi[i]) return 0;
      return null;
    },
  }),
  "SMA100 ±1% long-only": () => ({
    init: (b) => ({ b, ma: ind.sma(b.close, 100) }),
    signal(i, c, side) {
      const m = c.ma[i]; const px = c.b.close[i];
      if (!Number.isFinite(m)) return null;
      if (px > m * 1.01) return 1;
      if (px < m * 0.99) return 0;
      return side;
    },
  }),
  "SMA100 ±1% long/short": () => ({
    init: (b) => ({ b, ma: ind.sma(b.close, b.time[1] - b.time[0] < 86_400_000 ? 600 : 100) }),
    signal(i, c, side) {
      const m = c.ma[i]; const px = c.b.close[i];
      if (!Number.isFinite(m)) return null;
      if (px > m * 1.01) return 1;
      if (px < m * 0.99) return -1;
      return side;
    },
  }),
};

const CASES = [
  ["4h", "DOGE", "EMA20/50 long/short"],
  ["1d", "SOL", "Supertrend(10,3) long/short"],
  ["1d", "DOGE", "Donchian 20/10 long/short"],
  ["4h", "SOL", "EMA20/50 long/short"],
  ["1d", "BTC", "SMA100 ±1% long-only"],
  ["1d", "ETH", "SMA100 ±1% long-only"],
  ["1d", "BTC", "SMA100 ±1% long/short"],
  ["4h", "BTC", "SMA100 ±1% long/short"],
];

const f = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");

async function main() {
  const frames = { "1d": 24 * HOUR_MS, "4h": 4 * HOUR_MS };
  const cache = {};
  const bars = async (coin, tf) => {
    const key = `${coin}-${tf}`;
    if (!cache[key]) cache[key] = toArrays(rollup(await loadHourly(coin), frames[tf]));
    return cache[key];
  };
  const starts = [];
  for (let y = 2021; y <= 2025; y += 1) for (const m of [0, 3, 6, 9]) {
    const t = Date.UTC(y, m, 1);
    if (t >= Date.UTC(2021, 3, 1) && t <= Date.UTC(2025, 9, 1)) starts.push(t);
  }
  const YEAR = 365 * 86_400_000;
  const out = ["# Futures robustness", "",
    `## 12-month windows started every quarter (${starts.length} windows, 2021-04 → 2025-10)`, "",
    "Cells: windows wiped out by liquidation / median 12-month return % / worst 12-month return %", "",
    "| Candles | Coin | Strategy | 1x | 2x | 3x | 5x | 10x |", "|---|---|---|---|---|---|---|---|"];
  for (const [tf, coin, name] of CASES) {
    const b = await bars(coin, tf);
    const cells = [1, 2, 3, 5, 10].map((L) => {
      const rets = []; let wiped = 0;
      for (const s of starts) {
        const r = runFutures({ bars: b, strategy: strategies[name](), leverage: L, costs: COSTS, startMs: s, endMs: s + YEAR });
        if (r.liquidated || r.finalMultiple <= 0.001) wiped += 1;
        rets.push(r.totalReturnPct);
      }
      rets.sort((a, c) => a - c);
      return `${wiped}/${starts.length} wiped · med ${f(rets[Math.floor(rets.length / 2)])}% · worst ${f(rets[0])}%`;
    });
    out.push(`| ${tf} | ${coin} | ${name} | ${cells.join(" | ")} |`);
  }

  out.push("", "## Holdout coins (not used to pick the strategies), Apr 2021 → now, 1x", "",
    "| Candles | Strategy | XRP CAGR / DD | BNB CAGR / DD | BTC CAGR / DD | ETH CAGR / DD |", "|---|---|---|---|---|---|");
  for (const [tf, , name] of CASES.slice(0, 4)) {
    const cells = [];
    for (const coin of ["XRP", "BNB", "BTC", "ETH"]) {
      const r = runFutures({ bars: await bars(coin, tf), strategy: strategies[name](), leverage: 1, costs: COSTS, startMs: Date.UTC(2021, 3, 1) });
      cells.push(r.liquidated ? "💀 wiped" : `${f(r.cagrPct)}% / ${f(r.maxDrawdownPct)}%`);
    }
    out.push(`| ${tf} | ${name} | ${cells.join(" | ")} |`);
  }
  const md = out.join("\n") + "\n";
  fs.writeFileSync(path.join(__dirname, "results-futures-robustness.md"), md);
  console.log(md);
}

main().catch((e) => { console.error(e); process.exit(1); });
