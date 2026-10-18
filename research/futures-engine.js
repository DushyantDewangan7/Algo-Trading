"use strict";

// Single-instrument perpetual futures backtester (USDT-settled, as on CoinDCX).
//
// - A strategy returns +1 (long), −1 (short), 0 (flat) or null (no change) on
//   each bar's close; orders fill at the next bar's open.
// - Position notional = equity × leverage at entry (compounding). All equity
//   is margin, so a liquidation wipes the account (isolated, all-in) — that is
//   what happens with a tiny account at high leverage.
// - Liquidation is checked intrabar with the bar's high/low: a long is
//   liquidated when price falls (1/leverage − maintenance) below entry.
// - Optional intrabar stop-loss / take-profit (fraction of entry price),
//   checked before liquidation only if they are closer than it.
// - Costs: taker fee on each side (CoinDCX shows 0.059% incl. GST), slippage,
//   funding every 8h on notional (longs pay, shorts receive), optional TDS on
//   exit notional (in case it applies).

const DEFAULT_FUT_COSTS = {
  feePct: 0.059,
  slippagePct: 0.03,
  fundingPct8h: 0.01,
  tdsPct: 0,
  maintenancePct: 0.5,
};

const EIGHT_HOURS = 8 * 3_600_000;

function runFutures({ bars, strategy, leverage = 1, costs = DEFAULT_FUT_COSTS, startMs = 0, endMs = Infinity }) {
  const ctx = strategy.init(bars);
  const fee = costs.feePct / 100;
  const slip = costs.slippagePct / 100;
  const fund = costs.fundingPct8h / 100;
  const tds = costs.tdsPct / 100;
  const mm = costs.maintenancePct / 100;
  const barMs = bars.time[1] - bars.time[0];

  let equity = 1;
  let pos = null; // { side, entry, qty, stop, tp }
  let pending = null;
  let peak = 1;
  let maxDd = 0;
  let trades = 0;
  let wins = 0;
  let liquidations = 0;
  let ruined = false;
  let fundingPaid = 0;
  let feesPaid = 0;
  const curve = [];

  const close = (price, kind) => {
    const exitPx = price * (1 - pos.side * slip);
    const pnl = pos.side * pos.qty * (exitPx - pos.entry);
    const notional = pos.qty * exitPx;
    const cost = notional * (fee + tds);
    feesPaid += cost;
    const before = pos.equityAtEntry;
    equity += pnl - cost;
    if (kind === "liq") { equity = 0; liquidations += 1; ruined = true; }
    trades += 1;
    if (equity > before) wins += 1;
    pos = null;
  };

  const open = (side, price) => {
    const entry = price * (1 + side * slip);
    const notional = equity * leverage;
    const cost = notional * fee;
    feesPaid += cost;
    equity -= cost;
    const qty = notional / entry;
    const liqMove = 1 / leverage - mm;
    pos = {
      side, entry, qty, equityAtEntry: equity + cost,
      liq: entry * (1 - side * liqMove),
      stop: strategy.stopPct ? entry * (1 - side * strategy.stopPct) : null,
      tp: strategy.takeProfitPct ? entry * (1 + side * strategy.takeProfitPct) : null,
    };
  };

  const startIdx = bars.time.findIndex((t) => t >= startMs);
  for (let i = Math.max(1, startIdx); i < bars.time.length && bars.time[i] <= endMs && !ruined; i += 1) {
    // Execute last bar's decision at this bar's open.
    if (pending !== null) {
      const want = pending;
      pending = null;
      if (pos && pos.side !== want) close(bars.open[i], "signal");
      if (!pos && want !== 0 && equity > 0) open(want, bars.open[i]);
    }

    if (pos) {
      // Funding at each 8h boundary crossed inside this bar.
      const crossings = Math.floor(bars.time[i] / EIGHT_HOURS + barMs / EIGHT_HOURS) - Math.floor(bars.time[i] / EIGHT_HOURS);
      if (crossings > 0) {
        const notional = pos.qty * bars.open[i];
        const f = crossings * fund * notional * pos.side;
        equity -= f;
        fundingPaid += f;
      }
      // Liquidation price from the margin left right now (funding drains it):
      // equity + side·qty·(p − entry) = maintenance·qty·p.
      pos.liq = pos.side > 0
        ? (pos.qty * pos.entry - equity) / (pos.qty * (1 - mm))
        : (equity + pos.qty * pos.entry) / (pos.qty * (1 + mm));
      const adverse = pos.side > 0 ? bars.low[i] : bars.high[i];
      const favour = pos.side > 0 ? bars.high[i] : bars.low[i];
      const hits = (level) => (pos.side > 0 ? adverse <= level : adverse >= level);
      const stopFirst = pos.stop !== null && (pos.side > 0 ? pos.stop > pos.liq : pos.stop < pos.liq);
      if (stopFirst && hits(pos.stop)) {
        // A gap open beyond the stop fills at the open; if that is past the
        // liquidation price, it is a liquidation.
        const fill = pos.side > 0 ? Math.min(pos.stop, bars.open[i]) : Math.max(pos.stop, bars.open[i]);
        const pastLiq = pos.side > 0 ? fill <= pos.liq : fill >= pos.liq;
        close(pastLiq ? pos.liq : fill, pastLiq ? "liq" : "stop");
      } else if (hits(pos.liq)) {
        close(pos.liq, "liq");
      } else if (pos.tp !== null && (pos.side > 0 ? favour >= pos.tp : favour <= pos.tp)) {
        close(pos.side > 0 ? Math.max(pos.tp, bars.open[i]) : Math.min(pos.tp, bars.open[i]), "tp");
      }
    }

    const mark = pos ? equity + pos.side * pos.qty * (bars.close[i] - pos.entry) : equity;
    if (mark <= 0) { ruined = true; equity = 0; }
    curve.push({ time: bars.time[i], value: Math.max(mark, 0) });
    peak = Math.max(peak, mark);
    maxDd = Math.max(maxDd, 1 - Math.max(mark, 0) / peak);

    if (!ruined) {
      const s = strategy.signal(i, ctx, pos ? pos.side : 0);
      if (s !== null && s !== undefined && s !== (pos ? pos.side : 0)) pending = s;
    }
  }

  const n = curve.length;
  const years = (curve[n - 1].time - curve[0].time) / (365 * 86_400_000);
  const final = curve[n - 1].value;
  // Daily returns for Sharpe, regardless of bar size.
  const daily = [];
  let lastDay = null;
  let lastVal = 1;
  for (const p of curve) {
    const d = Math.floor(p.time / 86_400_000);
    if (lastDay !== null && d !== lastDay) { daily.push(lastVal); }
    lastDay = d;
    lastVal = p.value;
  }
  daily.push(lastVal);
  const rets = [];
  for (let k = 1; k < daily.length; k += 1) rets.push(daily[k - 1] > 0 ? daily[k] / daily[k - 1] - 1 : 0);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  return {
    finalMultiple: final,
    totalReturnPct: (final - 1) * 100,
    cagrPct: final > 0 ? (Math.pow(final, 1 / years) - 1) * 100 : -100,
    maxDrawdownPct: maxDd * 100,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(365) : 0,
    trades,
    tradesPerYear: trades / years,
    winRatePct: trades ? (wins / trades) * 100 : 0,
    liquidated: liquidations > 0,
    ruinDate: ruined ? new Date(curve[n - 1].time).toISOString().slice(0, 10) : null,
    feesPctOfStart: feesPaid * 100,
    fundingPctOfStart: fundingPaid * 100,
    years,
  };
}

function toArrays(candles) {
  const pick = (k) => Float64Array.from(candles.map((c) => c[k]));
  return { time: candles.map((c) => c.time), open: pick("open"), high: pick("high"), low: pick("low"), close: pick("close"), volume: pick("volume") };
}

module.exports = { runFutures, toArrays, DEFAULT_FUT_COSTS };
