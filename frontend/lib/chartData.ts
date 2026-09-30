/**
 * Pure helpers behind the Kalshi-style charts (components/charts/*): the timeframe presets, the
 * candle → point conversion, the alignment of several markets on one time grid, the series
 * palette and the number formatting the cards share. No React, no DOM — unit-tested from
 * test/chart-data.test.mjs.
 */
import { toNumber, type ApiCandle, type ApiEventMarketCandles, type CandlePeriod, type Decimal } from "@/lib/marketsTypes";
import { formatAxisLabel, formatClockUTC, formatMonthDayUTC, formatShortDateTimeUTC, type AxisGranularity } from "@/lib/time";

export type Timeframe = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";
export const TIMEFRAMES: Timeframe[] = ["1H", "6H", "1D", "1W", "1M", "ALL"];

/**
 * Every chart opens on the past week. A week with nothing to draw gives way to the past day
 * (`settleRange`): a market listed within the hour has one hourly candle but a day of minute ones.
 */
export const OPENING_TIMEFRAME: Timeframe = "1W";
export const FALLBACK_TIMEFRAME: Timeframe = "1D";

/** Kalshi's presets: minute candles up to a day, hourly up to a month, daily for everything. */
const TIMEFRAME_SPEC: Record<Timeframe, { seconds: number | null; period: CandlePeriod }> = {
  "1H": { seconds: 3600, period: 1 },
  "6H": { seconds: 6 * 3600, period: 1 },
  "1D": { seconds: 86_400, period: 1 },
  "1W": { seconds: 7 * 86_400, period: 60 },
  "1M": { seconds: 30 * 86_400, period: 60 },
  ALL: { seconds: null, period: 1440 },
};

export interface CandleWindow {
  periodInterval: CandlePeriod;
  startTs: number;
  endTs: number;
}

/**
 * The `[startTs, endTs)` window and candle period for a timeframe. `ALL` starts at the market's
 * (or event's) creation, at most a year back; every other preset is anchored at `nowSec` and
 * never starts before creation, so a young market's 1M chart does not begin with a month of
 * carried-forward blanks.
 */
export function timeframeWindow(tf: Timeframe, nowSec: number, createdAtSec?: number | null): CandleWindow {
  const spec = TIMEFRAME_SPEC[tf];
  const created = createdAtSec && createdAtSec > 0 ? createdAtSec : null;
  const endTs = Math.floor(nowSec);
  if (spec.seconds === null) {
    const yearAgo = endTs - 365 * 86_400;
    return { periodInterval: spec.period, startTs: Math.max(created ?? yearAgo, yearAgo), endTs };
  }
  const startTs = Math.max(endTs - spec.seconds, created ?? 0);
  return { periodInterval: spec.period, startTs, endTs };
}

/** A chart's range, and whether it is final: the reader picked it, or the opening range was checked. */
export interface ChartRange {
  tf: Timeframe;
  settled: boolean;
}

/**
 * The range once an answer for `answered` came back with `candles` periods. The opening range is
 * kept when it draws a line (two candles or more) and otherwise gives way to the past day. Only
 * its first answer counts: once settled nothing changes, so a range the reader picked is never
 * overridden and the chart never jumps back when the week fills in.
 */
export function settleRange(range: ChartRange, answered: Timeframe, candles: number): ChartRange {
  if (range.settled || range.tf !== answered) return range;
  return { tf: candles >= 2 ? range.tf : FALLBACK_TIMEFRAME, settled: true };
}

/** Points the charts plot: the candle's close at the START of its period, in milliseconds. */
export interface PricePoint {
  t: number;
  price: number;
}

