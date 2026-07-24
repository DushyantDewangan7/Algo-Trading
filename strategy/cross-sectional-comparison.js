// Compare the requested cross-sectional experiment with the exact previous
// version and BTC buy-and-hold. If the 30-day experiment trails either
// benchmark, automatically repeat it with a 60-day lookback and change
// nothing else.

const fs = require("node:fs");
const path = require("node:path");

const { parseArgs, toMillis } = require("./backtest");
const {
  DEFAULT_SYMBOLS,
  MOMENTUM_METRIC,
  REGIME_FILTER_MODE,
  PREVIOUS_VERSION_OPTIONS,
  runCrossSectionalBacktest,
} = require("./cross-sectional");

const DAY_MS = 86_400_000;

function compactResult(label, result) {
  return {
    label,
    configuration: {
      lookbackDays: result.lookbackDays,
      topN: result.topN,
      momentumMetric: result.momentumMetric,
      regimeFilterMode: result.regimeFilterMode,
      rebalanceEveryWeeks: result.rebalanceEveryWeeks,
      skipUnchangedHoldings: result.skipUnchangedHoldings,
      requirePositiveMomentum: result.requirePositiveMomentum,
    },
    summary: result.summary,
  };
}

async function runComparison({
  symbols = DEFAULT_SYMBOLS,
  from,
  to,
  initialEquity = 100_000,
  feePct,
  tdsPct,
} = {}) {
  const toMs = toMillis(to, Date.now());
  const fromMs = toMillis(from, toMs - 270 * DAY_MS);
  const common = { symbols, from: fromMs, to: toMs, initialEquity };
  if (Number.isFinite(feePct)) common.feePct = feePct;
  if (Number.isFinite(tdsPct)) common.tdsPct = tdsPct;

  const requested30 = await runCrossSectionalBacktest({
    ...common,
    lookbackDays: 30,
    topN: 2,
    momentumMetric: MOMENTUM_METRIC.TOTAL_RETURN,
    regimeFilterMode: REGIME_FILTER_MODE.EMA_ONLY,
    rebalanceEveryWeeks: 2,
    skipUnchangedHoldings: true,
    requirePositiveMomentum: false,
  });
  const previous = await runCrossSectionalBacktest({
    ...common,
    ...PREVIOUS_VERSION_OPTIONS,
  });

  const buyAndHold = requested30.buyAndHold;
  if (!buyAndHold) {
    throw new Error("BTC buy-and-hold could not be calculated from the available execution candles");
  }

  const requestedReturn = requested30.summary.netReturnPct;
  const underperformedBuyAndHold = requestedReturn < buyAndHold.summary.netReturnPct;
  const underperformedPrevious = requestedReturn < previous.summary.netReturnPct;
  let requested60 = null;
  if (underperformedBuyAndHold || underperformedPrevious) {
    requested60 = await runCrossSectionalBacktest({
      ...common,
      lookbackDays: 60,
      topN: 2,
      momentumMetric: MOMENTUM_METRIC.TOTAL_RETURN,
      regimeFilterMode: REGIME_FILTER_MODE.EMA_ONLY,
      rebalanceEveryWeeks: 2,
      skipUnchangedHoldings: true,
      requirePositiveMomentum: false,
    });
  }

  return {
    createdAt: Date.now(),
    symbols,
    from: fromMs,
    to: toMs,
    initialEquity,
    trigger: {
      underperformedBuyAndHold,
      underperformedPrevious,
      ran60DayTest: Boolean(requested60),
    },
    results: {
      requested30: compactResult("Requested version (30-day)", requested30),
      previous: compactResult("Previous version", previous),
      buyAndHold: {
        label: `Buy-and-hold ${buyAndHold.symbol}`,
        summary: buyAndHold.summary,
      },
      requested60: requested60
        ? compactResult("Requested version (60-day)", requested60)
        : null,
    },
    runs: { requested30, previous, requested60 },
  };
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function printComparison(comparison) {
  const rows = [
    comparison.results.requested30,
    comparison.results.previous,
    comparison.results.buyAndHold,
    comparison.results.requested60,
  ].filter(Boolean);
  console.log(
    `Cross-sectional comparison  ${new Date(comparison.from).toISOString().slice(0, 10)} -> ${new Date(comparison.to).toISOString().slice(0, 10)}`,
  );
  console.log("Version                         Net return    Max drawdown    Turnover");
  for (const row of rows) {
    console.log(
      `${row.label.padEnd(31)} ${`${formatNumber(row.summary.netReturnPct)}%`.padStart(10)}    ${`${formatNumber(row.summary.maxDrawdownPct)}%`.padStart(12)}    ${formatNumber(row.summary.turnover).padStart(8)}`,
    );
  }
  console.log(
    `60-day trigger: buy-and-hold=${comparison.trigger.underperformedBuyAndHold}, previous=${comparison.trigger.underperformedPrevious}`,
  );
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const symbols = args.symbols
    ? String(args.symbols).split(",").map((symbol) => symbol.trim()).filter(Boolean)
    : DEFAULT_SYMBOLS;
  const comparison = await runComparison({
    symbols,
    from: args.from,
    to: args.to,
    initialEquity: Number(args.equity) || 100_000,
  });
  printComparison(comparison);

  const outDir = path.join(__dirname, "..", "backtest-results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `cross-sectional-comparison-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(comparison, null, 2));
  console.log(`\nComparison written to ${outFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Cross-sectional comparison failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { runComparison, printComparison };
