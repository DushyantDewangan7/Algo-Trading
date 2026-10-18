"use strict";

// Neighbourhood check for the SMA ± band filter: is the top result a plateau
// or a lucky spike? Prints Sharpe / CAGR / maxDD / trades-per-year per cell,
// for the full period and for 2024 onwards.

const { loadUniverse } = require("./data");
const { alignSeries, runBacktest } = require("./engine");
const S = require("./strategies");

const COSTS = { feePct: 0.5, gstOnFeePct: 18, slippagePct: 0.2, tdsPct: 1 };
const f = (v, d = 1) => v.toFixed(d);

async function main() {
  const aligned = alignSeries(await loadUniverse({ symbols: ["BTC", "ETH"] }));
  for (const symbol of ["BTC", "ETH"]) {
    for (const [label, start] of [["2021→now", Date.UTC(2021, 0, 1)], ["2024→now", Date.UTC(2024, 0, 1)]]) {
      console.log(`\n${symbol} ${label}: Sharpe/CAGR%/maxDD%/trades-per-yr`);
      const bands = [0, 0.5, 1, 2, 3];
      console.log("SMA\\band".padEnd(9), bands.map((b) => `${b}%`.padStart(20)).join(""));
      for (const n of [80, 100, 120, 150]) {
        const cells = bands.map((b) => {
          const r = runBacktest({ aligned, strategy: S.smaBand(symbol, n, b), startMs: start, costs: COSTS });
          return `${f(r.sharpe, 2)}/${f(r.cagrPct, 0)}/${f(r.maxDrawdownPct, 0)}/${f(r.tradesPerYear)}`.padStart(20);
        });
        console.log(String(n).padEnd(9), cells.join(""));
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
