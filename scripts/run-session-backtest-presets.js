"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BASE_URL = String(process.env.DASHBOARD_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const OUTPUT_DIR = path.join(__dirname, "..", "backtest-results");

function indiaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysBefore(dateText, days) {
  const time = Date.parse(`${dateText}T00:00:00Z`) - days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

async function collectSse(controller, lines) {
  const response = await fetch(`${BASE_URL}/api/backtest/stream?tail=0`, {
    headers: { Accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) throw new Error(`SSE stream returned HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!block || block.startsWith(":")) continue;
        let event = "message";
        const data = [];
        for (const row of block.split("\n")) {
          if (row.startsWith("event:")) event = row.slice(6).trim();
          if (row.startsWith("data:")) data.push(row.slice(5).trimStart());
        }
        const text = data.join("\n");
        if (event === "done") return text ? JSON.parse(text) : { running: false };
        if (!text) continue;
        try {
          const payload = JSON.parse(text);
          if (payload.line) {
            lines.push(payload.line);
            console.log(`[SSE] ${payload.line}`);
          }
        } catch {
          lines.push(text);
          console.log(`[SSE] ${text}`);
        }
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  }
  return { running: false };
}

async function runPreset(preset) {
  const lines = [];
  const controller = new AbortController();
  const stream = collectSse(controller, lines);
  await new Promise((resolve) => setTimeout(resolve, 100));
  let result;
  try {
    const response = await fetch(`${BASE_URL}/api/session-momentum/backtest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategy: "sessionMomentum",
        equity: 100_000,
        sessionMinutes: 60,
        trailPct: 6,
        leverage: 5,
        maxPositions: 2,
        smallCoinMaxHoldHours: 24,
        interval: preset.interval,
        from: preset.from,
        to: preset.to,
      }),
    });
    result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || `HTTP ${response.status}`);
    await stream;
  } finally {
    controller.abort();
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${preset.slug}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(OUTPUT_DIR, `${preset.slug}.sse.log`), `${lines.join("\n")}\n`);
  return { preset, result, lines };
}

async function main() {
  const today = indiaDate();
  const presets = [
    {
      slug: "session-momentum-ytd-2026-1h",
      label: "YTD 2026 @ 1h",
      from: "2026-01-01",
      to: today,
      interval: "1h",
    },
    {
      slug: "session-momentum-last-7-days-15m",
      label: "Last 7 days @ 15m",
      from: daysBefore(today, 7),
      to: today,
      interval: "15m",
    },
  ];

  for (const preset of presets) {
    console.log(`\n=== ${preset.label}: ${preset.from} to ${preset.to} ===`);
    const run = await runPreset(preset);
    const summary = run.result.summary;
    console.log(JSON.stringify({
      label: preset.label,
      netReturnPct: summary.netReturnPct,
      grossReturnPct: summary.grossReturnPct,
      maxDrawdownPct: summary.maxDrawdownPct,
      sessionsRun: summary.sessionsRun,
      positionsOpened: summary.positionsOpened,
      winRatePct: summary.winRatePct,
      avgRMultiple: summary.avgRMultiple,
      liquidations: summary.liquidations,
      totalFeesInr: summary.totalFeesInr,
      totalTdsInr: summary.totalTdsInr,
      captureRatio: summary.captureRatio,
      btcBuyAndHold: run.result.btcBuyAndHold?.summary || null,
    }, null, 2));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Preset runner failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { collectSse, daysBefore, indiaDate, runPreset };
