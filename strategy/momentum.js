// Momentum signal logic for a single symbol on one timeframe.
//
// Candles must be an ASCENDING array of closed candles:
//   { time (ms, candle open), open, high, low, close, volume }
// The forming (incomplete) candle should be dropped by the caller before
// calling in — signals are only meaningful on closed bars.

const { ema, rsi, atr, adx, roc, volumeMA } = require("./indicators");

const DEFAULT_PARAMS = {
  emaFast: 20,
  emaSlow: 50,
  emaLong: 200,
  rsiPeriod: 14,
  rsiEntryMin: 55,
  rsiEntryMax: 75,
  rsiExit: 45,
  adxPeriod: 14,
  adxMin: 20,
  volumePeriod: 20,
  volumeMultiple: 1.2,
  rocPeriod: 10,
  atrPeriod: 14,
  atrMultiple: 2,
  partialTakeR: 2, // sell 50% at +2R, move stop to breakeven
};

function mergeParams(overrides) {
  return { ...DEFAULT_PARAMS, ...(overrides || {}) };
}

// Minimum closed candles needed before every indicator is defined.
function requiredHistory(overrides) {
  const params = mergeParams(overrides);
  return Math.max(params.emaLong, 2 * params.adxPeriod + 1) + 10;
}

function computeIndicators(candles, overrides) {
  const params = mergeParams(overrides);
  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);

  return {
    params,
    closes,
    emaFast: ema(closes, params.emaFast),
    emaSlow: ema(closes, params.emaSlow),
    emaLong: ema(closes, params.emaLong),
    rsi: rsi(closes, params.rsiPeriod),
    adx: adx(candles, params.adxPeriod),
    atr: atr(candles, params.atrPeriod),
    roc: roc(closes, params.rocPeriod),
    volumeMA: volumeMA(volumes, params.volumePeriod),
  };
}

// Latest indicator values, for dashboards / API responses.
function snapshot(candles, overrides) {
  const params = mergeParams(overrides);
  if (!Array.isArray(candles) || candles.length === 0) return null;

  const indicators = computeIndicators(candles, params);
  const i = candles.length - 1;
  const emaAligned =
    indicators.emaFast[i] !== null &&
    indicators.emaSlow[i] !== null &&
    indicators.emaLong[i] !== null &&
    indicators.emaFast[i] > indicators.emaSlow[i] &&
    indicators.emaSlow[i] > indicators.emaLong[i];

  return {
    close: indicators.closes[i],
    time: candles[i].time,
    emaFast: indicators.emaFast[i],
    emaSlow: indicators.emaSlow[i],
    emaLong: indicators.emaLong[i],
    emaAligned,
    rsi: indicators.rsi[i],
    adx: indicators.adx[i],
    atr: indicators.atr[i],
    roc: indicators.roc[i],
    volume: candles[i].volume,
    volumeMA: indicators.volumeMA[i],
    volumeRatio:
      indicators.volumeMA[i] > 0 ? candles[i].volume / indicators.volumeMA[i] : null,
  };
}

function hold(reason, extras = {}) {
  return { action: "HOLD", reason, stopLoss: null, takeProfit: null, sizeR: null, ...extras };
}

// The stop that currently protects a position: the widest of the hard stop
// from entry, the ATR trailing stop, and breakeven once the +2R partial fired.
function effectiveStop(position, atrNow, params, close) {
  const entry = position.entryPrice;
  const initialStop = position.initialStop ?? position.stopLoss ?? entry - 2 * atrNow;
  const highestClose = Math.max(position.highestClose ?? entry, entry, close);
  const trailingStop =
    atrNow === null ? -Infinity : highestClose - params.atrMultiple * atrNow;
  const breakevenStop = position.tookPartial ? entry : -Infinity;
  return {
    stop: Math.max(initialStop, trailingStop, breakevenStop, position.stopLoss ?? -Infinity),
    initialStop,
    trailingStop,
  };
}

