"use strict";

// Downloads CoinDCX USDT-pair hourly candles (B-<COIN>_USDT, Binance-sourced),
// used as the price series for USDT-settled perpetual futures backtests.
// Cached in research/data/. Hourly candles can be rolled up to 4h / 1d.

const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(__dirname, "data");
const API = "https://public.coindcx.com/market_data/candles";
const HOUR_MS = 3_600_000;

async function fetchJson(url, attempts = 4) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (i === attempts) throw error;
      await new Promise((r) => setTimeout(r, 600 * i));
    }
  }
  return null;
}

async function loadHourly(coin, fromMs = Date.UTC(2021, 0, 1), { refresh = false, quote = "USDT", prefix = "B" } = {}) {
  const pair = `${prefix}-${coin}_${quote}`;
  const file = path.join(DATA_DIR, `${pair}_1h.json`);
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const byTime = new Map();
  let endTime = Date.now();
  for (let page = 0; page < 60; page += 1) {
    const batch = await fetchJson(`${API}?pair=${pair}&interval=1h&startTime=${fromMs}&endTime=${endTime}&limit=1000`);
    if (!Array.isArray(batch) || !batch.length) break;
    let oldest = Infinity;
    for (const c of batch) {
      const t = Math.floor(Number(c.time) / HOUR_MS) * HOUR_MS;
      const k = { time: t, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 0 };
      if (k.open > 0 && k.close > 0 && k.high >= k.low) byTime.set(t, k);
      oldest = Math.min(oldest, Number(c.time));
    }
    if (batch.length < 1000 || oldest <= fromMs) break;
    endTime = oldest - 1;
  }
  const current = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  const out = [...byTime.values()].filter((c) => c.time >= fromMs && c.time < current).sort((a, b) => a.time - b.time);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

// Roll hourly candles into fixed UTC buckets (e.g. 4h, 1d).
function rollup(candles, bucketMs) {
  const out = [];
  let cur = null;
  for (const c of candles) {
    const b = Math.floor(c.time / bucketMs) * bucketMs;
    if (!cur || cur.time !== b) {
      if (cur) out.push(cur);
      cur = { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

module.exports = { loadHourly, rollup, HOUR_MS };

if (require.main === module) {
  (async () => {
    for (const coin of process.argv.slice(2).length ? process.argv.slice(2) : ["BTC", "ETH", "SOL", "XRP", "DOGE"]) {
      const c = await loadHourly(coin, undefined, { refresh: true });
      console.log(coin, c.length, c.length ? new Date(c[0].time).toISOString() : "-", c.length ? new Date(c.at(-1).time).toISOString() : "-");
    }
  })();
}
