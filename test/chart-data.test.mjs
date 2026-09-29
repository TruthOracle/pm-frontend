/**
 * Unit tests for the chart helpers (frontend/lib/chartData.ts): timeframe windows, candle →
 * point conversion, multi-market alignment, deltas, palette and the shared formatters.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const chart = await import("../frontend/lib/chartData.ts");

const candle = (startTs, close, extra = {}) => ({
  startTs,
  endTs: startTs + 60,
  price: { open: String(close), high: String(close), low: String(close), close: String(close), mean: String(close), previous: null },
  volumeCC: "0",
  trades: 0,
  openInterest: "0",
  liquidityL: null,
  empty: false,
  ...extra,
});

describe("timeframeWindow", () => {
  const now = 1_800_000_000;
  it("maps the presets to Kalshi's periods and windows", () => {
    assert.deepEqual(chart.timeframeWindow("1H", now), { periodInterval: 1, startTs: now - 3600, endTs: now });
    assert.deepEqual(chart.timeframeWindow("6H", now), { periodInterval: 1, startTs: now - 6 * 3600, endTs: now });
    assert.deepEqual(chart.timeframeWindow("1D", now), { periodInterval: 1, startTs: now - 86_400, endTs: now });
    assert.deepEqual(chart.timeframeWindow("1W", now), { periodInterval: 60, startTs: now - 7 * 86_400, endTs: now });
    assert.deepEqual(chart.timeframeWindow("1M", now), { periodInterval: 60, startTs: now - 30 * 86_400, endTs: now });
  });
  it("never starts before the market was created, and ALL spans from creation (at most a year)", () => {
    const created = now - 2 * 86_400;
    assert.equal(chart.timeframeWindow("1M", now, created).startTs, created);
    assert.equal(chart.timeframeWindow("ALL", now, created).startTs, created);
    assert.deepEqual(chart.timeframeWindow("ALL", now, now - 900 * 86_400), { periodInterval: 1440, startTs: now - 365 * 86_400, endTs: now });
    assert.equal(chart.timeframeWindow("ALL", now, null).startTs, now - 365 * 86_400);
  });
});

describe("points and alignment", () => {
  it("plots the close at the start of each period, in milliseconds, clamped to [0, 1]", () => {
    const points = chart.candlesToPoints([candle(100, 0.42), candle(160, 1.7), candle(220, -0.2)]);
    assert.deepEqual(points, [
      { t: 100_000, price: 0.42 },
      { t: 160_000, price: 1 },
      { t: 220_000, price: 0 },
    ]);
  });
  it("merges markets by timestamp so a missing bucket never shifts another line", () => {
    const rows = chart.alignSeries([
      { ticker: "A", candlesticks: [candle(100, 0.5), candle(160, 0.6), candle(220, 0.7)] },
      { ticker: "B", candlesticks: [candle(100, 0.2), candle(220, 0.3)] },
    ]);
    assert.deepEqual(rows, [
      { t: 100_000, A: 0.5, B: 0.2 },
      { t: 160_000, A: 0.6 },
      { t: 220_000, A: 0.7, B: 0.3 },
    ]);
  });
  it("ranks markets for the chart by volume, then price", () => {
    const ranked = chart.rankMarketsForChart([
      { ticker: "LOW", totalVolumeCC: "10", currentPrice: "0.9" },
      { ticker: "HIGH", totalVolumeCC: "50", currentPrice: "0.1" },
      { ticker: "TIE", totalVolumeCC: "10", currentPrice: "0.95" },
    ]);
    assert.deepEqual(ranked.map((m) => m.ticker), ["HIGH", "TIE", "LOW"]);
  });
  it("hands out colours in a fixed order and wraps around", () => {
    assert.equal(chart.seriesColor(0), chart.SERIES_PALETTE[0]);
    assert.equal(chart.seriesColor(chart.SERIES_PALETTE.length + 1), chart.SERIES_PALETTE[1]);
  });
});

describe("deltas and formatting", () => {
  it("prints signed percentage-point deltas and knows a flat window", () => {
    assert.deepEqual(chart.priceDelta(0.62, 0.58), { points: 4, text: "+4.0", direction: "up" });
    assert.deepEqual(chart.priceDelta(0.5, 0.51), { points: -1, text: "−1.0", direction: "down" });
    assert.deepEqual(chart.priceDelta(0.5, 0.5), { points: 0, text: "0.0", direction: "flat" });
    assert.equal(chart.priceDelta(0.5, null), null);
    assert.deepEqual(chart.windowDelta([{ t: 1, price: 0.3 }, { t: 2, price: 0.35 }]), { points: 5, text: "+5.0", direction: "up" });
    assert.equal(chart.windowDelta([]), null);
  });
  it("classifies a sparkline", () => {
    assert.equal(chart.sparklineTrend(["0.4", "0.5"]), "up");
    assert.equal(chart.sparklineTrend([0.5, 0.4]), "down");
    assert.equal(chart.sparklineTrend([0.5]), "flat");
    assert.equal(chart.sparklineTrend(["0.5000", "0.5000"]), "flat");
  });
  it("formats percentages, cents and compact volumes", () => {
    assert.equal(chart.formatPercent(0.6249), "62%");
    assert.equal(chart.formatPercent(0.6249, 1), "62.5%");
    assert.equal(chart.formatCents(0.6249), "62¢");
    assert.equal(chart.compactCC("812.4"), "812 CC");
    assert.equal(chart.compactCC(1234), "1.2k CC");
    assert.equal(chart.compactCC(12_345), "12k CC");
    assert.equal(chart.compactCC(3_400_000), "3.4M CC");
    assert.equal(chart.compactCC(7.25, ""), "7.25");
    assert.equal(chart.compactCC(42.5), "42.5 CC");
  });
  it("formats relative times and time left", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    assert.equal(chart.relativeTime("2026-09-29T11:59:50Z", now), "just now");
    assert.equal(chart.relativeTime("2026-09-29T11:57:00Z", now), "3m ago");
    assert.equal(chart.relativeTime("2026-09-29T09:00:00Z", now), "3h ago");
    assert.equal(chart.relativeTime("2026-09-28T09:00:00Z", now), "Yesterday");
    assert.equal(chart.relativeTime("2026-09-25T09:00:00Z", now), "4d ago");
    assert.equal(chart.timeLeft("2026-10-02T16:30:00Z", now), "3d 4h");
    assert.equal(chart.timeLeft("2026-09-29T12:52:00Z", now), "52m");
    assert.equal(chart.timeLeft("2026-09-29T11:00:00Z", now), "Closed");
    assert.equal(chart.timeLeft(null, now), "—");
  });
  it("masks a party id for a public feed and leaves masked ones alone", () => {
    assert.equal(chart.maskParty("6ff9435fff4d4f43856f688e95a27368::12204e98dc339cc86c6d318f3746f99e880245b4a5827ef1e8bbe7ba6193ef8c0e58"), "6ff9435f…0e58");
    assert.equal(chart.maskParty("abcd…1234"), "abcd…1234");
    assert.equal(chart.maskParty("short"), "short");
  });
});
