// Position sizing and portfolio-level risk gates.

const DEFAULT_RISK_PER_TRADE_PCT = 0.5;
const DEFAULT_FEE_PCT = 0.1; // CoinDCX spot fee per side
const TDS_PCT = 1; // Indian TDS withheld on every sell notional
const MAX_CONCURRENT_POSITIONS = 4;
const DAILY_LOSS_CAP_PCT = 3;

// Size a long so that a stop-out loses ≈ equity * riskPerTradePct / 100.
// Round-trip fees are part of the loss on a stopped trade, so they are added
// to the per-unit risk instead of being ignored:
//   loss per unit = (entry - stopLoss) + entry*fee% + stopLoss*fee%
function positionSize({
  equity,
  riskPerTradePct = DEFAULT_RISK_PER_TRADE_PCT,
  entry,
  stopLoss,
  feePct = DEFAULT_FEE_PCT,
}) {
  if (!Number.isFinite(equity) || equity <= 0) {
    return { qty: 0, reason: "Equity must be positive" };
  }
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || entry <= 0 || stopLoss <= 0) {
    return { qty: 0, reason: "Entry and stop-loss must be positive prices" };
  }
  if (stopLoss >= entry) {
    return { qty: 0, reason: "Stop-loss must be below entry for a long" };
  }

  const riskBudgetInr = (equity * riskPerTradePct) / 100;
  const stopDistance = entry - stopLoss;
  const feePerUnit = ((entry + stopLoss) * feePct) / 100;
  const qty = riskBudgetInr / (stopDistance + feePerUnit);

  return {
    qty,
    riskBudgetInr,
    perUnitRisk: stopDistance,
    costInr: qty * entry,
    reason: null,
  };
}

// Portfolio cap: never more than MAX_CONCURRENT_POSITIONS open at once.
function canOpenPosition(openPositionCount, maxPositions = MAX_CONCURRENT_POSITIONS) {
  return Number(openPositionCount) < maxPositions;
}

// Daily loss cap: once realized + unrealized losses for the day exceed
// capPct of equity, block new entries (existing exits still run).
function isDailyLossCapped({
  equity,
  realizedTodayInr = 0,
  unrealizedInr = 0,
  capPct = DAILY_LOSS_CAP_PCT,
}) {
  if (!Number.isFinite(equity) || equity <= 0) return true;
  const totalPnl = (realizedTodayInr || 0) + (unrealizedInr || 0);
  return totalPnl < 0 && Math.abs(totalPnl) > (equity * capPct) / 100;
}

module.exports = {
  positionSize,
  canOpenPosition,
  isDailyLossCapped,
  DEFAULT_RISK_PER_TRADE_PCT,
  DEFAULT_FEE_PCT,
  TDS_PCT,
  MAX_CONCURRENT_POSITIONS,
  DAILY_LOSS_CAP_PCT,
};
