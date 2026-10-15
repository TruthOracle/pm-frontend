/**
 * Pure helpers behind the Kalshi-style charts (components/charts/*): the timeframe presets, the
 * candle → point conversion, the alignment of several markets on one time grid, the series
 * palette and the number formatting the cards share. No React, no DOM — unit-tested from
 * test/chart-data.test.mjs.
 */
import {
  toNumber,
  type ApiCandle,
  type ApiEventMarketCandles,
  type CandlePeriod,
  type Decimal,
} from "@/lib/marketsTypes";
import type { InstrumentRef } from "@/lib/instruments";
import {
  formatAxisLabel,
  formatLocalClock,
  formatLocalShortDateTime,
  formatMonthDayUTC,
  type AxisGranularity,
} from "@/lib/time";

export type Timeframe = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";
export const TIMEFRAMES: Timeframe[] = ["1H", "6H", "1D", "1W", "1M", "ALL"];

/** Every chart opens on the past week; a week with nothing to draw gives way to the past day (`settleRange`). */
export const OPENING_TIMEFRAME: Timeframe = "1W";
export const FALLBACK_TIMEFRAME: Timeframe = "1D";

/** How far back each preset reaches; ALL reaches back to creation (at most a year). */
const TIMEFRAME_SECONDS: Record<Timeframe, number | null> = {
  "1H": 3600,
  "6H": 6 * 3600,
  "1D": 86_400,
  "1W": 7 * 86_400,
  "1M": 30 * 86_400,
  ALL: null,
};

/** The candle periods the backend keeps (minutes), finest first. */
const CANDLE_PERIODS: CandlePeriod[] = [1, 60, 1440];
/** The most candles a chart asks for per market: a day of minutes. */
const MAX_CHART_CANDLES = 1440;

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
 *
 * The period is the finest that keeps the window within a day of minutes (1 440 candles), judged
 * on the span actually drawn: over a full preset that is Kalshi's scheme (minutes up to a day,
 * hours up to two months, days beyond), and a market younger than its window gets finer candles
 * — an hour-old market's week is an hour of minutes, not one hourly candle that hides every move.
 */
