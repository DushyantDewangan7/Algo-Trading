"use strict";

// Strategy catalogue. Each strategy is { name, maxPositions, init(), decide() }.
// decide(i) runs on day i's close and returns the symbols to hold from the next
// open, or null for "no change".

const ind = require("./indicators");

const isSunday = (t) => new Date(t).getUTCDay() === 0;

// Single-coin strategy from a per-bar boolean signal. `signal(i, s, holding)`
// returns true (want to hold), false (want flat) or null (keep current state).
function single(name, symbol, prepare, signal) {
  return {
    name,
    maxPositions: 1,
    init: ({ series }) => ({ s: series[symbol], cache: prepare(series[symbol], series) }),
    decide(i, { ctx, holdings }) {
      const holding = holdings.has(symbol);
      const want = signal(i, ctx.cache, holding, ctx.s);
      if (want === null || want === undefined) return null;
      return want ? [symbol] : [];
    },
  };
}

const hold = (symbol) => single(`Buy & hold ${symbol}`, symbol, () => ({}), () => true);

const smaFilter = (symbol, period) => single(
  `${symbol} above ${period}d SMA`, symbol,
  (s) => ({ ma: ind.sma(s.close, period) }),
  (i, c, _h, s) => (Number.isFinite(c.ma[i]) ? s.close[i] > c.ma[i] : null),
);

const maCross = (symbol, fast, slow, kind = "sma") => single(
  `${symbol} ${kind.toUpperCase()} ${fast}/${slow} cross`, symbol,
  (s) => ({ f: ind[kind](s.close, fast), sl: ind[kind](s.close, slow) }),
  (i, c) => (Number.isFinite(c.sl[i]) ? c.f[i] > c.sl[i] : null),
);

// Turtle-style breakout on closing prices (closes are robust to bad wicks).
const donchian = (symbol, entry, exit) => single(
  `${symbol} Donchian ${entry}/${exit} breakout`, symbol,
  (s) => ({ hi: ind.priorMax(s.close, entry), lo: ind.priorMin(s.close, exit) }),
  (i, c, holding, s) => {
    if (!holding && s.close[i] > c.hi[i]) return true;
    if (holding && s.close[i] < c.lo[i]) return false;
    return null;
  },
);

// Time-series momentum: hold while the trailing return is positive.
const tsmom = (symbol, lookback) => single(
  `${symbol} ${lookback}d time-series momentum`, symbol,
  (s) => ({ r: ind.pctChange(s.close, lookback) }),
  (i, c) => (Number.isFinite(c.r[i]) ? c.r[i] > 0 : null),
);

// Connors RSI(2): buy deep pullbacks in an uptrend, exit on a bounce.
const rsi2 = (symbol, buyBelow = 10) => single(
  `${symbol} RSI(2) pullback <${buyBelow}`, symbol,
  (s) => ({ r: ind.rsi(s.close, 2), ma200: ind.sma(s.close, 200), ma5: ind.sma(s.close, 5) }),
  (i, c, holding, s) => {
    if (!Number.isFinite(c.ma200[i])) return null;
    if (!holding && s.close[i] > c.ma200[i] && c.r[i] < buyBelow) return true;
    if (holding && (s.close[i] > c.ma5[i] || s.close[i] < c.ma200[i] * 0.9)) return false;
    return null;
  },
);

const supertrend = (symbol, period, mult) => single(
  `${symbol} Supertrend(${period},${mult})`, symbol,
  (s) => ({ d: ind.supertrend(s.high, s.low, s.close, period, mult) }),
  (i, c) => (c.d[i] ? c.d[i] > 0 : null),
);

