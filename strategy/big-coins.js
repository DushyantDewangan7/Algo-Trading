"use strict";

const fs = require("node:fs");
const path = require("node:path");

const COINGECKO_MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets" +
  "?vs_currency=usd&order=market_cap_desc&per_page=15&page=1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_FILE = path.join(__dirname, "..", "big-coins-cache.json");
const STABLECOINS = new Set(["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD", "USDE"]);
const FALLBACK_BIG_COINS = Object.freeze([
  "BTC",
  "ETH",
  "XRP",
  "BNB",
  "SOL",
  "DOGE",
  "ADA",
  "TRX",
  "TON",
  "AVAX",
]);

let activeCache = {
  symbols: [...FALLBACK_BIG_COINS],
  fetchedAt: 0,
  source: "fallback",
  warning: null,
  cacheFile: CACHE_FILE,
};
let pendingFetch = null;

function normalizeSymbols(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => String(value || "").trim().toUpperCase())
    .filter((value) => value && !STABLECOINS.has(value)))]
    .slice(0, 10);
}

function baseSymbol(symbol) {
  let value = String(symbol || "").trim().toUpperCase();
  if (!value) return "";

  value = value.replace(/^[A-Z]-/, "");
  if (value.includes("/")) return value.split("/")[0];
  if (value.includes("_")) return value.split("_")[0];
  if (value.includes("-")) return value.split("-")[0];

  const quoteCurrencies = ["USDT", "USDC", "BUSD", "FDUSD", "TUSD", "INR", "BTC", "ETH"];
  const quote = quoteCurrencies.find((candidate) =>
    value.length > candidate.length && value.endsWith(candidate),
  );
  return quote ? value.slice(0, -quote.length) : value;
}

function validCachePayload(payload) {
  const symbols = normalizeSymbols(payload?.symbols);
  const fetchedAt = Number(payload?.fetchedAt);
  if (!symbols.length || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
  return {
    symbols,
    fetchedAt,
    source: String(payload.source || "disk-cache"),
    warning: payload.warning ? String(payload.warning) : null,
  };
}

async function readCacheFile(cacheFile) {
  try {
    return validCachePayload(JSON.parse(await fs.promises.readFile(cacheFile, "utf8")));
  } catch {
    return null;
  }
}

async function writeCacheFile(cacheFile, payload) {
  const directory = path.dirname(cacheFile);
  const temporary = `${cacheFile}.${process.pid}.tmp`;
  try {
    await fs.promises.mkdir(directory, { recursive: true });
    await fs.promises.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.promises.rename(temporary, cacheFile);
    return true;
  } catch {
    try {
      await fs.promises.unlink(temporary);
    } catch {
      // Best-effort cleanup only. A cache write must never stop the strategy.
    }
    return false;
  }
}

async function requestCoinGecko(fetcher) {
  if (typeof fetcher !== "function") throw new TypeError("fetch is unavailable");
  const response = await fetcher(COINGECKO_MARKETS_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "coindcx-session-momentum/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (Array.isArray(response)) return response;
  if (!response?.ok) throw new Error(`CoinGecko returned HTTP ${response?.status || "unknown"}`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("CoinGecko markets response was not an array");
  return payload;
}

async function fetchTopMarketCap({
  force = false,
  now = Date.now(),
  fetcher = globalThis.fetch,
  cacheFile = CACHE_FILE,
} = {}) {
  const timestamp = Number(now);
  if (!force && activeCache.cacheFile === cacheFile &&
      activeCache.fetchedAt > 0 && timestamp - activeCache.fetchedAt < CACHE_TTL_MS) {
    return [...activeCache.symbols];
  }

  const disk = await readCacheFile(cacheFile);
  if (!force && disk && timestamp - disk.fetchedAt < CACHE_TTL_MS) {
    activeCache = { ...disk, source: "disk-cache", cacheFile };
    return [...activeCache.symbols];
  }

  if (pendingFetch && activeCache.cacheFile === cacheFile) return pendingFetch;
  pendingFetch = (async () => {
    try {
      const rows = await requestCoinGecko(fetcher);
      const symbols = normalizeSymbols(rows.map((row) => row?.symbol));
      if (symbols.length < 10) {
        throw new Error(`CoinGecko returned only ${symbols.length} non-stable top coins`);
      }
      const payload = {
        symbols: symbols.slice(0, 10),
        fetchedAt: timestamp,
        source: "coingecko",
      };
      activeCache = { ...payload, warning: null, cacheFile };
      await writeCacheFile(cacheFile, payload);
      return [...activeCache.symbols];
    } catch (error) {
      if (disk?.symbols?.length) {
        activeCache = {
          ...disk,
          source: "stale-disk-cache",
          warning: error.message,
          cacheFile,
        };
      } else {
        activeCache = {
          symbols: [...FALLBACK_BIG_COINS],
          fetchedAt: timestamp,
          source: "fallback",
          warning: error.message,
          cacheFile,
        };
      }
      return [...activeCache.symbols];
    } finally {
      pendingFetch = null;
    }
  })();
  return pendingFetch;
}

function isBigCoin(symbol) {
  const base = baseSymbol(symbol);
  return Boolean(base) && activeCache.symbols.includes(base);
}

function getBigCoinsState() {
  return {
    ...activeCache,
    symbols: [...activeCache.symbols],
  };
}

function resetBigCoinsForTests() {
  activeCache = {
    symbols: [...FALLBACK_BIG_COINS],
    fetchedAt: 0,
    source: "fallback",
    warning: null,
    cacheFile: CACHE_FILE,
  };
  pendingFetch = null;
}

module.exports = {
  COINGECKO_MARKETS_URL,
  CACHE_TTL_MS,
  CACHE_FILE,
  STABLECOINS,
  FALLBACK_BIG_COINS,
  fetchTopMarketCap,
  isBigCoin,
  baseSymbol,
  getBigCoinsState,
  resetBigCoinsForTests,
};