export function timeframeWindow(tf: Timeframe, nowSec: number, createdAtSec?: number | null): CandleWindow {
  const reach = TIMEFRAME_SECONDS[tf];
  const created = createdAtSec && createdAtSec > 0 ? createdAtSec : null;
  const endTs = Math.floor(nowSec);
  const yearAgo = endTs - 365 * 86_400;
  const startTs = reach === null ? Math.max(created ?? yearAgo, yearAgo) : Math.max(endTs - reach, created ?? 0);
  const span = endTs - startTs;
  const periodInterval = CANDLE_PERIODS.find((p) => span / (p * 60) <= MAX_CHART_CANDLES) ?? 1440;
  return { periodInterval, startTs, endTs };
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

/** A point the charts plot: a price and the instant it held, in milliseconds. */
export interface PricePoint {
  t: number;
  price: number;
}

/**
 * The line a market's candles draw: the price the window opens on (the close carried into it, or
 * the first candle's open for a market created inside it), then each close at the END of its
 * period, the moment that price held. The period still running ends at `nowMs`, and anything
 * clamped onto the same instant keeps only the latest close. Plotting a close at its period's
 * start would pull every move back a whole period: an hourly candle that closed at 100 % after a
 * jump at 09:30 would claim 100 % from 09:00.
 */
export function candlesToPoints(candles: ApiCandle[], nowMs = Date.now()): PricePoint[] {
  const first = candles[0];
  if (!first) return [];
  const points: PricePoint[] = [
    { t: first.startTs * 1000, price: clamp01(toNumber(first.price.previous ?? first.price.open)) },
  ];
  for (const c of candles) {
    const t = Math.min(c.endTs * 1000, nowMs);
    const price = clamp01(toNumber(c.price.close));
    const last = points[points.length - 1];
    if (t <= last.t) last.price = price;
    else points.push({ t, price });
  }
  return points;
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
 * Aligns the event's markets on one grid, each drawn like `candlesToPoints` with the same `nowMs`.
 * The backend already returns them dense and aligned; this still merges by timestamp so a market
 * that lacks a bucket (or starts later) never shifts another market's line.
 */
export function alignSeries(
  markets: Pick<ApiEventMarketCandles, "ticker" | "candlesticks">[],
  nowMs = Date.now(),
): AlignedRow[] {
  const rows = new Map<number, AlignedRow>();
  for (const m of markets) {
    for (const p of candlesToPoints(m.candlesticks, nowMs)) {
      const row = rows.get(p.t) ?? { t: p.t };
      row[m.ticker] = p.price;
      rows.set(p.t, row);
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
export function rankMarketsForChart<
  T extends { ticker: string; totalVolume?: Decimal | number; currentPrice: Decimal | number },
>(markets: T[]): T[] {
  return [...markets].sort((a, b) => {
    const dv = toNum(b.totalVolume) - toNum(a.totalVolume);
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
export function marketColorMap<
  T extends { ticker: string; archived?: boolean; totalVolume?: Decimal | number; currentPrice: Decimal | number },
>(markets: T[]): Map<string, string> {
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
      if (hi - lo < 12) lo === 0 ? (hi = 12) : (lo = 88);
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
 * Ticks every `stepSec` on the viewer's clock (charts read in the browser's zone, lib/time.ts):
 * under a day, whole multiples of the step counted from each local midnight, so a viewer at
 * +05:30 gets 15:00 rather than 14:30; from a day up, the local midnights whose calendar day
 * number is a multiple of the step in days. Built from local calendar fields rather than by adding
 * milliseconds, so a daylight-saving day keeps its ticks on the hour. Stops once past `max`: the
 * caller then tries a larger step.
 */
function localTicks(startMs: number, endMs: number, stepSec: number, max: number): number[] {
  const ticks: number[] = [];
  const first = new Date(startMs);
  if (stepSec >= 86_400) {
    const days = stepSec / 86_400;
    for (
      let d = new Date(first.getFullYear(), first.getMonth(), first.getDate());
      d.getTime() <= endMs;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      // The calendar day as a number (days since 1970-01-01), whatever the zone.
      if (
        d.getTime() < startMs ||
        Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS) % days !== 0
      )
        continue;
      ticks.push(d.getTime());
      if (ticks.length > max) break;
    }
    return ticks;
  }
  const stepMin = stepSec / 60;
  for (let day = 0; ; day += 1) {
    const midnight = new Date(first.getFullYear(), first.getMonth(), first.getDate() + day);
    if (midnight.getTime() > endMs) return ticks;
    const from = day === 0 ? Math.floor((first.getHours() * 60 + first.getMinutes()) / stepMin) * stepMin : 0;
    for (let m = from; m < 1440; m += stepMin) {
      const t = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), 0, m).getTime();
      if (t > endMs) return ticks;
      // A skipped daylight-saving hour folds two wall-clock times onto one instant: keep it once.
      if (t < startMs || t <= (ticks[ticks.length - 1] ?? -Infinity)) continue;
      ticks.push(t);
      if (ticks.length > max) return ticks;
    }
  }
}

/** First-of-month (local midnight) ticks every `months` months, from the first one inside the range. */
function monthTicks(startMs: number, endMs: number, months: number): number[] {
  const s = new Date(startMs);
  const year = s.getFullYear();
  let month = s.getMonth();
  if (new Date(year, month, 1).getTime() < startMs) month += 1;
  const ticks: number[] = [];
  // The Date constructor carries a month past December into the next year.
  for (let t = new Date(year, month, 1).getTime(); t <= endMs; t = new Date(year, month, 1).getTime()) {
    ticks.push(t);
    month += months;
  }
  return ticks;
}

/**
 * Evenly spaced x ticks inside `[startMs, endMs]` and how to label them, aligned to the viewer's
 * clock — minutes / hours for intraday presets, midnight for 1W and 1M, and for ALL whichever
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
      const ticks = localTicks(startMs, endMs, stepSec, limit);
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

/** Axis tick label (viewer's clock) for a timestamp (ms): pass the scale's granularity; the timeframe's default otherwise. */
export function formatAxisTime(tMs: number, tf: Timeframe, granularity?: AxisGranularity): string {
  return formatAxisLabel(tMs, granularity ?? defaultGranularity(tf));
}

/** Tooltip time (viewer's clock): the clock for intraday windows, date and clock for longer ones. */
export function formatPointTime(tMs: number, tf: Timeframe): string {
  return tf === "1H" || tf === "6H" || tf === "1D" ? formatLocalClock(tMs) : formatLocalShortDateTime(tMs);
}

/**
 * `1.2k cBYN`, `3.4M CC`, `812 CC` — the compact volume figure of a card, labelled with the
 * instrument the figure is in. `null` gives the bare number (a figure whose label sits elsewhere,
 * or a count that is not money). Small figures keep at most two decimals, and never more than the
 * instrument has.
 */
export function compactAmount(
  v: Decimal | number,
  instrument: Pick<InstrumentRef, "symbol" | "decimals"> | null | undefined,
): string {
  const n = toNum(v);
  const abs = Math.abs(n);
  const smallDp = Math.max(0, Math.min(2, instrument?.decimals ?? 2));
  let text: string;
  if (abs >= 1_000_000) text = `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  else if (abs >= 1_000) text = `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  else if (abs >= 100) text = n.toFixed(0);
  else text = n.toFixed(Math.min(smallDp, abs >= 10 ? 1 : 2));
  // Drop trailing zeros so small figures read naturally: 0.00 → 0, 0.50 → 0.5, 1.0k → 1k.
  text = text.replace(/(\.\d*?)0+(?=[kM]?$)/, "$1").replace(/\.(?=[kM]?$)/, "");
  if (text === "-0") text = "0";
  return instrument?.symbol ? `${text} ${instrument.symbol}` : text;
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
