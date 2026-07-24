"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const COINDCX_API = "https://api.coindcx.com";
const FUTURES_CREATE_ORDER_ENDPOINT = "/exchange/v1/derivatives/futures/orders/create";
const FUTURES_LIST_ORDERS_ENDPOINT = "/exchange/v1/derivatives/futures/orders";
const FUTURES_LIST_POSITIONS_ENDPOINT = "/exchange/v1/derivatives/futures/positions";
const FUTURES_EXIT_POSITION_ENDPOINT = "/exchange/v1/derivatives/futures/positions/exit";
const FUTURES_UPDATE_LEVERAGE_ENDPOINT =
  "/exchange/v1/derivatives/futures/positions/update_leverage";
const FUTURES_CANCEL_ORDER_ENDPOINT = "/exchange/v1/derivatives/futures/orders/cancel";
const FUTURES_CANCEL_ALL_ENDPOINT =
  "/exchange/v1/derivatives/futures/positions/cancel_all_open_orders";
const FUTURES_WALLETS_ENDPOINT = "/exchange/v1/derivatives/futures/wallets";
const FUTURES_WALLET_TRANSFER_ENDPOINT =
  "/exchange/v1/derivatives/futures/wallets/transfer";
const WALLET_TRANSFER_ENDPOINT = FUTURES_WALLET_TRANSFER_ENDPOINT;
const SPOT_CREATE_ORDER_ENDPOINT = "/exchange/v1/orders/create";
const SPOT_ORDER_STATUS_ENDPOINT = "/exchange/v1/orders/status";
const LIVE_LOG_FILE = path.join(__dirname, "..", "live-trading.log");
const MAX_LIVE_LOG_BYTES = 20 * 1024 * 1024;

const SETTLED_ORDER_STATUSES = new Set([
  "filled",
  "cancelled",
  "canceled",
  "partially_cancelled",
  "partially_canceled",
  "rejected",
]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/secret|signature|api.?key|authorization/i.test(key)) return [key, "[REDACTED]"];
    return [key, redact(item)];
  }));
}

function auditLog(logFile, event, details = {}) {
  const timestamp = new Date().toISOString();
  try {
    const entry = { timestamp, event, ...redact(details) };
    try {
      if (fs.statSync(logFile).size >= MAX_LIVE_LOG_BYTES) {
        const rotated = `${logFile}.1`;
        try {
          fs.rmSync(rotated, { force: true });
          fs.renameSync(logFile, rotated);
        } catch {
          // Logging is evidence, but it must never prevent an emergency exit.
        }
      }
    } catch {
      // A missing log file is normal on the first event.
    }
    fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  } catch (error) {
    // Disk, serialization, or permission failures must not block an order
    // cancel or emergency position exit.
    return { timestamp, event, logFailed: true, error: String(error?.message || error) };
  }
}

