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
    // Small figures read naturally: no "0.00 CC" on an untraded card.
    assert.equal(chart.compactCC(0), "0 CC");
    assert.equal(chart.compactCC("0.0000000000"), "0 CC");
    assert.equal(chart.compactCC(0.5), "0.5 CC");
    assert.equal(chart.compactCC(12.345), "12.3 CC");
    assert.equal(chart.compactCC(940), "940 CC");
    assert.equal(chart.compactCC(1000), "1k CC");
    assert.equal(chart.compactCC(-0.001), "0 CC");
  });
  it("formats relative times and time left", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    assert.equal(chart.relativeTime("2026-09-29T11:59:50Z", now), "just now");
    assert.equal(chart.relativeTime("2026-09-29T11:57:00Z", now), "3m ago");
    assert.equal(chart.relativeTime("2026-09-29T09:00:00Z", now), "3h ago");
    assert.equal(chart.relativeTime("2026-09-28T09:00:00Z", now), "Yesterday");
    assert.equal(chart.relativeTime("2026-09-25T09:00:00Z", now), "4d ago");
    // Older than a week: the UTC date (Sep 1 23:30 UTC is already Sep 2 in Asia).
    assert.equal(chart.relativeTime("2026-09-01T23:30:00Z", now), "Sep 1");
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

describe("axis scaling (Polymarket-style)", () => {
  it("floorAtZero: ticks are one nice step from 0 %, at most five, domain a little past the max", () => {
    const s = chart.niceYScale([0.1, 0.3, 0.62], { floorAtZero: true });
    assert.equal(s.domain[0], 0);
    assert.ok(s.domain[1] > 0.62 && s.domain[1] <= 1, `top ${s.domain[1]}`);
    assert.deepEqual(s.ticks, [0, 0.15, 0.3, 0.45, 0.6]);
  });
  it("floorAtZero: a chart near 100 % still ends at 100 %", () => {
    const s = chart.niceYScale([0.5, 0.97], { floorAtZero: true });
    assert.equal(s.domain[1], 1);
    assert.deepEqual(s.ticks, [0, 0.25, 0.5, 0.75, 1]);
  });
  it("padded: a line hovering around 55 % gets a band around it, not the whole axis", () => {
    const s = chart.niceYScale([0.53, 0.55, 0.58, 0.54]);
    assert.ok(s.domain[0] > 0.3 && s.domain[0] < 0.53, `floor ${s.domain[0]}`);
    assert.ok(s.domain[1] > 0.58 && s.domain[1] < 0.8, `ceiling ${s.domain[1]}`);
    assert.ok(s.ticks.length >= 2 && s.ticks.length <= 5);
    for (const t of s.ticks) assert.ok(t >= s.domain[0] && t <= s.domain[1]);
    assert.ok(s.ticks.every((t, i) => i === 0 || Math.abs(t - s.ticks[i - 1] - (s.ticks[1] - s.ticks[0])) < 1e-9), "even steps");
  });
  it("padded: never leaves 0..1 and a flat line still gets a visible band", () => {
    const lo = chart.niceYScale([0.01, 0.02]);
    assert.equal(lo.domain[0], 0);
    const hi = chart.niceYScale([0.99, 0.985]);
    assert.equal(hi.domain[1], 1);
    const flat = chart.niceYScale([0.4, 0.4, 0.4]);
    assert.ok(flat.domain[1] - flat.domain[0] >= 0.12);
  });
  it("nothing to plot → the full 0–100 % axis", () => {
    assert.deepEqual(chart.niceYScale([]), { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] });
  });
});

