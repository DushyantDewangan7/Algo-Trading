// Pure indicator math over OHLCV arrays.
//
// Conventions:
// - Every function returns an array the same length as its input, with null
//   at indices where the indicator is not yet defined. That keeps indicator
//   values aligned with candle indices, so callers never do offset math.
// - Each value at index i depends only on data at indices <= i (causal), so
//   precomputing a full array is safe for walk-forward backtesting.
// - `ohlc` means an array of { open, high, low, close, volume } objects.

function simpleAverage(values, start, end) {
  let sum = 0;
  for (let i = start; i < end; i += 1) sum += values[i];
  return sum / (end - start);
}

function sma(values, period) {
  const result = new Array(values.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || values.length < period) return result;

  let windowSum = 0;
  for (let i = 0; i < values.length; i += 1) {
    windowSum += values[i];
    if (i >= period) windowSum -= values[i - period];
    if (i >= period - 1) result[i] = windowSum / period;
  }
  return result;
}

function ema(values, period) {
  const result = new Array(values.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || values.length < period) return result;

  // Seed with the SMA of the first `period` values, then apply the standard
  // recursion with smoothing factor k = 2 / (period + 1).
  result[period - 1] = simpleAverage(values, 0, period);
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function rsi(values, period = 14) {
  const result = new Array(values.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || values.length <= period) return result;

  // Wilder's RSI: seed average gain/loss with a plain average of the first
  // `period` moves, then smooth with avg = (prevAvg * (period - 1) + move) / period.
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function trueRange(candle, previousClose) {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose),
  );
}

function atr(ohlc, period = 14) {
  const result = new Array(ohlc.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || ohlc.length <= period) return result;

  // True range needs the previous close, so TR values start at index 1.
  // First ATR = plain average of TR[1..period], then Wilder smoothing.
  let atrValue = 0;
  for (let i = 1; i <= period; i += 1) {
    atrValue += trueRange(ohlc[i], ohlc[i - 1].close);
  }
  atrValue /= period;
  result[period] = atrValue;

  for (let i = period + 1; i < ohlc.length; i += 1) {
    atrValue = (atrValue * (period - 1) + trueRange(ohlc[i], ohlc[i - 1].close)) / period;
    result[i] = atrValue;
  }
  return result;
}

function adx(ohlc, period = 14) {
  const result = new Array(ohlc.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || ohlc.length < 2 * period + 1) return result;

  // Directional movement: a bar contributes +DM when its push above the prior
  // high exceeds its push below the prior low (and vice versa for -DM).
  const plusDM = new Array(ohlc.length).fill(0);
  const minusDM = new Array(ohlc.length).fill(0);
  const tr = new Array(ohlc.length).fill(0);
  for (let i = 1; i < ohlc.length; i += 1) {
    const upMove = ohlc[i].high - ohlc[i - 1].high;
    const downMove = ohlc[i - 1].low - ohlc[i].low;
    if (upMove > downMove && upMove > 0) plusDM[i] = upMove;
    if (downMove > upMove && downMove > 0) minusDM[i] = downMove;
    tr[i] = trueRange(ohlc[i], ohlc[i - 1].close);
  }

  // Wilder-smoothed running sums, seeded with the sum of the first `period`
  // raw values, then s = s - s/period + raw.
  let smoothTR = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;
  for (let i = 1; i <= period; i += 1) {
    smoothTR += tr[i];
    smoothPlus += plusDM[i];
    smoothMinus += minusDM[i];
  }

  // DX at index i measures how one-sided the directional movement is; ADX is
  // the Wilder-smoothed DX, seeded with a plain average of the first `period` DXs.
  const dx = new Array(ohlc.length).fill(null);
  for (let i = period; i < ohlc.length; i += 1) {
    if (i > period) {
      smoothTR = smoothTR - smoothTR / period + tr[i];
      smoothPlus = smoothPlus - smoothPlus / period + plusDM[i];
      smoothMinus = smoothMinus - smoothMinus / period + minusDM[i];
    }
    const plusDI = smoothTR === 0 ? 0 : (100 * smoothPlus) / smoothTR;
    const minusDI = smoothTR === 0 ? 0 : (100 * smoothMinus) / smoothTR;
    const diSum = plusDI + minusDI;
    dx[i] = diSum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / diSum;
  }

  let adxValue = simpleAverage(dx, period, 2 * period);
  result[2 * period - 1] = adxValue;
  for (let i = 2 * period; i < ohlc.length; i += 1) {
    adxValue = (adxValue * (period - 1) + dx[i]) / period;
    result[i] = adxValue;
  }
  return result;
}

function roc(values, period) {
  const result = new Array(values.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || values.length <= period) return result;

  for (let i = period; i < values.length; i += 1) {
    if (values[i - period] === 0) continue;
    result[i] = (values[i] / values[i - period] - 1) * 100;
  }
  return result;
}

function volumeMA(volumes, period = 20) {
  return sma(volumes, period);
}

module.exports = { ema, rsi, atr, adx, roc, volumeMA, sma };