// Cross-sectional momentum rotation, rebalanced weekly on Sunday's close.
//  - rank coins by trailing `lookback`-day return (optionally vol-adjusted)
//  - only coins with positive momentum and (optionally) above their own SMA
//  - go to cash when BTC is below its `regimeSma`-day SMA
//  - a held coin is kept while it stays within the top `topN + buffer`
function rotation({
  universe,
  lookback = 28,
  topN = 1,
  regimeSma = 200,
  assetSma = 0,
  volAdjust = false,
  buffer = 0,
  rebalanceWeeks = 1,
  label,
}) {
  return {
    name: label || `Rotation (${universe.length} coins) top${topN} ${lookback}d${regimeSma ? ` BTC>${regimeSma}SMA` : ""}${assetSma ? ` coin>${assetSma}SMA` : ""}${volAdjust ? " vol-adj" : ""}${buffer ? ` buf${buffer}` : ""}${rebalanceWeeks > 1 ? ` every ${rebalanceWeeks}w` : ""}`,
    maxPositions: topN,
    init: ({ series, calendar }) => {
      const syms = universe.filter((u) => series[u]);
      const c = { syms, calendar, r: {}, ma: {}, vol: {} };
      for (const u of syms) {
        c.r[u] = ind.pctChange(series[u].close, lookback);
        if (assetSma) c.ma[u] = ind.sma(series[u].close, assetSma);
        if (volAdjust) {
          const d = ind.pctChange(series[u].close, 1).map((v) => (Number.isFinite(v) ? v : 0));
          c.vol[u] = ind.stdev(d, lookback);
        }
      }
      if (regimeSma) c.btcMa = ind.sma(series.BTC.close, regimeSma);
      return c;
    },
    decide(i, { ctx: c, series, holdings }) {
      if (!isSunday(c.calendar[i])) return null;
      if (Math.floor(c.calendar[i] / (7 * 86_400_000)) % rebalanceWeeks !== 0) return null;
      if (regimeSma && !(series.BTC.close[i] > c.btcMa[i])) return [];
      const ranked = c.syms
        .filter((u) => series[u].live[i] && Number.isFinite(c.r[u][i]) && c.r[u][i] > 0)
        .filter((u) => !assetSma || series[u].close[i] > c.ma[u][i])
        .map((u) => ({ u, score: volAdjust ? c.r[u][i] / (c.vol[u][i] || Infinity) : c.r[u][i] }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.u);
      const keepZone = new Set(ranked.slice(0, topN + buffer));
      const kept = [...holdings.keys()].filter((h) => keepZone.has(h));
      const fill = ranked.filter((u) => !kept.includes(u)).slice(0, topN - kept.length);
      return [...kept, ...fill];
    },
  };
}

// Dual momentum (Antonacci-style) between a few majors, weekly.
const dualMomentum = (assets, lookback) => ({
  name: `Dual momentum ${assets.join("/")} ${lookback}d`,
  maxPositions: 1,
  init: ({ series, calendar }) => ({
    calendar,
    r: Object.fromEntries(assets.map((a) => [a, ind.pctChange(series[a].close, lookback)])),
  }),
  decide(i, { ctx }) {
    if (!isSunday(ctx.calendar[i])) return null;
    const best = assets
      .filter((a) => Number.isFinite(ctx.r[a][i]))
      .sort((a, b) => ctx.r[b][i] - ctx.r[a][i])[0];
    if (!best) return null;
    return ctx.r[best][i] > 0 ? [best] : [];
  },
});

// Trend filter applied to each of several majors, equal slots.
const multiTrend = (assets, period) => ({
  name: `${assets.join("+")} each above ${period}d SMA`,
  maxPositions: assets.length,
  init: ({ series }) => ({ ma: Object.fromEntries(assets.map((a) => [a, ind.sma(series[a].close, period)])) }),
  decide(i, { ctx, series }) {
    return assets.filter((a) => series[a].close[i] > ctx.ma[a][i]);
  },
});

function weeklyTsmom(symbol, lookback) {
  const base = tsmom(symbol, lookback);
  return {
    ...base,
    name: `${symbol} ${lookback}d time-series momentum (weekly)`,
    init: (args) => ({ ...base.init(args), calendar: args.calendar }),
    decide(i, args) {
      if (!isSunday(args.ctx.calendar[i])) return null;
      return base.decide(i, args);
    },
  };
}

// Majority vote of three trend rules on one coin: EMA 20/50 cross, close above
// the 100-day SMA, and the Donchian 55/20 breakout state. Holds while at least
// `need` rules are long. Spreads the bet across rule choices so no single
// parameter set decides everything.
function trendVote(symbol, need = 2) {
  return {
    name: `${symbol} trend vote (${need} of 3: EMA20/50, SMA100, Donchian55/20)`,
    maxPositions: 1,
    init: ({ series }) => {
      const s = series[symbol];
      return {
        s,
        e20: ind.ema(s.close, 20), e50: ind.ema(s.close, 50),
        ma100: ind.sma(s.close, 100),
        hi55: ind.priorMax(s.close, 55), lo20: ind.priorMin(s.close, 20),
        donLong: false,
      };
    },
    decide(i, { ctx: c }) {
      if (!Number.isFinite(c.ma100[i]) || !Number.isFinite(c.e50[i])) return null;
      const px = c.s.close[i];
      if (!c.donLong && px > c.hi55[i]) c.donLong = true;
      else if (c.donLong && px < c.lo20[i]) c.donLong = false;
      const votes = (c.e20[i] > c.e50[i]) + (px > c.ma100[i]) + c.donLong;
      return votes >= need ? [symbol] : [];
    },
  };
}

// Price vs SMA with a ±band to cut whipsaws: enter above (1+band)·SMA, exit
// below (1−band)·SMA.
const smaBand = (symbol, period, bandPct = 1) => single(
  `${symbol} SMA${period} ±${bandPct}% band`, symbol,
  (s) => ({ ma: ind.sma(s.close, period) }),
  (i, c, holding, s) => {
    if (!Number.isFinite(c.ma[i])) return null;
    if (!holding && s.close[i] > c.ma[i] * (1 + bandPct / 100)) return true;
    if (holding && s.close[i] < c.ma[i] * (1 - bandPct / 100)) return false;
    return null;
  },
);

// Fractional sizing in two halves: the engine holds "BTC" and "BTC#2" as two
// equal slots of the same coin (aliases added by withHalves). Raw weight in
// [0,1] maps to 0, ½ or 1 with hysteresis so small wiggles don't trade.
function halves(symbol, name, prepare, rawWeight, hysteresis = 0.35) {
  const alias = `${symbol}#2`;
  return {
    name,
    maxPositions: 2,
    init: ({ series, calendar }) => ({ s: series[symbol], calendar, cache: prepare(series[symbol]), level: 0 }),
    decide(i, { ctx }) {
      const w = rawWeight(i, ctx.cache, ctx.s);
      if (!Number.isFinite(w)) return null;
      if (Math.abs(w - ctx.level) > hysteresis) ctx.level = Math.round(w * 2) / 2;
      if (ctx.level >= 1) return [symbol, alias];
      if (ctx.level >= 0.5) return [symbol];
      return [];
    },
  };
}

function withHalves(aligned, symbols) {
  for (const s of symbols) aligned.series[`${s}#2`] = aligned.series[s];
  return aligned;
}

const annualVol = (close, period) => {
  const r = ind.pctChange(close, 1).map((v) => (Number.isFinite(v) ? v : 0));
  return ind.stdev(r, period).map((v) => v * Math.sqrt(365));
};

// Zarattini, Pagani & Barbon (2025) Donchian ensemble, long-only, adapted for
// a small account: lookbacks ≥20d, no leverage, target vol 50%, halves sizing.
function donchianEnsemble(symbol, { lookbacks = [20, 30, 60, 90, 150, 250, 360], targetVol = 0.5 } = {}) {
  return halves(symbol, `${symbol} Donchian ensemble (Zarattini 2025, vol-target ${targetVol * 100}%)`,
    (s) => ({
      legs: lookbacks.map((n) => ({ hi: ind.priorMax(s.close, n), lo: ind.priorMin(s.close, n), long: false, stop: 0 })),
      vol: annualVol(s.close, 90),
    }),
    (i, c, s) => {
      let on = 0;
      for (const leg of c.legs) {
        if (!Number.isFinite(leg.hi[i])) continue;
        const mid = (leg.hi[i] + leg.lo[i]) / 2;
        if (!leg.long && s.close[i] > leg.hi[i]) { leg.long = true; leg.stop = mid; }
        else if (leg.long) {
          leg.stop = Math.max(leg.stop, mid);
          if (s.close[i] < leg.stop) leg.long = false;
        }
        on += leg.long ? 1 : 0;
      }
      if (!Number.isFinite(c.vol[i]) || c.vol[i] <= 0) return NaN;
      return (on / c.legs.length) * Math.min(1, targetVol / c.vol[i]);
    });
}

// SMA trend filter with a volatility overlay (Man Group style), halves sizing.
const smaVolTarget = (symbol, period = 100, targetVol = 0.5) => halves(symbol,
  `${symbol} SMA${period} + vol-target ${targetVol * 100}%`,
  (s) => ({ ma: ind.sma(s.close, period), vol: annualVol(s.close, 30) }),
  (i, c, s) => {
    if (!Number.isFinite(c.ma[i]) || !Number.isFinite(c.vol[i])) return NaN;
    return s.close[i] > c.ma[i] ? Math.min(1, targetVol / c.vol[i]) : 0;
  });

// Jesse "SimpleBollinger" moved to daily: BB(20,2) on (high+low)/2; enter on a
// close above the upper band while above both Ichimoku lead lines; exit below
// the middle band.
function bollingerBreakout(symbol) {
  return single(`${symbol} Bollinger(20,2) breakout + Ichimoku (Jesse)`, symbol,
    (s) => {
      const hl2 = s.high.map((h, i) => (h + s.low[i]) / 2);
      const mid = ind.sma(hl2, 20);
      const sd = ind.stdev(hl2, 20);
      const hh = (n) => ind.priorMax(s.high, n).map((v, i, a) => (i + 1 < a.length ? a[i + 1] : NaN));
      const ll = (n) => ind.priorMin(s.low, n).map((v, i, a) => (i + 1 < a.length ? a[i + 1] : NaN));
      // hh(n)[i] = highest high of the n bars ending at i (inclusive).
      const l9 = ll(9); const l26 = ll(26);
      const tenkan = hh(9).map((v, i) => (v + l9[i]) / 2);
      const kijun = hh(26).map((v, i) => (v + l26[i]) / 2);
      const h52 = hh(52); const l52 = ll(52);
      const n = s.close.length;
      const spanA = new Float64Array(n).fill(NaN);
      const spanB = new Float64Array(n).fill(NaN);
      for (let i = 26; i < n; i += 1) {
        spanA[i] = (tenkan[i - 26] + kijun[i - 26]) / 2; // plotted 26 bars ahead
        spanB[i] = (h52[i - 26] + l52[i - 26]) / 2;
      }
      return { mid, upper: mid.map((m, i) => m + 2 * sd[i]), spanA, spanB };
    },
    (i, c, holding, s) => {
      if (!Number.isFinite(c.upper[i]) || !Number.isFinite(c.spanB[i])) return null;
      if (!holding && s.close[i] > c.upper[i] && s.close[i] > Math.max(c.spanA[i], c.spanB[i])) return true;
      if (holding && s.close[i] < c.mid[i]) return false;
      return null;
    });
}

module.exports = {
  hold, smaFilter, maCross, donchian, tsmom, weeklyTsmom, rsi2, supertrend,
  rotation, dualMomentum, multiTrend, trendVote, smaBand, donchianEnsemble,
  smaVolTarget, bollingerBreakout, withHalves,
};
