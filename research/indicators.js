"use strict";

// Causal indicators over Float64Arrays: value[i] uses only data up to i.
// NaN until enough history exists.

function sma(values, period) {
  const out = new Float64Array(values.length).fill(NaN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) { sum = 0; count = 0; continue; }
    sum += v; count += 1;
    if (count > period) { sum -= values[i - period]; count = period; }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Float64Array(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  let seen = 0;
  let seed = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (seen < period) {
      seed += v; seen += 1;
      if (seen === period) { prev = seed / period; out[i] = prev; }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(values, period) {
  const out = new Float64Array(values.length).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;
  let seen = 0;
  for (let i = 1; i < values.length; i += 1) {
    const a = values[i - 1];
    const b = values[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const change = b - a;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (seen < period) {
      avgGain += gain / period; avgLoss += loss / period; seen += 1;
      if (seen < period) continue;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// Highest / lowest of the previous `period` values, excluding i itself.
function priorMax(values, period) {
  const out = new Float64Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i += 1) {
    let m = -Infinity;
    for (let j = i - period; j < i; j += 1) m = Math.max(m, values[j]);
    if (Number.isFinite(m)) out[i] = m;
  }
  return out;
}

function priorMin(values, period) {
  const out = new Float64Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i += 1) {
    let m = Infinity;
    for (let j = i - period; j < i; j += 1) m = Math.min(m, values[j]);
    if (Number.isFinite(m)) out[i] = m;
  }
  return out;
}

function pctChange(values, lookback) {
  const out = new Float64Array(values.length).fill(NaN);
  for (let i = lookback; i < values.length; i += 1) {
    const a = values[i - lookback];
    if (a > 0 && Number.isFinite(values[i])) out[i] = values[i] / a - 1;
  }
  return out;
}

function atr(high, low, close, period) {
  const tr = new Float64Array(close.length).fill(NaN);
  for (let i = 1; i < close.length; i += 1) {
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  // Wilder smoothing
  const out = new Float64Array(close.length).fill(NaN);
  let prev = NaN;
  let seen = 0;
  let seed = 0;
  for (let i = 1; i < close.length; i += 1) {
    if (!Number.isFinite(tr[i])) continue;
    if (seen < period) {
      seed += tr[i]; seen += 1;
      if (seen === period) { prev = seed / period; out[i] = prev; }
      continue;
    }
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

// Classic Supertrend. Returns +1 (uptrend) / -1 (downtrend) per bar.
function supertrend(high, low, close, period, mult) {
  const a = atr(high, low, close, period);
  const dir = new Int8Array(close.length);
  let upper = NaN;
  let lower = NaN;
  let trend = 1;
  for (let i = 0; i < close.length; i += 1) {
    if (!Number.isFinite(a[i])) continue;
    const mid = (high[i] + low[i]) / 2;
    const bu = mid + mult * a[i];
    const bl = mid - mult * a[i];
    const prevClose = close[i - 1];
    upper = !Number.isFinite(upper) || bu < upper || prevClose > upper ? bu : upper;
    lower = !Number.isFinite(lower) || bl > lower || prevClose < lower ? bl : lower;
    if (trend === 1 && close[i] < lower) trend = -1;
    else if (trend === -1 && close[i] > upper) trend = 1;
    dir[i] = trend;
  }
  return dir;
}

function stdev(values, period) {
  const out = new Float64Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i += 1) {
    let s = 0;
    let s2 = 0;
    for (let j = i - period + 1; j <= i; j += 1) { s += values[j]; s2 += values[j] ** 2; }
    const m = s / period;
    out[i] = Math.sqrt(Math.max(0, s2 / period - m * m));
  }
  return out;
}

module.exports = { sma, ema, rsi, priorMax, priorMin, pctChange, atr, supertrend, stdev };
