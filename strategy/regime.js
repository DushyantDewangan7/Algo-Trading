// Market regime classifier, benchmarked on BTC's own daily candles.
//
// BTC dominance makes its trend/chop state a reasonable proxy for "is this a
// good environment to be long momentum / relative-strength names at all" —
// alts overwhelmingly trade with BTC's regime, so gating entries on it cuts
// exposure exactly when correlation-driven drawdowns are most likely.
//
// getRegime(btcDailyCandles) -> 'TREND_UP' | 'TREND_DOWN' | 'RANGE'
//   - EMA(50) vs EMA(200) on the 1d chart gives trend direction.
//   - ADX(14) on the 1d chart gives the trend/range split:
//       ADX > 25            -> confirmed trend, use EMA direction
//       ADX < 20             -> RANGE, no real trend
//       20 <= ADX <= 25      -> neutral/forming: not confirmed either way,
//                               treated as RANGE (no-trade) rather than
//                               guessing a direction from a weak signal.
//
// getRegime returns null only when there isn't enough history to compute
// EMA(200)/ADX(14) yet — the literal three-value contract assumes valid,
// sufficient input; null is a practical "unknown" escape hatch callers must
// handle explicitly (this codebase's convention is to fail safe to RANGE).

const { ema, adx } = require("./indicators");

const REGIME = { TREND_UP: "TREND_UP", TREND_DOWN: "TREND_DOWN", RANGE: "RANGE" };

const EMA_FAST_PERIOD = 50;
const EMA_SLOW_PERIOD = 200;
const ADX_PERIOD = 14;
const ADX_TREND_MIN = 25;
const ADX_RANGE_MAX = 20;

// CoinDCX INR pair used as the market-regime benchmark.
const REGIME_BENCHMARK_SYMBOL = "I-BTC_INR";

function requiredRegimeHistory() {
  return Math.max(EMA_SLOW_PERIOD, 2 * ADX_PERIOD + 1) + 5;
}

function classify(emaFastValue, emaSlowValue, adxValue) {
  if (emaFastValue === null || emaSlowValue === null || adxValue === null) return null;
  if (adxValue < ADX_RANGE_MAX) return REGIME.RANGE;
  if (adxValue > ADX_TREND_MIN) {
    return emaFastValue > emaSlowValue ? REGIME.TREND_UP : REGIME.TREND_DOWN;
  }
  return REGIME.RANGE; // 20-25 neutral band: not confirmed, no-trade RANGE
}

// Regime at every index of `dailyCandles` (ascending, closed candles) — null
// until EMA(200)/ADX(14) have enough history. Causal: each value only
// depends on candles up to its own index, so this is safe for walk-forward
// backtesting.
function computeRegimeSeries(dailyCandles) {
  if (!Array.isArray(dailyCandles) || dailyCandles.length === 0) return [];
  const closes = dailyCandles.map((candle) => candle.close);
  const emaFastArr = ema(closes, EMA_FAST_PERIOD);
  const emaSlowArr = ema(closes, EMA_SLOW_PERIOD);
  const adxArr = adx(dailyCandles, ADX_PERIOD);
  return dailyCandles.map((_, i) => classify(emaFastArr[i], emaSlowArr[i], adxArr[i]));
}

// Latest regime for a BTC daily candle series.
function getRegime(btcDailyCandles) {
  const series = computeRegimeSeries(btcDailyCandles);
  return series.length > 0 ? series.at(-1) : null;
}

// Align a daily regime series onto a finer (e.g. 4h) intraday candle series
// without lookahead: an intraday bar only "sees" a daily regime once that
// daily candle has fully closed (dailyTime + 1 day <= intraday bar's open
// time). Both inputs must be ascending; O(n + m) via a moving cursor.
function alignDailyRegime(intradayCandles, dailyCandles, regimeSeries) {
  const dayMs = 86_400_000;
  const aligned = new Array(intradayCandles.length).fill(null);
  let dayIndex = -1;
  let cursor = 0;
  for (let i = 0; i < intradayCandles.length; i += 1) {
    const t = intradayCandles[i].time;
    while (cursor < dailyCandles.length && dailyCandles[cursor].time + dayMs <= t) {
      dayIndex = cursor;
      cursor += 1;
    }
    aligned[i] = dayIndex >= 0 ? regimeSeries[dayIndex] : null;
  }
  return aligned;
}

module.exports = {
  REGIME,
  REGIME_BENCHMARK_SYMBOL,
  EMA_FAST_PERIOD,
  EMA_SLOW_PERIOD,
  ADX_PERIOD,
  ADX_TREND_MIN,
  ADX_RANGE_MAX,
  requiredRegimeHistory,
  computeRegimeSeries,
  getRegime,
  alignDailyRegime,
};