describe("axis ticks (UTC)", () => {
  const day = 86_400_000;
  const hour = 3_600_000;
  // A fixed "now" so the expectations never depend on when (or in which zone) the suite runs.
  const end = Date.UTC(2026, 8, 29, 14, 37, 12);
  it("1W: one tick per UTC midnight, evenly spaced, inside the window, at most six, labelled by day", () => {
    const start = end - 7 * day;
    const { ticks, granularity } = chart.axisScale(start, end, "1W", 6);
    assert.equal(granularity, "day");
    assert.ok(ticks.length >= 3 && ticks.length <= 6, `count ${ticks.length}`);
    for (const t of ticks) {
      assert.ok(t >= start && t <= end);
      assert.equal(t % day, 0, "UTC midnight");
    }
    const step = ticks[1] - ticks[0];
    for (let i = 2; i < ticks.length; i += 1) assert.equal(ticks[i] - ticks[i - 1], step);
    assert.equal(chart.formatAxisTime(Date.UTC(2026, 8, 23), "1W", granularity), "Sep 23");
  });
  it("1D: whole UTC hours with the smallest step that fits, labelled by the UTC clock", () => {
    const { ticks, granularity } = chart.axisScale(end - day, end, "1D", 6);
    assert.equal(granularity, "hour");
    assert.ok(ticks.length >= 4 && ticks.length <= 6, `count ${ticks.length}`);
    for (const t of ticks) assert.equal(t % hour, 0, "whole UTC hour");
    const step = ticks[1] - ticks[0];
    for (let i = 2; i < ticks.length; i += 1) assert.equal(ticks[i] - ticks[i - 1], step);
    assert.equal(chart.formatAxisTime(Date.UTC(2026, 8, 29, 4), "1D", granularity), "04:00");
    assert.equal(chart.formatAxisTime(Date.UTC(2026, 8, 29, 0), "1D", granularity), "00:00");
  });
  it("1H: minute ticks", () => {
    const { ticks, granularity } = chart.axisScale(end - hour, end, "1H", 6);
    assert.equal(granularity, "minute");
    for (const t of ticks) assert.equal(t % (5 * 60_000), 0);
  });
  it("compact charts ask for fewer ticks and get a larger step", () => {
    const many = chart.axisTicks(end - 30 * day, end, "1M", 6);
    const few = chart.axisTicks(end - 30 * day, end, "1M", 4);
    assert.ok(few.length <= 4 && few.length < many.length);
  });
  it("ALL over a year: first-of-month ticks at 00:00 UTC, January labelled with the year", () => {
    const { ticks, granularity } = chart.axisScale(end - 365 * day, end, "ALL", 6);
    assert.equal(granularity, "month");
    assert.ok(ticks.length >= 2 && ticks.length <= 6);
    for (const t of ticks) {
      const d = new Date(t);
      assert.equal(d.getUTCDate(), 1);
      assert.equal(t % day, 0);
    }
    assert.equal(chart.formatAxisTime(Date.UTC(2026, 8, 1), "ALL", "month"), "Sep");
    assert.equal(chart.formatAxisTime(Date.UTC(2027, 0, 1), "ALL", "month"), "2027");
  });
  it("ALL over a young market: day or hour ticks instead of an empty month axis", () => {
    const days = chart.axisScale(end - 10 * day, end, "ALL", 6);
    assert.equal(days.granularity, "day");
    assert.ok(days.ticks.length >= 2);
    const hours = chart.axisScale(end - 20 * hour, end, "ALL", 6);
    assert.equal(hours.granularity, "hour");
    assert.ok(hours.ticks.length >= 2);
  });
  it("an empty or inverted window yields no ticks", () => {
    assert.deepEqual(chart.axisTicks(10, 5, "1H"), []);
  });
  it("tooltips read in UTC", () => {
    const t = Date.UTC(2026, 8, 23, 12, 30);
    assert.equal(chart.formatPointTime(t, "1D"), "12:30 UTC");
    assert.equal(chart.formatPointTime(t, "1W"), "Sep 23, 12:30 UTC");
  });
});

describe("marketColorMap", () => {
  it("follows the chart ranking (volume, then price) and skips archived markets", () => {
    const map = chart.marketColorMap([
      { ticker: "A", currentPrice: "0.2", totalVolumeCC: "10" },
      { ticker: "B", currentPrice: "0.6", totalVolumeCC: "50" },
      { ticker: "Z", currentPrice: "0.9", totalVolumeCC: "999", archived: true },
    ]);
    assert.equal(map.get("B"), chart.SERIES_PALETTE[0]);
    assert.equal(map.get("A"), chart.SERIES_PALETTE[1]);
    assert.equal(map.has("Z"), false);
  });
});
