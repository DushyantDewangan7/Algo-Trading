"use strict";

const DEFAULT_FEE_PCT = 0.1;
const DEFAULT_TDS_PCT = 1;

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

function openPosition({
  symbol,
  price,
  sizeINR,
  timestamp = Date.now(),
  trailPct,
  tpPct,
  feePct = DEFAULT_FEE_PCT,
}) {
  const entryPrice = positiveNumber(price, "price");
  const cashCommittedINR = positiveNumber(sizeINR, "sizeINR");
  const normalizedTrailPct = positiveNumber(trailPct, "trailPct");
  const normalizedTpPct = positiveNumber(tpPct, "tpPct");
  const normalizedFeePct = nonNegativeNumber(feePct, "feePct");
  if (!String(symbol || "").trim()) throw new TypeError("symbol is required");

  // sizeINR is the all-in cash allocation. The entry fee is taken out of that
  // allocation so the runner never spends more cash than the configured slot.
  const entryFee = (cashCommittedINR * normalizedFeePct) / 100;
  const entryNotional = cashCommittedINR - entryFee;
  const qty = entryNotional / entryPrice;

  return {
    symbol: String(symbol).trim(),
    entryPrice,
    qty,
    sizeINR: cashCommittedINR,
    entryNotional,
    entryFee,
    entryTime: Number(timestamp),
    trailPct: normalizedTrailPct,
    tpPct: normalizedTpPct,
    feePct: normalizedFeePct,
    highestPrice: entryPrice,
    stopPrice: entryPrice * (1 - normalizedTrailPct / 100),
    takeProfitPrice: entryPrice * (1 + normalizedTpPct / 100),
    initialRiskINR: qty * entryPrice * (normalizedTrailPct / 100),
    currentPrice: entryPrice,
    updatedAt: Number(timestamp),
  };
}

function updatePosition(position, currentPrice, timestamp = Date.now()) {
  if (!position || typeof position !== "object") throw new TypeError("position is required");
  const price = positiveNumber(currentPrice, "currentPrice");
  const trailPct = positiveNumber(position.trailPct, "position.trailPct");

  const previousHighest = positiveNumber(position.highestPrice, "position.highestPrice");
  const previousStop = positiveNumber(position.stopPrice, "position.stopPrice");
  if (price > previousHighest) {
    position.highestPrice = price;
    position.stopPrice = Math.max(previousStop, price * (1 - trailPct / 100));
  } else {
    position.highestPrice = previousHighest;
    position.stopPrice = previousStop;
  }
  position.currentPrice = price;
  position.updatedAt = Number(timestamp);

  if (price >= position.takeProfitPrice) {
    return { action: "SELL", reason: "TP_HIT", position };
  }
  if (price <= position.stopPrice) {
    return { action: "SELL", reason: "STOP_HIT", position };
  }
  return { action: "HOLD", position };
}

function realizePnL(position, exitPrice, {
  feePct = position?.feePct ?? DEFAULT_FEE_PCT,
  tdsPct = DEFAULT_TDS_PCT,
} = {}) {
  if (!position || typeof position !== "object") throw new TypeError("position is required");
  const price = positiveNumber(exitPrice, "exitPrice");
  const normalizedFeePct = nonNegativeNumber(feePct, "feePct");
  const normalizedTdsPct = nonNegativeNumber(tdsPct, "tdsPct");
  const sellNotional = position.qty * price;
  const sellFee = (sellNotional * normalizedFeePct) / 100;
  const tds = (sellNotional * normalizedTdsPct) / 100;
  const entryFee = Number(position.entryFee) || 0;
  const entryNotional = Number(position.entryNotional) || position.qty * position.entryPrice;
  const grossPnL = sellNotional - entryNotional;
  const fees = entryFee + sellFee;
  const netPnL = grossPnL - fees - tds;
  const cashCommitted = Number(position.sizeINR) || entryNotional + entryFee;
  const initialRisk = Number(position.initialRiskINR) ||
    position.qty * position.entryPrice * (Number(position.trailPct) / 100);

  return {
    grossPnL,
    fees,
    tds,
    netPnL,
    netPct: cashCommitted > 0 ? (netPnL / cashCommitted) * 100 : null,
    netR: initialRisk > 0 ? netPnL / initialRisk : null,
    sellNotional,
    sellFee,
    netProceeds: sellNotional - sellFee - tds,
  };
}

function isCooldownActive(cooldowns, symbol, timestamp = Date.now()) {
  const until = Number(cooldowns?.[symbol]);
  return Number.isFinite(until) && until > Number(timestamp);
}

module.exports = {
  DEFAULT_FEE_PCT,
  DEFAULT_TDS_PCT,
  openPosition,
  updatePosition,
  realizePnL,
  isCooldownActive,
};
