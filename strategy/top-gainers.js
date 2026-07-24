"use strict";

const COINDCX_TICKER_URL = "https://api.coindcx.com/exchange/ticker";
const TICKER_CACHE_MS = 30_000;

let tickerCache = { rows: null, fetchedAt: 0 };
let pendingTickerRequest = null;

async function fetchJsonWithBackoff(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "coindcx-top-gainers-paper/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`CoinDCX returned HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("CoinDCX ticker response was not an array");
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function fetchTickerSnapshot({ force = false, fetcher = fetchJsonWithBackoff } = {}) {
  const now = Date.now();
  if (!force && tickerCache.rows && now - tickerCache.fetchedAt < TICKER_CACHE_MS) {
    return { rows: tickerCache.rows, fetchedAt: tickerCache.fetchedAt, stale: false, cached: true };
  }
  if (!pendingTickerRequest) {
    pendingTickerRequest = fetcher(COINDCX_TICKER_URL)
      .then((rows) => {
        tickerCache = { rows, fetchedAt: Date.now() };
        return rows;
      })
      .finally(() => {
        pendingTickerRequest = null;
      });
  }
  try {
    const rows = await pendingTickerRequest;
    return { rows, fetchedAt: tickerCache.fetchedAt, stale: false, cached: false };
  } catch (error) {
    if (tickerCache.rows) {
      return {
        rows: tickerCache.rows,
        fetchedAt: tickerCache.fetchedAt,
        stale: true,
        cached: true,
        warning: error.message,
      };
    }
    throw error;
  }
}

function normalizeInrTicker(ticker) {
  const market = String(ticker?.market || "").trim().toUpperCase();
  if (!market.endsWith("INR")) return null;
  const lastPrice = Number(ticker.last_price);
  const change24h = Number(ticker.change_24_hour);
  const baseVolume = Number(ticker.volume);
  if (!(lastPrice > 0) || !Number.isFinite(change24h) || !(baseVolume >= 0)) return null;
  return {
    market,
    lastPrice,
    change24h,
    volumeINR: lastPrice * baseVolume,
  };
}

async function fetchQualifiedGainers({
  minVolumeINR = 1_000_000,
  maxPositions = 15,
  tickerRows = null,
  force = false,
} = {}) {
  const floor = Math.max(0, Number(minVolumeINR) || 0);
  const limit = Math.max(1, Math.floor(Number(maxPositions) || 15));
  const snapshot = tickerRows
    ? { rows: tickerRows, fetchedAt: Date.now(), stale: false, cached: false }
    : await fetchTickerSnapshot({ force });
  const inrRows = snapshot.rows.map(normalizeInrTicker).filter(Boolean);
  const liquid = inrRows
    .filter((row) => row.volumeINR >= floor)
    .sort((a, b) => b.change24h - a.change24h || b.volumeINR - a.volumeINR);
  const rows = liquid.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    rows,
    metadata: {
      totalINRPairs: inrRows.length,
      aboveVolumeFloor: liquid.length,
      returned: rows.length,
      minVolumeINR: floor,
      fetchedAt: snapshot.fetchedAt,
      stale: Boolean(snapshot.stale),
      warning: snapshot.warning || null,
    },
  };
}

function clearTickerCache() {
  tickerCache = { rows: null, fetchedAt: 0 };
}

module.exports = {
  COINDCX_TICKER_URL,
  TICKER_CACHE_MS,
  fetchJsonWithBackoff,
  fetchTickerSnapshot,
  fetchQualifiedGainers,
  normalizeInrTicker,
  clearTickerCache,
};
