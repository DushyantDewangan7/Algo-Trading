"use strict";

// Downloads and caches CoinDCX daily INR candles for the research backtests.
// Cache lives in research/data/ (gitignored). Re-run with --refresh to update.

const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "data");
const API = "https://public.coindcx.com/market_data/candles";
const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2020, 0, 1);
const JUNK_CUTOFF_MS = Date.UTC(2021, 0, 1);

// Fixed universe chosen from coins that were already large in early 2021, so
// the rotation tests are not just picking today's winners. LUNA/FTT-style
// blowups are missing because CoinDCX no longer serves their candles — that
// survivorship bias flatters cross-sectional results and is noted in the report.
const UNIVERSE = [
  "BTC", "ETH", "BNB", "XRP", "ADA", "DOGE", "SOL", "DOT", "LTC", "LINK",
  "TRX", "BCH", "XLM", "AVAX", "MATIC", "UNI", "ETC", "ATOM", "SHIB",
];

async function fetchJson(url, attempts = 4) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (i === attempts) throw error;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
  return null;
}

async function downloadDaily(pair) {
  const byTime = new Map();
  let endTime = Date.now();
  for (let page = 0; page < 10; page += 1) {
    const url = `${API}?pair=${pair}&interval=1d&startTime=${START_MS}&endTime=${endTime}&limit=1000`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    let oldest = Infinity;
    for (const c of batch) {
      // Normalise to UTC midnight so all coins share the same day keys.
      const day = Math.floor(Number(c.time) / DAY_MS) * DAY_MS;
      const candle = {
        time: day,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume) || 0,
      };
      if ([candle.open, candle.high, candle.low, candle.close].every((v) => v > 0)) {
        byTime.set(day, candle);
      }
      oldest = Math.min(oldest, Number(c.time));
    }
    if (batch.length < 1000 || oldest <= START_MS) break;
    endTime = oldest - 1;
  }
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  // Drop today's still-forming candle.
  return [...byTime.values()].filter((c) => c.time < today).sort((a, b) => a.time - b.time);
}

// CoinDCX INR history has a few broken prints (e.g. ETH at ₹1.16 on
// 2020-12-20) and thin-book wicks (BTC low of ₹8.2L on 2021-03-08 while it
// traded near ₹38L). Replace one-day spike-and-revert closes with the previous
// close and cap wicks at 25% beyond the candle body.
function cleanCandles(candles) {
  const out = candles.map((c) => ({ ...c }));
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  for (let i = 1; i < out.length; i += 1) {
    const prev = out[i - 1].close;
    const next = out[i + 1] ? out[i + 1].close : out[i].close;
    const up = out[i].close / prev;
    const back = next / out[i].close;
    // Multi-day junk (only seen in the thin 2020 INR books, which are used
    // purely as indicator warm-up): a close 3x away from the 7-day median.
    // Not applied later because real pumps (DOGE Apr 2021) would trip it.
    const ref = median(out.slice(Math.max(0, i - 7), i).map((c) => c.close));
    const offMedian = out[i].time < JUNK_CUTOFF_MS && i >= 7 &&
      (out[i].close / ref > 3 || out[i].close / ref < 1 / 3);
    const spike = offMedian || (up > 2 && back < 0.6) || (up < 0.5 && back > 1.7);
    const brokenOpen = out[i].open / prev > 3 || out[i].open / prev < 0.33;
    if (spike) {
      out[i] = { ...out[i], open: prev, high: prev, low: prev, close: prev, repaired: true };
      continue;
    }
    if (brokenOpen) out[i].open = prev;
    const bodyHi = Math.max(out[i].open, out[i].close);
    const bodyLo = Math.min(out[i].open, out[i].close);
    out[i].high = Math.min(out[i].high, bodyHi * 1.25);
    out[i].low = Math.max(out[i].low, bodyLo * 0.75);
  }
  // Drop leading junk: start once ten consecutive days move less than 60%.
  let start = 0;
  for (let i = 1, calm = 0; i < out.length; i += 1) {
    calm = Math.abs(out[i].close / out[i - 1].close - 1) < 0.6 ? calm + 1 : 0;
    if (calm >= 10) { start = i - 10; break; }
  }
  return out.slice(start);
}

function cachePath(symbol) {
  return path.join(DATA_DIR, `${symbol}_INR_1d.json`);
}

async function loadDaily(symbol, { refresh = false } = {}) {
  const file = cachePath(symbol);
  if (!refresh && fs.existsSync(file)) return cleanCandles(JSON.parse(fs.readFileSync(file, "utf8")));
  const candles = await downloadDaily(`I-${symbol}_INR`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(candles));
  return cleanCandles(candles);
}

async function loadUniverse({ refresh = false, symbols = UNIVERSE } = {}) {
  const out = {};
  for (const symbol of symbols) {
    try {
      const candles = await loadDaily(symbol, { refresh });
      if (candles.length > 250) out[symbol] = candles;
    } catch (error) {
      console.error(`skip ${symbol}: ${error.message}`);
    }
  }
  return out;
}

module.exports = { loadDaily, loadUniverse, cleanCandles, UNIVERSE, DAY_MS };

if (require.main === module) {
  loadUniverse({ refresh: process.argv.includes("--refresh") }).then((data) => {
    for (const [symbol, candles] of Object.entries(data)) {
      console.log(
        symbol.padEnd(6),
        String(candles.length).padStart(5),
        new Date(candles[0].time).toISOString().slice(0, 10),
        new Date(candles.at(-1).time).toISOString().slice(0, 10),
      );
    }
  });
}
