"use strict";

// Runs the strategy catalogue on CoinDCX daily INR candles with realistic
// Indian spot costs and writes research/results.md + results.json.
//
//   node research/run.js [--fee 0.5] [--slip 0.2] [--tds 1]

const fs = require("node:fs");
const path = require("node:path");
const { loadUniverse, UNIVERSE } = require("./data");
const { alignSeries, runBacktest } = require("./engine");
const S = require("./strategies");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const COSTS = {
  feePct: arg("fee", 0.5),
  gstOnFeePct: 18,
  slippagePct: arg("slip", 0.2),
  tdsPct: arg("tds", 1),
};

const PERIODS = {
  full: [Date.UTC(2021, 0, 1), Infinity],
  early: [Date.UTC(2021, 0, 1), Date.UTC(2023, 11, 31)],
  recent: [Date.UTC(2024, 0, 1), Infinity],
};

const MAJORS = ["BTC", "ETH", "BNB", "XRP", "SOL"];

function catalogue() {
  return [
    S.hold("BTC"),
    S.hold("ETH"),
    S.trendVote("BTC", 2),
    S.trendVote("BTC", 3),
    S.trendVote("ETH", 2),
    S.smaFilter("BTC", 120),
    S.smaFilter("BTC", 200),
    S.smaFilter("BTC", 100),
    S.smaFilter("BTC", 50),
    S.maCross("BTC", 50, 200),
    S.maCross("BTC", 20, 50, "ema"),
    S.maCross("BTC", 10, 30, "ema"),
    S.donchian("BTC", 20, 10),
    S.donchian("BTC", 55, 20),
    S.donchian("ETH", 20, 10),
    S.tsmom("BTC", 90),
    S.weeklyTsmom("BTC", 90),
    S.weeklyTsmom("BTC", 30),
    S.supertrend("BTC", 10, 3),
    S.rsi2("BTC", 10),
    S.rsi2("ETH", 10),
    S.dualMomentum(["BTC", "ETH"], 90),
    S.dualMomentum(["BTC", "ETH"], 30),
    S.multiTrend(["BTC", "ETH"], 100),
    S.rotation({ universe: MAJORS, lookback: 28, topN: 1 }),
    S.rotation({ universe: MAJORS, lookback: 28, topN: 2 }),
    S.rotation({ universe: MAJORS, lookback: 56, topN: 1 }),
    S.rotation({ universe: UNIVERSE, lookback: 28, topN: 1 }),
    S.rotation({ universe: UNIVERSE, lookback: 28, topN: 2 }),
    S.rotation({ universe: UNIVERSE, lookback: 28, topN: 2, buffer: 2 }),
    S.rotation({ universe: UNIVERSE, lookback: 14, topN: 2 }),
    S.rotation({ universe: UNIVERSE, lookback: 56, topN: 2 }),
    S.rotation({ universe: UNIVERSE, lookback: 28, topN: 2, volAdjust: true }),
    S.rotation({ universe: UNIVERSE, lookback: 28, topN: 2, regimeSma: 0, assetSma: 50 }),
    S.rotation({ universe: UNIVERSE, lookback: 28, topN: 2, regimeSma: 0 }),
    // Added from the literature / GitHub review
    S.smaBand("BTC", 100, 1),
    S.smaBand("BTC", 120, 1),
    S.smaBand("ETH", 100, 1),
    S.donchian("BTC", 150, 50),
    S.donchian("BTC", 200, 50),
    S.donchianEnsemble("BTC"),
    S.donchianEnsemble("ETH"),
    S.smaVolTarget("BTC", 100, 0.5),
    S.bollingerBreakout("BTC"),
    S.bollingerBreakout("ETH"),
    S.supertrend("BTC", 7, 3),
    S.rotation({ universe: UNIVERSE, lookback: 14, topN: 2, regimeSma: 100, buffer: 2, rebalanceWeeks: 2 }),
    S.rotation({ universe: MAJORS, lookback: 14, topN: 2, regimeSma: 100, buffer: 2, rebalanceWeeks: 2 }),
  ];
}

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

async function main() {
  const data = await loadUniverse();
  const aligned = S.withHalves(alignSeries(data), ["BTC", "ETH"]);
  const rows = [];
  for (const strategy of catalogue()) {
    const row = { name: strategy.name };
    for (const [key, [startMs, endMs]] of Object.entries(PERIODS)) {
      row[key] = runBacktest({ aligned, strategy, startMs, endMs, costs: COSTS });
    }
    rows.push(row);
  }

  const btc = rows.find((r) => r.name === "Buy & hold BTC");
  rows.sort((a, b) => b.full.sharpe - a.full.sharpe);

  const lastDay = new Date(aligned.calendar.at(-1)).toISOString().slice(0, 10);
  const header = [
    `# Strategy backtests — CoinDCX INR daily, 2021-01-01 → ${lastDay}`,
    "",
    `Costs per side: fee ${COSTS.feePct}% + 18% GST on fee, slippage ${COSTS.slippagePct}%; ` +
      `TDS ${COSTS.tdsPct}% of every sell. Signals on daily close, fills at next open. Long-only spot, no leverage.`,
    "",
    `BTC buy & hold: CAGR ${f(btc.full.cagrPct)}%, max drawdown ${f(btc.full.maxDrawdownPct)}%, Sharpe ${f(btc.full.sharpe, 2)}.`,
    "",
    "| Strategy | CAGR % | Max DD % | Sharpe | Trades/yr | Win % | In market % | 2021–23 CAGR | 2024–now CAGR | 2024–now DD |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  const lines = rows.map((r) =>
    `| ${r.name} | ${f(r.full.cagrPct)} | ${f(r.full.maxDrawdownPct)} | ${f(r.full.sharpe, 2)} | ${f(r.full.tradesPerYear)} | ${f(r.full.winRatePct, 0)} | ${f(r.full.exposurePct, 0)} | ${f(r.early.cagrPct)} | ${f(r.recent.cagrPct)} | ${f(r.recent.maxDrawdownPct)} |`);

  const years = Object.keys(btc.full.byYear);
  const yearHeader = [
    "",
    "## Calendar-year returns (%)",
    "",
    `| Strategy | ${years.join(" | ")} |`,
    `|---|${years.map(() => "---:").join("|")}|`,
  ];
  const yearLines = rows.map((r) => `| ${r.name} | ${years.map((y) => f(r.full.byYear[y])).join(" | ")} |`);

  const md = [...header, ...lines, ...yearHeader, ...yearLines, ""].join("\n");
  const suffix = process.argv.includes("--fee") ? `-fee${COSTS.feePct}` : "";
  fs.writeFileSync(path.join(__dirname, `results${suffix}.md`), md);
  fs.writeFileSync(path.join(__dirname, `results${suffix}.json`), JSON.stringify({ costs: COSTS, rows }, null, 2));
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
