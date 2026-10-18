"use strict";

// Futures backtests on CoinDCX USDT-pair prices with CoinDCX perpetual costs.
//   node research/futures-run.js [--tds 0] [--funding 0.01]
// Writes research/results-futures.md.

const fs = require("node:fs");
const path = require("node:path");
const ind = require("./indicators");
const { loadHourly, rollup, HOUR_MS } = require("./usdt-data");
const { runFutures, toArrays, DEFAULT_FUT_COSTS } = require("./futures-engine");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}
const COSTS = { ...DEFAULT_FUT_COSTS, tdsPct: arg("tds", 0), fundingPct8h: arg("funding", 0.01) };

const FULL = Date.UTC(2021, 3, 1); // leave room for 200-bar warm-ups on daily
const RECENT = Date.UTC(2024, 0, 1);

// ---------- strategies: signal(i, ctx, side) -> +1 / −1 / 0 / null ----------
const ls = (allowShort) => (up) => (up ? 1 : allowShort ? -1 : 0);

const S = {
  smaBand: (period, band = 1, short = false) => ({
    name: `SMA${period} ±${band}% ${short ? "long/short" : "long-only"}`,
    init: (b) => ({ b, ma: ind.sma(b.close, period) }),
    signal(i, c, side) {
      const m = c.ma[i];
      if (!Number.isFinite(m)) return null;
      const px = c.b.close[i];
      if (px > m * (1 + band / 100)) return 1;
      if (px < m * (1 - band / 100)) return short ? -1 : 0;
      return side === 0 ? null : side; // inside the band: keep
    },
  }),
  emaCross: (fast, slow, short = false) => ({
    name: `EMA${fast}/${slow} ${short ? "long/short" : "long-only"}`,
    init: (b) => ({ f: ind.ema(b.close, fast), s: ind.ema(b.close, slow) }),
    signal: (i, c) => (Number.isFinite(c.s[i]) ? ls(short)(c.f[i] > c.s[i]) : null),
  }),
  donchian: (entry, exit, short = false) => ({
    name: `Donchian ${entry}/${exit} ${short ? "long/short" : "long-only"}`,
    init: (b) => ({ b, hi: ind.priorMax(b.close, entry), lo: ind.priorMin(b.close, entry), xlo: ind.priorMin(b.close, exit), xhi: ind.priorMax(b.close, exit) }),
    signal(i, c, side) {
      const px = c.b.close[i];
      if (!Number.isFinite(c.hi[i])) return null;
      if (side <= 0 && px > c.hi[i]) return 1;
      if (short && side >= 0 && px < c.lo[i]) return -1;
      if (side > 0 && px < c.xlo[i]) return 0;
      if (side < 0 && px > c.xhi[i]) return 0;
      return null;
    },
  }),
  supertrend: (period, mult, short = false) => ({
    name: `Supertrend(${period},${mult}) ${short ? "long/short" : "long-only"}`,
    init: (b) => ({ d: ind.supertrend(b.high, b.low, b.close, period, mult) }),
    signal: (i, c) => (c.d[i] ? ls(short)(c.d[i] > 0) : null),
  }),
  rsi2: (short = false) => ({
    name: `RSI(2) mean reversion ${short ? "long/short" : "long-only"}`,
    init: (b) => ({ b, r: ind.rsi(b.close, 2), m200: ind.sma(b.close, 200), m5: ind.sma(b.close, 5) }),
    signal(i, c, side) {
      const px = c.b.close[i];
      if (!Number.isFinite(c.m200[i])) return null;
      if (side === 0 && px > c.m200[i] && c.r[i] < 10) return 1;
      if (short && side === 0 && px < c.m200[i] && c.r[i] > 90) return -1;
      if (side > 0 && px > c.m5[i]) return 0;
      if (side < 0 && px < c.m5[i]) return 0;
      return null;
    },
  }),
  bbReversion: () => ({
    name: "Bollinger(20,2) dip-buy in uptrend",
    init: (b) => {
      const mid = ind.sma(b.close, 20); const sd = ind.stdev(b.close, 20);
      return { b, mid, lower: mid.map((m, i) => m - 2 * sd[i]), m200: ind.sma(b.close, 200) };
    },
    signal(i, c, side) {
      const px = c.b.close[i];
      if (!Number.isFinite(c.m200[i])) return null;
      if (side === 0 && px > c.m200[i] && px < c.lower[i]) return 1;
      if (side > 0 && px > c.mid[i]) return 0;
      return null;
    },
  }),
  combinedBinHCluc: () => ({
    name: "CombinedBinHAndCluc (freqtrade)",
    takeProfitPct: 0.05,
    stopPct: 0.05,
    init: (b) => {
      const typical = b.close.map((x, i) => (b.high[i] + b.low[i] + x) / 3);
      const tm = ind.sma(typical, 20); const tsd = ind.stdev(typical, 20);
      const m40 = ind.sma(b.close, 40); const sd40 = ind.stdev(b.close, 40);
      return { b, tm, tl: tm.map((m, i) => m - 2 * tsd[i]), m40, l40: m40.map((m, i) => m - 2 * sd40[i]), e50: ind.ema(b.close, 50), vma: ind.sma(b.volume, 30) };
    },
    signal(i, c, side) {
      const b = c.b; const px = b.close[i];
      if (side > 0) return px > c.tm[i] ? 0 : null;
      if (i < 1 || !Number.isFinite(c.l40[i - 1])) return null;
      const bbdelta = Math.abs(c.m40[i] - c.l40[i]);
      const binh = bbdelta > px * 0.008 && Math.abs(px - b.close[i - 1]) > px * 0.0175 &&
        Math.abs(px - b.low[i]) < bbdelta * 0.25 && px < c.l40[i - 1] && px <= b.close[i - 1];
      const cluc = px < c.e50[i] && px < 0.985 * c.tl[i] && b.volume[i] < c.vma[i - 1] * 20;
      return binh || cluc ? 1 : null;
    },
  }),
};

