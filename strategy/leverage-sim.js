"use strict";

const DEFAULT_FEE_PCT = 0.1;
const DEFAULT_TDS_PCT = 1;
const DEFAULT_LIQUIDATION_MARGIN_LOSS_PCT = 90;
const MAX_LEVERAGE = 5;

function positiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive number`);
  }
  return parsed;
}

function nonNegativeNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`${name} must be a non-negative number`);
  }
  return parsed;
}

function normalizeLeverage(value, { max = MAX_LEVERAGE } = {}) {
  const leverage = positiveNumber(value, "leverage");
  const maximum = positiveNumber(max, "max leverage");
  if (leverage > maximum) {
    throw new RangeError(`leverage must not exceed ${maximum}x`);
  }
  return leverage;
}

function applyLeverage(value, leverage) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new TypeError("value must be a finite number");
  return amount * normalizeLeverage(leverage);
}

function calculateLeveragedPnL({
  entryPrice,
  currentPrice,
  marginINR,
  leverage,
  side = "LONG",
}) {
  const entry = positiveNumber(entryPrice, "entryPrice");
  const current = positiveNumber(currentPrice, "currentPrice");
  const margin = positiveNumber(marginINR, "marginINR");
  const multiplier = normalizeLeverage(leverage);
  const direction = String(side).trim().toUpperCase() === "SHORT" ? -1 : 1;
  return margin * multiplier * ((current / entry - 1) * direction);
}

function calculateSlippagePct(positionSizeINR, dailyVolumeINR) {
  const size = nonNegativeNumber(positionSizeINR, "positionSizeINR");
  const volume = Number(dailyVolumeINR);
  const participation = Number.isFinite(volume) && volume > 0 ? size / volume : Infinity;
  return Math.min(2, Math.max(0.1, 0.5 * participation * 100));
}

function entryPriceWithSlippage(price, positionSizeINR, dailyVolumeINR) {
  const referencePrice = positiveNumber(price, "price");
  const slippagePct = calculateSlippagePct(positionSizeINR, dailyVolumeINR);
  return {
    referencePrice,
    fillPrice: referencePrice * (1 + slippagePct / 100),
    slippagePct,
  };
}

function exitPriceWithSlippage(price, positionSizeINR, dailyVolumeINR) {
  const referencePrice = positiveNumber(price, "price");
  const slippagePct = calculateSlippagePct(positionSizeINR, dailyVolumeINR);
  return {
    referencePrice,
    fillPrice: referencePrice * (1 - slippagePct / 100),
    slippagePct,
  };
}

function createLeveragedPosition({
  symbol,
  price,
  entryPrice = price,
  marginINR,
  sizeINR = marginINR,
  leverage = 5,
  timestamp = Date.now(),
  trailPct = 6,
  feePct = DEFAULT_FEE_PCT,
  liquidationMarginLossPct = DEFAULT_LIQUIDATION_MARGIN_LOSS_PCT,
  rawEntryPrice = entryPrice,
  entrySlippagePct = 0,
  quantity = null,
}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  if (!normalizedSymbol) throw new TypeError("symbol is required");
  const fill = positiveNumber(entryPrice, "entryPrice");
  const reference = positiveNumber(rawEntryPrice, "rawEntryPrice");
  const margin = positiveNumber(sizeINR, "marginINR");
  const multiplier = normalizeLeverage(leverage);
  const normalizedTrailPct = positiveNumber(trailPct, "trailPct");
  const normalizedFeePct = nonNegativeNumber(feePct, "feePct");
  const liquidationPct = positiveNumber(
    liquidationMarginLossPct,
    "liquidationMarginLossPct",
  );
  if (liquidationPct > 100) {
    throw new RangeError("liquidationMarginLossPct must not exceed 100");
  }

  const requestedExposureINR = margin * multiplier;
  const suppliedQuantity = Number(quantity);
  const qty = Number.isFinite(suppliedQuantity) && suppliedQuantity > 0
    ? suppliedQuantity
    : requestedExposureINR / fill;
  const exposureINR = qty * fill;
  const entryFee = (exposureINR * normalizedFeePct) / 100;

  return {
    symbol: normalizedSymbol,
    side: "LONG",
    entryPrice: fill,
    rawEntryPrice: reference,
    currentPrice: fill,
    highestPrice: fill,
    stopPrice: fill * (1 - normalizedTrailPct / 100),
    trailPct: normalizedTrailPct,
    marginINR: margin,
    marginUsedINR: margin,
    sizeINR: margin,
    leverage: multiplier,
    exposureINR,
    qty,
    entryFee,
    feePct: normalizedFeePct,
    liquidationMarginLossPct: liquidationPct,
    initialRiskINR: exposureINR * (normalizedTrailPct / 100),
    entrySlippagePct: nonNegativeNumber(entrySlippagePct, "entrySlippagePct"),
    entrySlippageCostINR: Math.max(0, qty * (fill - reference)),
    entryTime: Number(timestamp),
    updatedAt: Number(timestamp),
  };
}

function unrealizedPnL(position, currentPrice) {
  if (!position || typeof position !== "object") throw new TypeError("position is required");
  const mark = positiveNumber(currentPrice, "currentPrice");
  const direction = String(position.side || "LONG").toUpperCase() === "SHORT" ? -1 : 1;
  return (mark - positiveNumber(position.entryPrice, "position.entryPrice")) *
    positiveNumber(position.qty, "position.qty") * direction;
}

function positionEquity(position, currentPrice = position?.currentPrice) {
  const margin = positiveNumber(
    position?.marginUsedINR ?? position?.marginINR ?? position?.sizeINR,
    "position.marginINR",
  );
  return margin + unrealizedPnL(position, currentPrice) - (Number(position.entryFee) || 0);
}

function liquidationStatus(
  position,
  currentPrice,
  liquidationMarginLossPct = position?.liquidationMarginLossPct ??
    DEFAULT_LIQUIDATION_MARGIN_LOSS_PCT,
) {
  if (!position || typeof position !== "object") throw new TypeError("position is required");
  const markPrice = positiveNumber(currentPrice, "currentPrice");
  const margin = positiveNumber(
    position.marginUsedINR ?? position.marginINR ?? position.sizeINR,
    "position.marginINR",
  );
  const thresholdPct = positiveNumber(
    liquidationMarginLossPct,
    "liquidationMarginLossPct",
  );
  const pnl = unrealizedPnL(position, markPrice);
  const lossINR = Math.max(0, -pnl);
  const thresholdINR = margin * (thresholdPct / 100);
  const thresholdReached =
    lossINR >= thresholdINR - Math.max(1e-9, thresholdINR * 1e-12);
  return {
    liquidated: thresholdReached,
    action: thresholdReached ? "SELL" : "HOLD",
    reason: thresholdReached ? "LIQUIDATION" : null,
    markPrice,
    unrealizedPnL: pnl,
    lossINR,
    marginLossPct: (lossINR / margin) * 100,
    thresholdINR,
    thresholdPct,
  };
}

function liquidationPrice(
  position,
  liquidationMarginLossPct = position?.liquidationMarginLossPct ??
    DEFAULT_LIQUIDATION_MARGIN_LOSS_PCT,
) {
  if (!position || typeof position !== "object") throw new TypeError("position is required");
  const entry = positiveNumber(position.entryPrice, "position.entryPrice");
  const leverage = normalizeLeverage(position.leverage);
  const thresholdPct = positiveNumber(
    liquidationMarginLossPct,
    "liquidationMarginLossPct",
  );
  return entry * (1 - thresholdPct / 100 / leverage);
}

function settleLeveragedPosition(position, exitPrice, {
  timestamp = Date.now(),
  reason = "MANUAL_EXIT",
  feePct = position?.feePct ?? DEFAULT_FEE_PCT,
  tdsPct = DEFAULT_TDS_PCT,
  rawExitPrice = exitPrice,
  exitSlippagePct = 0,
} = {}) {
  if (!position || typeof position !== "object") throw new TypeError("position is required");
  const fill = positiveNumber(exitPrice, "exitPrice");
  const reference = positiveNumber(rawExitPrice, "rawExitPrice");
  const normalizedFeePct = nonNegativeNumber(feePct, "feePct");
  const normalizedTdsPct = nonNegativeNumber(tdsPct, "tdsPct");
  const qty = positiveNumber(position.qty, "position.qty");
  const margin = positiveNumber(
    position.marginUsedINR ?? position.marginINR ?? position.sizeINR,
    "position.marginINR",
  );
  const sellNotional = qty * fill;
  const grossPnL = unrealizedPnL(position, fill);
  const entryFee = Number(position.entryFee) || 0;
  const sellFee = (sellNotional * normalizedFeePct) / 100;
  const tds = (sellNotional * normalizedTdsPct) / 100;
  const fees = entryFee + sellFee;
  const netPnL = grossPnL - fees - tds;
  const netProceeds = margin + netPnL;
  const initialRisk = Number(position.initialRiskINR) ||
    Number(position.exposureINR) * (Number(position.trailPct) / 100);

  return {
    symbol: position.symbol,
    entryTime: position.entryTime,
    exitTime: Number(timestamp),
    entryPrice: position.entryPrice,
    exitPrice: fill,
    rawEntryPrice: position.rawEntryPrice ?? position.entryPrice,
    rawExitPrice: reference,
    qty,
    marginINR: margin,
    leverage: position.leverage,
    exposureINR: position.exposureINR,
    reason,
    grossPnL,
    entryFee,
    sellFee,
    fees,
    tds,
    netPnL,
    netPct: (netPnL / margin) * 100,
    netR: initialRisk > 0 ? netPnL / initialRisk : null,
    sellNotional,
    netProceeds,
    cashReturnedINR: netProceeds,
    entrySlippagePct: Number(position.entrySlippagePct) || 0,
    entrySlippageCostINR: Number(position.entrySlippageCostINR) || 0,
    exitSlippagePct: nonNegativeNumber(exitSlippagePct, "exitSlippagePct"),
    exitSlippageCostINR: Math.max(0, qty * (reference - fill)),
  };
}

function executeLiquidation(position, currentPrice, options = {}) {
  const status = liquidationStatus(
    position,
    currentPrice,
    options.liquidationMarginLossPct,
  );
  if (!status.liquidated) return null;
  return {
    ...settleLeveragedPosition(position, currentPrice, {
      ...options,
      reason: "LIQUIDATION",
    }),
    liquidation: status,
  };
}

module.exports = {
  DEFAULT_FEE_PCT,
  DEFAULT_TDS_PCT,
  DEFAULT_LIQUIDATION_MARGIN_LOSS_PCT,
  MAX_LEVERAGE,
  normalizeLeverage,
  applyLeverage,
  calculateLeveragedPnL,
  calculateLeveragedPnl: calculateLeveragedPnL,
  calculateSlippagePct,
  slippagePct: calculateSlippagePct,
  entryPriceWithSlippage,
  exitPriceWithSlippage,
  createLeveragedPosition,
  openLeveragedPosition: createLeveragedPosition,
  unrealizedPnL,
  unrealizedPnl: unrealizedPnL,
  positionEquity,
  liquidationStatus,
  shouldLiquidate: (position, price, thresholdPct) =>
    liquidationStatus(position, price, thresholdPct).liquidated,
  liquidationPrice,
  settleLeveragedPosition,
  realizeLeveragedPnL: settleLeveragedPosition,
  executeLiquidation,
};