function requestJson(url, {
  method = "GET",
  headers = {},
  body = null,
  timeoutMs = 12_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }
        }
        resolve({ status: response.statusCode || 0, headers: response.headers, data, raw });
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`CoinDCX request timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    if (body !== null) request.write(body);
    request.end();
  });
}

function responseError(endpoint, response) {
  const message = response?.data?.message || response?.data?.error ||
    `CoinDCX ${endpoint} returned HTTP ${response?.status || "unknown"}`;
  const error = new Error(String(message));
  error.code = response?.status === 401 || response?.status === 403
    ? "AUTH_FAILED"
    : "COINDCX_API_ERROR";
  error.status = response?.status || 502;
  error.response = response?.data ?? null;
  return error;
}

function firstOrder(payload) {
  if (Array.isArray(payload)) return payload[0] || null;
  if (Array.isArray(payload?.data)) return payload.data[0] || null;
  return payload?.order || payload?.data || payload || null;
}

function normalizedStatus(order) {
  return String(order?.status || "").trim().toLowerCase();
}

function roundDownToIncrement(value, increment) {
  const numeric = Number(value);
  const step = Number(increment);
  if (!(numeric > 0)) return 0;
  if (!(step > 0)) return numeric;
  const decimals = Math.min(12, Math.max(0, (String(step).split(".")[1] || "").length));
  return Number((Math.floor((numeric + Number.EPSILON) / step) * step).toFixed(decimals));
}

function baseAssetFromSymbol(symbol) {
  let value = String(symbol || "").trim().toUpperCase();
  value = value.replace(/^[A-Z]+-/, "");
  value = value.split("_")[0];
  for (const quote of ["USDT", "USDC", "INR", "BTC", "ETH"]) {
    if (value.endsWith(quote) && value.length > quote.length) {
      return value.slice(0, -quote.length);
    }
  }
  return value;
}

function futuresPairForSymbol(symbol, activeInstruments = []) {
  const asset = baseAssetFromSymbol(symbol);
  return activeInstruments.find((pair) =>
    String(pair).toUpperCase().startsWith(`B-${asset}_`),
  ) || null;
}

class CoinDcxLiveClient {
  constructor({
    apiKey = process.env.COINDCX_API_KEY,
    secret = process.env.COINDCX_SECRET,
    baseUrl = COINDCX_API,
    logFile = LIVE_LOG_FILE,
    transport = requestJson,
    timeoutMs = 12_000,
  } = {}) {
    this.apiKey = String(apiKey || "").trim();
    this.secret = String(secret || "").trim();
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.logFile = logFile;
    this.transport = transport;
    this.timeoutMs = timeoutMs;
  }

  hasCredentials() {
    return Boolean(this.apiKey && this.secret);
  }

  assertCredentials() {
    if (this.hasCredentials()) return;
    const error = new Error("CoinDCX API key and secret are not configured.");
    error.code = "MISSING_CREDENTIALS";
    throw error;
  }

  log(event, details) {
    return auditLog(this.logFile, event, details);
  }

  async publicGet(endpoint, { attempts = 3 } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const url = `${this.baseUrl}${endpoint}`;
      try {
        this.log("API_REQUEST", { request: { method: "GET", url, headers: { Accept: "application/json" } } });
        const response = await this.transport(url, {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": "session-momentum/1.0" },
          timeoutMs: this.timeoutMs,
        });
        this.log("API_RESPONSE", { request: { method: "GET", url }, response });
        if (response.status < 200 || response.status >= 300) throw responseError(endpoint, response);
        return response.data;
      } catch (error) {
        lastError = error;
        this.log("API_ERROR", { request: { method: "GET", url }, error: { message: error.message, code: error.code } });
        if (attempt < attempts - 1) await sleep(400 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  async signedRequest(endpoint, body = {}, {
    method = "POST",
    safeToRetry = true,
    attempts = safeToRetry ? 3 : 1,
  } = {}) {
    this.assertCredentials();
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const requestBody = { ...body, timestamp: Date.now() };
      const payload = JSON.stringify(requestBody);
      const signature = crypto.createHmac("sha256", this.secret).update(payload).digest("hex");
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "session-momentum/1.0",
        "Content-Length": Buffer.byteLength(payload),
        "X-AUTH-APIKEY": this.apiKey,
        "X-AUTH-SIGNATURE": signature,
      };
      const url = `${this.baseUrl}${endpoint}`;
      const requestRecord = { method, url, headers: redact(headers), body: requestBody };
      try {
        this.log("API_REQUEST", { request: requestRecord });
        const response = await this.transport(url, {
          method,
          headers,
          body: payload,
          timeoutMs: this.timeoutMs,
        });
        this.log("API_RESPONSE", { request: requestRecord, response });
        if (response.status < 200 || response.status >= 300) throw responseError(endpoint, response);
        return response.data;
      } catch (error) {
        lastError = error;
        this.log("API_ERROR", {
          request: requestRecord,
          error: { message: error.message, code: error.code, response: error.response },
        });
        if (attempt < attempts - 1) await sleep(500 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  balances() {
    return this.signedRequest("/exchange/v1/users/balances", {}, { method: "POST" });
  }

  futuresWallets() {
    return this.signedRequest(FUTURES_WALLETS_ENDPOINT, {}, { method: "GET" });
  }

  transferToFutures(amount, currency = "INR") {
    return this.signedRequest(FUTURES_WALLET_TRANSFER_ENDPOINT, {
      transfer_type: "deposit",
      currency_short_name: currency,
      amount: Number(amount),
    }, { method: "POST", safeToRetry: false });
  }

  transferFromFutures(amount, currency = "INR") {
    return this.signedRequest(FUTURES_WALLET_TRANSFER_ENDPOINT, {
      transfer_type: "withdraw",
      currency_short_name: currency,
      amount: Number(amount),
    }, { method: "POST", safeToRetry: false });
  }

  activeInstruments(marginCurrency = "INR") {
    return this.publicGet(
      `/exchange/v1/derivatives/futures/data/active_instruments?margin_currency_short_name[]=${encodeURIComponent(marginCurrency)}`,
    );
  }

  instrument(pair, marginCurrency = "INR") {
    return this.publicGet(
      `/exchange/v1/derivatives/futures/data/instrument?pair=${encodeURIComponent(pair)}` +
      `&margin_currency_short_name=${encodeURIComponent(marginCurrency)}`,
    );
  }

  createSpotMarketSell({ market, quantity, clientOrderId }) {
    return this.signedRequest(SPOT_CREATE_ORDER_ENDPOINT, {
      side: "sell",
      order_type: "market_order",
      market,
      total_quantity: Number(quantity),
      client_order_id: clientOrderId,
    }, { method: "POST", safeToRetry: false });
  }

  spotOrderStatus({ id, clientOrderId }) {
    const body = id ? { id } : { client_order_id: clientOrderId };
    return this.signedRequest(SPOT_ORDER_STATUS_ENDPOINT, body, { method: "POST" });
  }

  async waitForSpotFill({ id, clientOrderId }, {
    timeoutMs = 45_000,
    pollMs = 800,
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const payload = await this.spotOrderStatus({ id, clientOrderId });
      const order = firstOrder(payload);
      const status = normalizedStatus(order);
      this.log("ORDER_FILL_CHECK", { orderType: "spot", id: id || order?.id, status, response: payload });
      if (status === "filled") return order;
      if (SETTLED_ORDER_STATUSES.has(status)) {
        throw Object.assign(new Error(`Spot sell ${id || clientOrderId} ended with status ${status}`), {
          code: "SPOT_FILL_FAILED",
          order,
        });
      }
      await sleep(pollMs);
    }
    const error = new Error(`Timed out waiting for spot sell ${id || clientOrderId} to fill`);
    error.code = "SPOT_FILL_TIMEOUT";
    throw error;
  }

  createFuturesMarketOrder({ pair, side = "buy", quantity, leverage }) {
    return this.signedRequest(FUTURES_CREATE_ORDER_ENDPOINT, {
      order: {
        side,
        pair,
        order_type: "market_order",
        total_quantity: Number(quantity),
        leverage: Number(leverage),
        notification: "no_notification",
        margin_currency_short_name: "INR",
        position_margin_type: "isolated",
      },
    }, { method: "POST", safeToRetry: false });
  }

  updateFuturesLeverage({ pair, leverage }) {
    return this.signedRequest(FUTURES_UPDATE_LEVERAGE_ENDPOINT, {
      leverage: String(leverage),
      pair: String(pair),
      margin_currency_short_name: "INR",
    }, { method: "POST", safeToRetry: false });
  }

  listFuturesOrders({
    status = "open,filled,partially_filled,partially_cancelled,cancelled,rejected",
    side = "buy",
    page = "1",
    size = "100",
  } = {}) {
    return this.signedRequest(FUTURES_LIST_ORDERS_ENDPOINT, {
      status,
      side,
      page,
      size,
      margin_currency_short_name: ["INR"],
    }, { method: "POST" });
  }

  async waitForFuturesFill(orderId, side = "buy", {
    timeoutMs = 45_000,
    pollMs = 800,
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const payload = await this.listFuturesOrders({ side });
      const orders = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data) ? payload.data
          : Array.isArray(payload?.orders) ? payload.orders : [];
      const order = orders.find((item) => String(item.id) === String(orderId));
      if (order) {
        const status = normalizedStatus(order);
        this.log("ORDER_FILL_CHECK", { orderType: "futures", id: orderId, status, response: order });
        if (status === "filled") return order;
        if (SETTLED_ORDER_STATUSES.has(status)) {
          throw Object.assign(new Error(`Futures order ${orderId} ended with status ${status}`), {
            code: "FUTURES_FILL_FAILED",
            order,
          });
        }
      }
      await sleep(pollMs);
    }
    const error = new Error(
      `Futures order ${orderId} could not be reconciled after an ambiguous create/fill response; no retry was sent`,
    );
    error.code = "FUTURES_FILL_TIMEOUT";
    throw error;
  }

  listFuturesPositions({ pairs = null, positionIds = null } = {}) {
    const body = {
      page: "1",
      size: "100",
      margin_currency_short_name: ["INR"],
    };
    if (pairs?.length) body.pairs = Array.isArray(pairs) ? pairs.join(",") : String(pairs);
    if (positionIds?.length) {
      body.position_ids = Array.isArray(positionIds)
        ? positionIds.join(",")
        : String(positionIds);
    }
    return this.signedRequest(FUTURES_LIST_POSITIONS_ENDPOINT, body, { method: "POST" });
  }

  exitFuturesPosition(id) {
    return this.signedRequest(FUTURES_EXIT_POSITION_ENDPOINT, { id }, {
      method: "POST",
      safeToRetry: false,
    });
  }

  cancelFuturesOrder(id) {
    return this.signedRequest(FUTURES_CANCEL_ORDER_ENDPOINT, { id }, {
      method: "POST",
      safeToRetry: false,
    });
  }

  cancelAllFuturesOrders() {
    return this.signedRequest(FUTURES_CANCEL_ALL_ENDPOINT, {
      margin_currency_short_name: ["INR"],
    }, { method: "POST", safeToRetry: false });
  }

  async waitForPositionClosed(id, { timeoutMs = 45_000, pollMs = 800 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Match locally against a full page as well as sending no optional
      // filter; this remains correct if a deployment ignores position_ids.
      const payload = await this.listFuturesPositions();
      const positions = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data) ? payload.data
          : Array.isArray(payload?.positions) ? payload.positions : [];
      const position = positions.find((item) => String(item.id) === String(id));
      if (!position || Math.abs(Number(position.active_pos) || 0) <= 1e-12) {
        this.log("POSITION_CLOSED", { id, response: position || null });
        return position || null;
      }
      await sleep(pollMs);
    }
    const error = new Error(`Timed out waiting for Futures position ${id} to close`);
    error.code = "FUTURES_EXIT_TIMEOUT";
    throw error;
  }
}

module.exports = {
  COINDCX_API,
  FUTURES_CREATE_ORDER_ENDPOINT,
  FUTURES_LIST_ORDERS_ENDPOINT,
  FUTURES_LIST_POSITIONS_ENDPOINT,
  FUTURES_EXIT_POSITION_ENDPOINT,
  FUTURES_UPDATE_LEVERAGE_ENDPOINT,
  FUTURES_CANCEL_ORDER_ENDPOINT,
  FUTURES_CANCEL_ALL_ENDPOINT,
  FUTURES_WALLETS_ENDPOINT,
  FUTURES_WALLET_TRANSFER_ENDPOINT,
  WALLET_TRANSFER_ENDPOINT,
  SPOT_CREATE_ORDER_ENDPOINT,
  SPOT_ORDER_STATUS_ENDPOINT,
  LIVE_LOG_FILE,
  CoinDcxLiveClient,
  auditLog,
  baseAssetFromSymbol,
  firstOrder,
  futuresPairForSymbol,
  requestJson,
  roundDownToIncrement,
};
