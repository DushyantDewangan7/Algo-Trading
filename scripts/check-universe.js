"use strict";

const {
  fetchTickerSnapshot,
  normalizeInrTicker,
  fetchQualifiedGainers,
} = require("../strategy/top-gainers");

async function main() {
  const minVolumeINR = Number(process.env.TOP_GAINERS_MIN_VOLUME_INR) || 1_000_000;
  const snapshot = await fetchTickerSnapshot({ force: true });
  const inr = snapshot.rows.map(normalizeInrTicker).filter(Boolean);
  const top30 = [...inr].sort((a, b) => b.change24h - a.change24h).slice(0, 30);
  const qualified = await fetchQualifiedGainers({
    minVolumeINR,
    maxPositions: 15,
    tickerRows: snapshot.rows,
  });
  const liquidTop30 = top30.filter((row) => row.volumeINR >= minVolumeINR).length;
  const volumes = top30.map((row) => row.volumeINR).sort((a, b) => a - b);
  const median = volumes.length
    ? volumes.length % 2
      ? volumes[Math.floor(volumes.length / 2)]
      : (volumes[volumes.length / 2 - 1] + volumes[volumes.length / 2]) / 2
    : 0;

  console.log(`Total INR pairs: ${inr.length}`);
  console.log(`Volume floor: ₹${minVolumeINR.toLocaleString("en-IN")}`);
  console.log(`All INR pairs above floor: ${qualified.metadata.aboveVolumeFloor}`);
  console.log(`Top-30 gainers above floor: ${liquidTop30}/30`);
  console.log(`Top-30 median 24h volume: ₹${Math.round(median).toLocaleString("en-IN")}`);
  console.log(`Qualified strategy list returned: ${qualified.metadata.returned}/15`);
  console.log("");
  console.log("Rank Market              Change       24h volume");
  console.log("---- ------------------- -------- ----------------");
  for (const row of qualified.rows) {
    console.log(
      `${String(row.rank).padStart(4)} ${row.market.padEnd(19)} ${`${row.change24h.toFixed(2)}%`.padStart(8)} ${`₹${Math.round(row.volumeINR).toLocaleString("en-IN")}`.padStart(16)}`,
    );
  }
}

main().catch((error) => {
  console.error(`Universe check failed: ${error.message}`);
  process.exit(1);
});