// ---------- runner ----------
const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

async function main() {
  const coins = ["BTC", "ETH", "SOL", "DOGE"];
  const frames = { "1d": 24 * HOUR_MS, "4h": 4 * HOUR_MS, "1h": HOUR_MS };
  const bars = {};
  for (const coin of coins) {
    const h = await loadHourly(coin);
    bars[coin] = {};
    for (const [tf, ms] of Object.entries(frames)) bars[coin][tf] = toArrays(ms === HOUR_MS ? h : rollup(h, ms));
  }

  const specs = [];
  for (const tf of ["1d", "4h", "1h"]) {
    specs.push(
      [tf, S.smaBand(tf === "1d" ? 100 : tf === "4h" ? 600 : 2400, 1, false)],
      [tf, S.smaBand(tf === "1d" ? 100 : tf === "4h" ? 600 : 2400, 1, true)],
      [tf, S.emaCross(20, 50, false)],
      [tf, S.emaCross(20, 50, true)],
      [tf, S.donchian(20, 10, true)],
      [tf, S.donchian(55, 20, true)],
      [tf, S.supertrend(10, 3, true)],
      [tf, S.rsi2(false)],
      [tf, S.bbReversion()],
    );
  }
  specs.push(["1h", S.combinedBinHCluc()], ["4h", S.combinedBinHCluc()]);

  // 1) Every strategy at 1x on each coin.
  const rows = [];
  for (const [tf, strat] of specs) {
    for (const coin of coins) {
      const b = bars[coin][tf];
      const full = runFutures({ bars: b, strategy: strat, leverage: 1, costs: COSTS, startMs: FULL });
      const recent = runFutures({ bars: b, strategy: strat, leverage: 1, costs: COSTS, startMs: RECENT });
      const early = runFutures({ bars: b, strategy: strat, leverage: 1, costs: COSTS, startMs: FULL, endMs: RECENT });
      rows.push({ tf, coin, name: strat.name, strat, full, recent, early });
    }
  }
  const hold = {};
  for (const coin of coins) {
    const h = { name: "Buy & hold (1x long)", init: () => ({}), signal: () => 1 };
    hold[coin] = runFutures({ bars: bars[coin]["1d"], strategy: h, leverage: 1, costs: COSTS, startMs: FULL });
  }

  // Robust = beats nothing-fancy: positive in both halves and Sharpe > hold.
  rows.sort((a, b) => b.full.sharpe - a.full.sharpe);
  const out = [
    "# Futures backtests — CoinDCX perpetuals (USDT pairs), Apr 2021 → Oct 2026",
    "",
    `Costs: taker fee ${COSTS.feePct}% per side (incl. GST), slippage ${COSTS.slippagePct}% per side, funding ${COSTS.fundingPct8h}% per 8h (longs pay, shorts receive), TDS ${COSTS.tdsPct}% on exits. Signals on bar close, fills next open, liquidation checked intrabar.`,
    "",
    "Buy & hold 1x: " + coins.map((c) => `${c} CAGR ${f(hold[c].cagrPct)}% / DD ${f(hold[c].maxDrawdownPct)}% / Sharpe ${f(hold[c].sharpe, 2)}`).join(" · "),
    "",
    "## All strategies at 1x leverage (sorted by Sharpe)",
    "",
    "| Candles | Coin | Strategy | CAGR % | Max DD % | Sharpe | Trades/yr | Win % | 2021–23 CAGR | 2024→ CAGR |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((r) => `| ${r.tf} | ${r.coin} | ${r.name} | ${f(r.full.cagrPct)} | ${f(r.full.maxDrawdownPct)} | ${f(r.full.sharpe, 2)} | ${f(r.full.tradesPerYear)} | ${f(r.full.winRatePct, 0)} | ${f(r.early.cagrPct)} | ${f(r.recent.cagrPct)} |`),
  ];

  // 2) Leverage ladder for the strategies that were robust at 1x.
  const robust = rows.filter((r) => r.full.sharpe > Math.max(0.8, hold[r.coin].sharpe) && r.early.cagrPct > 0 && r.recent.cagrPct > 0).slice(0, 10);
  out.push("", "## Leverage ladder for the robust ones (CAGR % / max DD % / liquidated?)", "",
    "| Candles | Coin | Strategy | 1x | 2x | 3x | 5x | 10x |", "|---|---|---|---|---|---|---|---|");
  for (const r of robust) {
    const cells = [1, 2, 3, 5, 10].map((L) => {
      const x = runFutures({ bars: bars[r.coin][r.tf], strategy: r.strat, leverage: L, costs: COSTS, startMs: FULL });
      return x.liquidated ? `💀 wiped ${x.ruinDate}` : `${f(x.cagrPct, 0)} / ${f(x.maxDrawdownPct, 0)}`;
    });
    out.push(`| ${r.tf} | ${r.coin} | ${r.name} | ${cells.join(" | ")} |`);
  }

  const md = out.join("\n") + "\n";
  const suffix = COSTS.tdsPct ? `-tds${COSTS.tdsPct}` : "";
  fs.writeFileSync(path.join(__dirname, `results-futures${suffix}.md`), md);
  console.log(md);
}

main().catch((e) => { console.error(e); process.exit(1); });