export function candlesToPoints(candles: ApiCandle[]): PricePoint[] {
  return candles.map((c) => ({ t: c.startTs * 1000, price: clamp01(toNumber(c.price.close)) }));
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** One row per timestamp with every market's close under its ticker — recharts' multi-line shape. */
export interface AlignedRow {
  t: number;
  [ticker: string]: number;
}

/**
 * Aligns the event's markets on one grid. The backend already returns them dense and aligned; this
 * still merges by timestamp so a market that lacks a bucket (or a slightly different grid) never
 * shifts another market's line.
 */
export function alignSeries(markets: Pick<ApiEventMarketCandles, "ticker" | "candlesticks">[]): AlignedRow[] {
  const rows = new Map<number, AlignedRow>();
  for (const m of markets) {
    for (const c of m.candlesticks) {
      const t = c.startTs * 1000;
      const row = rows.get(t) ?? { t };
      row[m.ticker] = clamp01(toNumber(c.price.close));
      rows.set(t, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

/** Categorical palette (colour-blind safe order); index 0 is the leading market. */
export const SERIES_PALETTE = ["#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#db2777", "#0891b2", "#ea580c", "#4b5563"];
export const MUTED_SERIES_COLOR = "#cbd5e1";

export function seriesColor(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

/** How many markets get a colour of their own on an event chart; the rest are grey until toggled. */
export const EVENT_CHART_TOP_N = 5;

/** Markets ordered for an event chart: most traded first, ties by current price. */
export function rankMarketsForChart<T extends { ticker: string; totalVolumeCC?: Decimal | number; currentPrice: Decimal | number }>(markets: T[]): T[] {
  return [...markets].sort((a, b) => {
    const dv = toNum(b.totalVolumeCC) - toNum(a.totalVolumeCC);
    if (dv !== 0) return dv;
    return toNum(b.currentPrice) - toNum(a.currentPrice);
  });
}

function toNum(v: Decimal | number | undefined): number {
  return typeof v === "number" ? v : v == null ? 0 : Number(v);
}

/**
 * Colours per market for an event, from the same ranking the event chart uses, so outcome
 * rows, legend and lines always agree. Archived markets are skipped like the chart skips them.
 */
export function marketColorMap<T extends { ticker: string; archived?: boolean; totalVolumeCC?: Decimal | number; currentPrice: Decimal | number }>(markets: T[]): Map<string, string> {
  const map = new Map<string, string>();
  rankMarketsForChart(markets.filter((m) => !m.archived)).forEach((m, i) => map.set(m.ticker, seriesColor(i)));
  return map;
}

// ---------------------------------------------------------------------------------------------
// Axis scaling
// ---------------------------------------------------------------------------------------------

/** Tick steps in percentage points a y axis may use. */
const Y_STEPS = [5, 10, 15, 20, 25, 50];

export interface YScale {
  /** Fractions 0..1, as recharts' `domain`. */
  domain: [number, number];
  /** Fractions 0..1, ascending, as recharts' `ticks`. */
  ticks: number[];
}

const FULL_SCALE: YScale = { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] };

function roundFrac(pct: number): number {
  return Math.round(pct * 100) / 10_000;
}

/**
 * A y axis scaled to the data instead of a fixed 0–100 %, the way Polymarket draws it: the
 * ticks are multiples of one "nice" step, at most `maxTicks` of them, and the domain reaches a
 * little past the extreme values so no line touches the frame. `floorAtZero` keeps 0 % as the
 * base (multi-market charts, where the lines are chances that sum to ~100 %); otherwise both
 * ends are padded around the data (one market hovering near 55 % gets a readable band, not a
 * flat stripe). Values are fractions 0..1; nothing to show → the full 0–100 % axis.
 */
export function niceYScale(values: number[], opts: { floorAtZero?: boolean; maxTicks?: number } = {}): YScale {
  const pct = values.filter((v) => Number.isFinite(v)).map((v) => clamp01(v) * 100);
  if (pct.length === 0) return FULL_SCALE;
  const maxTicks = Math.max(2, opts.maxTicks ?? 5);
  const max = Math.max(...pct);
  const min = Math.min(...pct);
  let lo: number;
  let hi: number;
  if (opts.floorAtZero) {
    lo = 0;
    hi = Math.min(100, max + Math.max(3, max * 0.12));
    if (hi < 10) hi = 10;
  } else {
    const range = max - min;
    const pad = Math.max(3, range * 0.2);
    lo = Math.max(0, min - pad);
    hi = Math.min(100, max + pad);
    if (hi - lo < 12) {
      const mid = (lo + hi) / 2;
      lo = Math.max(0, mid - 6);
      hi = Math.min(100, mid + 6);
      if (hi - lo < 12) (lo === 0 ? (hi = 12) : (lo = 88));
    }
  }
  for (const step of Y_STEPS) {
    const first = Math.ceil(lo / step) * step;
    const last = Math.floor(hi / step) * step;
    const count = last >= first ? Math.floor((last - first) / step) + 1 : 0;
    if (count <= maxTicks && count >= 2) {
      const ticks: number[] = [];
      for (let v = first; v <= last + 1e-9; v += step) ticks.push(roundFrac(v));
      return { domain: [roundFrac(lo), roundFrac(hi)], ticks };
    }
  }
  return { domain: [roundFrac(lo), roundFrac(hi)], ticks: [roundFrac(lo), roundFrac(hi)] };
}

/**
 * Candidate x-tick steps in seconds, smallest first. Clock steps (whole minutes, then whole hours)
 * serve the intraday presets and every span too short for day steps: windows start at the
 * market's creation, so a young market's day, week or whole history can span a few minutes.
 */
const CLOCK_STEPS = [1, 2, 5, 10, 15, 30].map((m) => m * 60).concat([1, 2, 3, 4, 6, 12].map((h) => h * 3600));
const DAY_STEPS: Record<"1W" | "1M", number[]> = {
  "1W": [86_400, 2 * 86_400],
  "1M": [86_400, 2 * 86_400, 5 * 86_400, 7 * 86_400, 10 * 86_400],
};
/** ALL spans from the market's creation, so its steps follow how long that is. */
const ALL_DAY_STEPS = [1, 2, 5, 7, 10, 14].map((d) => d * 86_400);
const MONTH_STEPS = [1, 2, 3, 6, 12];
const DAY_MS = 86_400_000;

export interface AxisScale {
  /** Tick instants (ms). */
  ticks: number[];
  /** What one step spans: decides how `formatAxisTime` labels a tick. */
  granularity: AxisGranularity;
}

/** How a timeframe's ticks are labelled when there is no computed scale. */
function defaultGranularity(tf: Timeframe): AxisGranularity {
  if (tf === "1W" || tf === "1M") return "day";
  if (tf === "ALL") return "month";
  return "hour";
}

/**
 * Multiples of the step counted from the epoch. The epoch is 00:00 UTC, so these land on whole
 * UTC minutes, whole UTC hours and UTC midnights — the same boundaries the backend buckets its
 * candles on.
 */
function evenTicks(startMs: number, endMs: number, stepSec: number): number[] {
  const stepMs = stepSec * 1000;
  const ticks: number[] = [];
  for (let t = Math.ceil(startMs / stepMs) * stepMs; t <= endMs; t += stepMs) ticks.push(t);
  return ticks;
}

/** First-of-month (00:00 UTC) ticks every `months` months, from the first one inside the range. */
function monthTicks(startMs: number, endMs: number, months: number): number[] {
  const s = new Date(startMs);
  let year = s.getUTCFullYear();
  let month = s.getUTCMonth();
  if (Date.UTC(year, month, 1) < startMs) month += 1;
  const ticks: number[] = [];
  for (let t = Date.UTC(year, month, 1); t <= endMs; t = Date.UTC(year, month, 1)) {
    ticks.push(t);
    month += months;
    year += Math.floor(month / 12);
    month %= 12;
  }
  return ticks;
}

/**
 * Evenly spaced x ticks inside `[startMs, endMs]` and how to label them, aligned to UTC
 * boundaries — minutes / hours for intraday presets, midnight for 1W and 1M, and for ALL whichever
 * of minutes, hours, days or first-of-month suits the span — choosing the smallest step that
 * yields at most `maxTicks`. A span too short for day ticks (fewer than two) gets clock ticks
 * instead, and a short span gets minute steps: with no ticks at all recharts labels every point,
 * piling the labels on top of each other. The last data point is never forced to carry a label:
 * the axis reads like a calendar, not like a ruler ending at "now".
 */
export function axisScale(startMs: number, endMs: number, tf: Timeframe, maxTicks = 6): AxisScale {
  const none: AxisScale = { ticks: [], granularity: defaultGranularity(tf) };
  if (!(endMs > startMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return none;
  const limit = Math.max(2, maxTicks);
  const pick = (steps: number[], granularityOf: (stepSec: number) => AxisGranularity): AxisScale | null => {
    for (const stepSec of steps) {
      const ticks = evenTicks(startMs, endMs, stepSec);
      if (ticks.length <= limit) return { ticks, granularity: granularityOf(stepSec) };
    }
    return null;
  };
  const clock = (): AxisScale => pick(CLOCK_STEPS, (stepSec) => (stepSec < 3600 ? "minute" : "hour")) ?? none;
  const daysOrClock = (steps: number[]): AxisScale => {
    const days = pick(steps, () => "day");
    return days && days.ticks.length >= 2 ? days : clock();
  };
  if (tf === "ALL") {
    const span = endMs - startMs;
    if (span <= 2 * DAY_MS) return clock();
    if (span <= 90 * DAY_MS) return daysOrClock(ALL_DAY_STEPS);
    for (const months of MONTH_STEPS) {
      const ticks = monthTicks(startMs, endMs, months);
      if (ticks.length <= limit) return { ticks, granularity: "month" };
    }
    return { ticks: [], granularity: "month" };
  }
  if (tf === "1W" || tf === "1M") return daysOrClock(DAY_STEPS[tf]);
  return clock();
}

/** The tick instants of `axisScale`. */
export function axisTicks(startMs: number, endMs: number, tf: Timeframe, maxTicks = 6): number[] {
  return axisScale(startMs, endMs, tf, maxTicks).ticks;
}

export function formatPercent(p: number, digits = 0): string {
  return `${(clamp01(p) * 100).toFixed(digits)}%`;
}

export function formatCents(p: number): string {
  return `${Math.round(clamp01(p) * 100)}¢`;
}

/** `+4.2` / `−1.0` (percentage points), sign-aware, `null` when there is nothing to compare with. */
export interface Delta {
  points: number;
  text: string;
  direction: "up" | "down" | "flat";
}

export function priceDelta(current: number, previous: number | null | undefined): Delta | null {
  if (previous == null || !Number.isFinite(previous)) return null;
  const points = (clamp01(current) - clamp01(previous)) * 100;
  const rounded = Math.round(points * 10) / 10;
  const direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const text = `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)}`;
  return { points: rounded, text, direction };
}

/** First and last plotted price of a window, for the headline delta of a chart. */
export function windowDelta(points: PricePoint[]): Delta | null {
  if (points.length === 0) return null;
  return priceDelta(points[points.length - 1].price, points[0].price);
}

/** Axis tick label (UTC) for a timestamp (ms): pass the scale's granularity; the timeframe's default otherwise. */
export function formatAxisTime(tMs: number, tf: Timeframe, granularity?: AxisGranularity): string {
  return formatAxisLabel(tMs, granularity ?? defaultGranularity(tf));
}

/** Tooltip time (UTC): the clock for intraday windows, date and clock for longer ones. */
export function formatPointTime(tMs: number, tf: Timeframe): string {
  return tf === "1H" || tf === "6H" || tf === "1D" ? formatClockUTC(tMs) : formatShortDateTimeUTC(tMs);
}

/** `1.2k CC`, `3.4M CC`, `812 CC` — the compact volume figure of a card. */
export function compactCC(v: Decimal | number, unit = "CC"): string {
  const n = toNum(v);
  const abs = Math.abs(n);
  let text: string;
  if (abs >= 1_000_000) text = `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  else if (abs >= 1_000) text = `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  else if (abs >= 100) text = n.toFixed(0);
  else text = n.toFixed(abs >= 10 ? 1 : 2);
  // Drop trailing zeros so small figures read naturally: 0.00 → 0, 0.50 → 0.5, 1.0k → 1k.
  text = text.replace(/(\.\d*?)0+(?=[kM]?$)/, "$1").replace(/\.(?=[kM]?$)/, "");
  if (text === "-0") text = "0";
  return unit ? `${text} ${unit}` : text;
}

/** `3m ago`, `2h ago`, `Yesterday`, else a short UTC date. */
export function relativeTime(iso: string | number, nowMs = Date.now()): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2 * 86_400) return "Yesterday";
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return formatMonthDayUTC(t);
}

/** Time left until `iso`: `3d 4h`, `52m`, `Closed`. */
export function timeLeft(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "—";
  const s = Math.floor((Date.parse(iso) - nowMs) / 1000);
  if (!Number.isFinite(s)) return "—";
  if (s <= 0) return "Closed";
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

/** A party id shortened for a public feed: `abcd1234…ef90`. Already-masked values pass through. */
export function maskParty(party: string): string {
  if (!party) return "";
  if (party.includes("…")) return party;
  const hint = party.split("::")[0];
  if (party.length <= 16) return party;
  return `${hint.slice(0, 8)}…${party.slice(-4)}`;
}