// Evaluate the signal as of candle `index`, using indicator arrays that were
// precomputed over the full candle set. Safe for walk-forward use because
// every indicator value at `index` only depends on candles <= index.
//
// `regime` is a value from regime.js's getRegime()/computeRegimeSeries()
// (BTC's own daily trend/range state). Anything other than "TREND_UP",
// including an unknown/null regime, blocks new entries (HOLD). Existing
// positions keep managing their own exits regardless. Pass the explicit
// sentinel `false` only for backtests that intentionally disable the filter.
function evaluateSignalAt(candles, indicators, index, position, overrides, regime = null) {
  const params = indicators?.params || mergeParams(overrides);
  const minBars = requiredHistory(params);
  if (!Array.isArray(candles) || index < minBars - 1) {
    return hold(`Insufficient history (${index + 1}/${minBars} closed candles)`);
  }

  const close = indicators.closes[index];
  const atrNow = indicators.atr[index];
  const rsiNow = indicators.rsi[index];
  const adxNow = indicators.adx[index];

  if (position) {
    const entry = position.entryPrice;
    const riskPerUnit =
      position.riskPerUnit ?? entry - (position.initialStop ?? entry - 2 * atrNow);
    const { stop, initialStop, trailingStop } = effectiveStop(position, atrNow, params, close);
    const partialTarget = entry + params.partialTakeR * riskPerUnit;

    if (close <= stop) {
      const reason =
        close <= initialStop
          ? `Hard stop hit (close ${close} ≤ stop ${round(initialStop)})`
          : position.tookPartial && close <= entry
            ? `Breakeven stop hit after partial take-profit`
            : `Trailing stop hit (close ${close} ≤ ${round(trailingStop)})`;
      return { action: "SELL", reason, stopLoss: stop, takeProfit: null, sizeR: riskPerUnit };
    }

    const prevClose = indicators.closes[index - 1];
    const prevEmaFast = indicators.emaFast[index - 1];
    if (
      indicators.emaFast[index] !== null &&
      prevEmaFast !== null &&
      close < indicators.emaFast[index] &&
      prevClose < prevEmaFast
    ) {
      return {
        action: "SELL",
        reason: `Trend break: 2 consecutive closes below EMA(${params.emaFast})`,
        stopLoss: stop,
        takeProfit: null,
        sizeR: riskPerUnit,
      };
    }

    if (rsiNow !== null && rsiNow < params.rsiExit) {
      return {
        action: "SELL",
        reason: `Momentum lost: RSI(${params.rsiPeriod}) ${round(rsiNow)} < ${params.rsiExit}`,
        stopLoss: stop,
        takeProfit: null,
        sizeR: riskPerUnit,
      };
    }

    if (!position.tookPartial && close >= partialTarget) {
      return {
        action: "REDUCE_50",
        reason: `Take-profit ladder: +${params.partialTakeR}R reached, sell 50% and move stop to breakeven`,
        stopLoss: Math.max(stop, entry), // breakeven after the partial
        takeProfit: partialTarget,
        sizeR: riskPerUnit,
      };
    }

    return {
      action: "HOLD",
      reason: `In position: stop ${round(stop)}, ${position.tookPartial ? "riding runner" : `+${params.partialTakeR}R target ${round(partialTarget)}`}`,
      stopLoss: stop,
      takeProfit: position.tookPartial ? null : partialTarget,
      sizeR: riskPerUnit,
    };
  }

  // Flat: regime gate first (cheapest check, and the reason is worth
  // surfacing on its own rather than burying it in the entry-condition list).
  if (regime !== false && regime !== "TREND_UP") {
    return hold(
      `Regime filter: BTC regime is ${regime || "UNKNOWN"}, entries only allowed in TREND_UP`,
    );
  }

  // Flat: check every entry condition and report the ones that fail.
  const volumeNow = candles[index].volume;
  const volumeAvg = indicators.volumeMA[index];
  const checks = [
    {
      ok:
        indicators.emaFast[index] !== null &&
        indicators.emaFast[index] > indicators.emaSlow[index] &&
        indicators.emaSlow[index] > indicators.emaLong[index],
      label: `EMA ${params.emaFast}>${params.emaSlow}>${params.emaLong}`,
    },
    {
      ok: rsiNow !== null && rsiNow >= params.rsiEntryMin && rsiNow <= params.rsiEntryMax,
      label: `RSI ${round(rsiNow)} in ${params.rsiEntryMin}-${params.rsiEntryMax}`,
    },
    {
      ok: adxNow !== null && adxNow > params.adxMin,
      label: `ADX ${round(adxNow)} > ${params.adxMin}`,
    },
    {
      ok: indicators.emaFast[index] !== null && close > indicators.emaFast[index],
      label: `close > EMA(${params.emaFast})`,
    },
    {
      ok: volumeAvg !== null && volumeNow > params.volumeMultiple * volumeAvg,
      label: `volume > ${params.volumeMultiple}× avg`,
    },
    {
      ok: indicators.roc[index] !== null && indicators.roc[index] > 0,
      label: `ROC(${params.rocPeriod}) > 0`,
    },
  ];

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    return hold(`Waiting: ${failed.map((check) => check.label).join(", ")}`);
  }

  if (atrNow === null || atrNow <= 0) return hold("ATR unavailable");

  const stopLoss = close - params.atrMultiple * atrNow;
  const sizeR = close - stopLoss; // one R in price terms
  return {
    action: "BUY",
    reason: "All entry conditions met: trend aligned, RSI strong, ADX trending, volume confirmed, momentum positive",
    stopLoss,
    takeProfit: close + params.partialTakeR * sizeR,
    sizeR,
  };
}

// Public entry point: signal for the latest closed candle.
//
// `position` is null when flat, or:
//   { entryPrice, qty, stopLoss, initialStop, riskPerUnit, highestClose, tookPartial }
// `regime` is optional — see evaluateSignalAt's doc comment.
function generateSignal(candles, position = null, overrides = {}, regime = null) {
  const params = mergeParams(overrides);
  const minBars = requiredHistory(params);
  if (!Array.isArray(candles) || candles.length < minBars) {
    return hold(`Insufficient history (${candles?.length || 0}/${minBars} closed candles)`);
  }

  const indicators = computeIndicators(candles, params);
  return evaluateSignalAt(candles, indicators, candles.length - 1, position, params, regime);
}

function round(value) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toPrecision(6));
}

module.exports = {
  DEFAULT_PARAMS,
  requiredHistory,
  computeIndicators,
  snapshot,
  generateSignal,
  evaluateSignalAt,
};
