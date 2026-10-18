"use strict";

// Inside-CoinDCX "exchange arbitrage" check: how far does the INR market price
// of a coin drift from (USDT market price × USDT/INR price)? A trade needs
// three legs (e.g. sell COIN/INR, buy USDT/INR, buy COIN/USDT), each paying a
// fee, plus TDS on the crypto sells — so the gap must beat roughly 3%.

const { loadHourly } = require("./usdt-data");

const FROM = Date.UTC(2025, 9, 1);
// 3 legs × 0.59% fee + ~0.2% slippage per leg + 1% TDS on each of ~2 crypto sells.
const COST_PCT = 3 * 0.59 + 3 * 0.2 + 2 * 1;

async function main() {
  const usdtInr = await loadHourly("USDT", FROM, { quote: "INR", prefix: "I" });
  const fx = new Map(usdtInr.map((c) => [c.time, c.close]));
  console.log(`Gap = INR price / (USDT price × USDT/INR) − 1, hourly closes since ${new Date(FROM).toISOString().slice(0, 10)}`);
  console.log(`Round-trip cost to capture a gap ≈ ${COST_PCT.toFixed(1)}%\n`);
  console.log("coin   hours   median|gap|%   p95|gap|%   max|gap|%   hours with |gap| > cost");
  for (const coin of ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB"]) {
    const inr = await loadHourly(coin, FROM, { quote: "INR", prefix: "I" });
    const usdt = new Map((await loadHourly(coin, FROM)).map((c) => [c.time, c.close]));
    const gaps = [];
    for (const c of inr) {
      const u = usdt.get(c.time);
      const r = fx.get(c.time);
      if (u && r) gaps.push(Math.abs(c.close / (u * r) - 1) * 100);
    }
    gaps.sort((a, b) => a - b);
    const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
    const over = gaps.filter((g) => g > COST_PCT).length;
    console.log(coin.padEnd(6), String(gaps.length).padStart(6), q(0.5).toFixed(2).padStart(14), q(0.95).toFixed(2).padStart(11), q(1).toFixed(2).padStart(11), String(over).padStart(12));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
