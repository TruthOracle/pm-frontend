/**
 * Pure helpers behind the Kalshi-style charts (components/charts/*): the timeframe presets, the
 * candle → point conversion, the alignment of several markets on one time grid, the series
 * palette and the number formatting the cards share. No React, no DOM — unit-tested from
 * test/chart-data.test.mjs.
 */
import { toNumber, type ApiCandle, type ApiEventMarketCandles, type CandlePeriod, type Decimal } from "@/lib/marketsTypes";

export type Timeframe = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";
export const TIMEFRAMES: Timeframe[] = ["1H", "6H", "1D", "1W", "1M", "ALL"];

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

export type Trend = "up" | "down" | "flat";

export function sparklineTrend(closes: Array<Decimal | number>): Trend {
  if (closes.length < 2) return "flat";
  const first = toNum(closes[0]);
  const last = toNum(closes[closes.length - 1]);
  const diff = Math.round((last - first) * 1000) / 1000;
  return diff > 0 ? "up" : diff < 0 ? "down" : "flat";
}

/** Axis tick label for a timestamp (ms) under a timeframe: clock for intraday, date otherwise. */
export function formatAxisTime(tMs: number, tf: Timeframe, locale?: string): string {
  const d = new Date(tMs);
  if (Number.isNaN(d.getTime())) return "";
  if (tf === "1H" || tf === "6H" || tf === "1D") return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (tf === "1W" || tf === "1M") return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return d.toLocaleDateString(locale, { month: "short", year: "2-digit" });
}

/** Tooltip time: full date + time for anything longer than a day. */
export function formatPointTime(tMs: number, tf: Timeframe, locale?: string): string {
  const d = new Date(tMs);
  if (Number.isNaN(d.getTime())) return "";
  if (tf === "1H" || tf === "6H" || tf === "1D") return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
  text = text.replace(/\.0(?=[kM]?$)/, "");
  return unit ? `${text} ${unit}` : text;
}

/** `3m ago`, `2h ago`, `Yesterday`, else a short date. */
export function relativeTime(iso: string | number, nowMs = Date.now(), locale?: string): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2 * 86_400) return "Yesterday";
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(t).toLocaleDateString(locale, { month: "short", day: "numeric" });
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
