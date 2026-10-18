"use strict";

// Robustness checks for the trend strategies that topped research/run.js:
//  1. parameter neighbourhoods on BTC (is the winner a lucky setting?)
//  2. the same rules on other coins (does the edge transfer?)
//  3. cost sensitivity
//  4. data sanity: biggest one-day moves per coin (bad candles?)

const { loadUniverse } = require("./data");
const { alignSeries, runBacktest } = require("./engine");
const S = require("./strategies");

const START = Date.UTC(2021, 0, 1);
const RECENT = Date.UTC(2024, 0, 1);
const BASE = { feePct: 0.5, gstOnFeePct: 18, slippagePct: 0.2, tdsPct: 1 };
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

function cell(aligned, strategy, costs = BASE) {
  const full = runBacktest({ aligned, strategy, startMs: START, costs });
  const recent = runBacktest({ aligned, strategy, startMs: RECENT, costs });
  return { full, recent };
}

async function main() {
  const data = await loadUniverse();
  const aligned = alignSeries(data);

  console.log("\n## Data sanity: largest single-day close-to-close moves");
  for (const [sym, s] of Object.entries(aligned.series)) {
    let worst = { r: 0, t: 0 };
    for (let i = 1; i < s.close.length; i += 1) {
      const r = s.close[i] / s.close[i - 1] - 1;
      if (Number.isFinite(r) && Math.abs(r) > Math.abs(worst.r)) worst = { r, t: aligned.calendar[i] };
    }
    console.log(sym.padEnd(6), f(worst.r * 100), new Date(worst.t).toISOString().slice(0, 10));
  }

  const hold = cell(aligned, S.hold("BTC"));
  console.log(`\nBTC hold: CAGR ${f(hold.full.cagrPct)} DD ${f(hold.full.maxDrawdownPct)} Sharpe ${f(hold.full.sharpe, 2)} | 2024+ CAGR ${f(hold.recent.cagrPct)}`);

  console.log("\n## EMA fast/slow grid on BTC (full-period Sharpe / CAGR / maxDD)");
  const fasts = [10, 15, 20, 25, 30];
  const slows = [40, 50, 60, 80, 100];
  console.log(`fast\\slow ${slows.map((s) => String(s).padStart(16)).join("")}`);
  for (const fa of fasts) {
    const row = slows.map((sl) => {
      if (fa >= sl) return "".padStart(16);
      const r = cell(aligned, S.maCross("BTC", fa, sl, "ema")).full;
      return `${f(r.sharpe, 2)}/${f(r.cagrPct, 0)}/${f(r.maxDrawdownPct, 0)}`.padStart(16);
    });
    console.log(String(fa).padEnd(10), row.join(""));
  }

  console.log("\n## Price above N-day SMA on BTC");
  for (const n of [50, 60, 80, 100, 120, 150, 200]) {
    const r = cell(aligned, S.smaFilter("BTC", n));
    console.log(`SMA${String(n).padEnd(4)} Sharpe ${f(r.full.sharpe, 2)} CAGR ${f(r.full.cagrPct)} DD ${f(r.full.maxDrawdownPct)} trades/yr ${f(r.full.tradesPerYear)} | 2024+ CAGR ${f(r.recent.cagrPct)}`);
  }

  console.log("\n## Donchian entry/exit grid on BTC (Sharpe / CAGR / maxDD)");
  for (const [en, ex] of [[20, 10], [30, 15], [40, 20], [55, 20], [55, 30], [70, 30], [100, 50]]) {
    const r = cell(aligned, S.donchian("BTC", en, ex));
    console.log(`D${en}/${ex}`.padEnd(8), `Sharpe ${f(r.full.sharpe, 2)} CAGR ${f(r.full.cagrPct)} DD ${f(r.full.maxDrawdownPct)} trades/yr ${f(r.full.tradesPerYear)} | 2024+ CAGR ${f(r.recent.cagrPct)}`);
  }

  console.log("\n## Same rules on other coins (Sharpe strategy vs hold; CAGR strategy vs hold; DD strategy vs hold)");
  const rules = [
    ["EMA20/50", (c) => S.maCross(c, 20, 50, "ema")],
    ["SMA100", (c) => S.smaFilter(c, 100)],
    ["Don55/20", (c) => S.donchian(c, 55, 20)],
  ];
  for (const coin of ["ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "LINK", "TRX", "AVAX", "DOT"]) {
    const h = cell(aligned, S.hold(coin)).full;
    const parts = rules.map(([label, mk]) => {
      const r = cell(aligned, mk(coin)).full;
      return `${label} ${f(r.sharpe, 2)}/${f(r.cagrPct, 0)}%/${f(r.maxDrawdownPct, 0)}%`;
    });
    console.log(coin.padEnd(5), `hold ${f(h.sharpe, 2)}/${f(h.cagrPct, 0)}%/${f(h.maxDrawdownPct, 0)}%`.padEnd(22), parts.join("   "));
  }

  console.log("\n## Cost sensitivity (full period CAGR / Sharpe)");
  const scenarios = [
    ["fee0.1 slip0.1", { ...BASE, feePct: 0.1, slippagePct: 0.1 }],
    ["fee0.5 slip0.2 (base)", BASE],
    ["fee0.5 slip0.5", { ...BASE, slippagePct: 0.5 }],
    ["base, TDS refunded", { ...BASE, tdsPct: 0 }],
  ];
  for (const [label, mk] of [
    ["BTC EMA20/50", () => S.maCross("BTC", 20, 50, "ema")],
    ["BTC SMA100", () => S.smaFilter("BTC", 100)],
    ["BTC Don55/20", () => S.donchian("BTC", 55, 20)],
  ]) {
    const parts = scenarios.map(([sl, costs]) => {
      const r = cell(aligned, mk(), costs).full;
      return `${sl}: ${f(r.cagrPct)}%/${f(r.sharpe, 2)}`;
    });
    console.log(label.padEnd(14), parts.join("  |  "));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
