// Run the momentum backtest across a matrix of symbols × timeframes and
// report a markdown comparison table — useful for spotting which
// pairs/timeframes the strategy actually has an edge on before trusting the
// live watchlist. Entries are regime-gated by default (see regime.js), same
// as a single backtest.js run.
//
// CLI usage:
//   node strategy/sweep.js
//   node strategy/sweep.js --symbols I-BTC_INR,I-ETH_INR --intervals 1h,4h,1d --from 2025-10-01
//   node strategy/backtest.js --sweep   (equivalent alias)

const fs = require("node:fs");
const path = require("node:path");

const { runBacktest, parseArgs } = require("./backtest");
const risk = require("./risk");

const DEFAULT_SYMBOLS = ["I-BTC_INR", "I-ETH_INR", "I-SOL_INR", "I-BNB_INR", "I-XRP_INR"];
const DEFAULT_INTERVALS = ["1h", "4h", "1d"];
const DEFAULT_CONCURRENCY = 3; // bounded, so we don't hammer CoinDCX with 15+ paginated fetches at once

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

async function runSweep({
  symbols = DEFAULT_SYMBOLS,
  intervals = DEFAULT_INTERVALS,
  from,
  to,
  initialEquity = 100_000,
  riskPerTradePct = risk.DEFAULT_RISK_PER_TRADE_PCT,
  regimeFilter = true,
  concurrency = DEFAULT_CONCURRENCY,
} = {}) {
  const combos = [];
  for (const symbol of symbols) {
    for (const interval of intervals) combos.push({ symbol, interval });
  }

  const results = [];
  for (let i = 0; i < combos.length; i += concurrency) {
    const batch = combos.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(({ symbol, interval }) =>
        runBacktest({ symbol, interval, from, to, initialEquity, riskPerTradePct, regimeFilter }),
      ),
    );
    settled.forEach((outcome, index) => {
      const { symbol, interval } = batch[index];
      if (outcome.status === "fulfilled") {
        results.push({ symbol, interval, result: outcome.value, error: null });
      } else {
        results.push({ symbol, interval, result: null, error: outcome.reason.message });
      }
    });
  }

  return results;
}

function toMarkdownTable(results) {
  const header =
    "| Symbol | Timeframe | Net % | Trades | Win % | Avg R | Max DD % | Sharpe | TDS paid (₹) | Fees paid (₹) |\n" +
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|";
  const rows = results.map(({ symbol, interval, result, error }) => {
    if (error) return `| ${symbol} | ${interval} | — | — | — | — | — | — | — | error: ${error} |`;
    const s = result.summary;
    return (
      `| ${symbol} | ${interval} | ${formatNumber(s.netReturnPct)} | ${s.tradeCount} | ` +
      `${formatNumber(s.winRatePct, 1)} | ${formatNumber(s.avgRMultiple)} | ${formatNumber(s.maxDrawdownPct)} | ` +
      `${formatNumber(s.sharpe)} | ${formatNumber(s.totalTdsInr, 0)} | ${formatNumber(s.totalFeesInr, 0)} |`
    );
  });
  return [header, ...rows].join("\n");
}

function writeSweepReport(results, meta = {}) {
  const outDir = path.join(__dirname, "..", "backtest-results");
  fs.mkdirSync(outDir, { recursive: true });
  const timestamp = Date.now();
  const outFile = path.join(outDir, `sweep-${timestamp}.md`);

  const ranked = [...results]
    .filter((row) => row.result)
    .sort((a, b) => b.result.summary.netReturnPct - a.result.summary.netReturnPct);

  const lines = [
    "# Momentum strategy sweep",
    "",
    `Generated ${new Date(timestamp).toISOString()}`,
    meta.from || meta.to ? `Window: ${meta.from || "auto"} → ${meta.to || "now"}` : "",
    `Regime filter: ${meta.regimeFilter === false ? "off" : `on (${meta.benchmark || "I-BTC_INR"} daily EMA50/200 + ADX14)`}`,
    `Risk per trade: ${meta.riskPerTradePct ?? risk.DEFAULT_RISK_PER_TRADE_PCT}%   Fee: ${risk.DEFAULT_FEE_PCT}%/side   TDS: ${risk.TDS_PCT}% on sells`,
    "",
    toMarkdownTable(results),
    "",
    "## Ranked by net return",
    "",
    ranked
      .map(
        (row, i) =>
          `${i + 1}. **${row.symbol} ${row.interval}** — ${formatNumber(row.result.summary.netReturnPct)}% net, ${row.result.summary.tradeCount} trades`,
      )
      .join("\n"),
    "",
  ].join("\n");

  fs.writeFileSync(outFile, lines);
  return outFile;
}

function parseListArg(value, fallback) {
  if (!value || value === true) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const symbols = parseListArg(args.symbols, DEFAULT_SYMBOLS);
  const intervals = parseListArg(args.intervals, DEFAULT_INTERVALS);
  const regimeFilter = args.regime !== "false";
  const riskPerTradePct = Number(args.risk) || risk.DEFAULT_RISK_PER_TRADE_PCT;

  console.log(
    `Sweeping ${symbols.length} symbols × ${intervals.length} timeframes ` +
      `(${symbols.length * intervals.length} backtests, regime filter ${regimeFilter ? "on" : "off"})...`,
  );

  const results = await runSweep({
    symbols,
    intervals,
    from: args.from,
    to: args.to,
    initialEquity: Number(args.equity) || 100_000,
    riskPerTradePct,
    regimeFilter,
  });

  console.log(`\n${toMarkdownTable(results)}\n`);
  const outFile = writeSweepReport(results, { from: args.from, to: args.to, regimeFilter, riskPerTradePct });
  console.log(`Sweep report written to ${outFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Sweep failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { runSweep, toMarkdownTable, writeSweepReport, main, DEFAULT_SYMBOLS, DEFAULT_INTERVALS };
