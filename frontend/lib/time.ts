/**
 * The one place the UI turns an instant into text, and text typed into a date field back into an
 * instant. Every instant on TruthOracle is UTC — the ledger's epoch seconds, the index's
 * `timestamptz`, the candles' epoch-aligned buckets — and the UI shows and reads them in UTC too,
 * so a close time or a strike date reads the same for every viewer and matches the contract, the
 * backend and the resolution sources. 24-hour clock; "UTC" is spelled out wherever a clock time
 * stands on its own (chart axes carry one "UTC" marker instead of one per tick).
 *
 * Durations and relative times ("44d 20h", "5h ago") are zone-free and live in chartData.ts.
 */

/** An instant: milliseconds since the epoch, an ISO-8601 string, or a Date. */
export type Instant = number | string | Date;

export const UTC_LABEL = "UTC";

export function toMs(t: Instant): number {
  if (t instanceof Date) return t.getTime();
  if (typeof t === "number") return t;
  return Date.parse(t);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    // en-US fixes the vocabulary (month abbreviations, digit shapes); the zone is always UTC.
    f = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" });
    formatters.set(key, f);
  }
  return f;
}

type PartName = "year" | "month" | "day" | "hour" | "minute";

function partsOf(ms: number, options: Intl.DateTimeFormatOptions): Record<PartName, string> {
  const out: Record<PartName, string> = { year: "", month: "", day: "", hour: "", minute: "" };
  for (const p of formatter(options).formatToParts(ms)) {
    if (p.type === "year" || p.type === "month" || p.type === "day" || p.type === "hour" || p.type === "minute") out[p.type] = p.value;
  }
  return out;
}

const DATE_TIME: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

function dateTimeParts(t: Instant): Record<PartName, string> | null {
  const ms = toMs(t);
  return Number.isFinite(ms) ? partsOf(ms, DATE_TIME) : null;
}

/** `Sep 29, 2026, 14:58 UTC` */
export function formatDateTimeUTC(t: Instant): string {
  const p = dateTimeParts(t);
  return p ? `${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute} ${UTC_LABEL}` : "";
}

/** `Sep 23, 12:30 UTC` — tooltips and close times within the year. */
export function formatShortDateTimeUTC(t: Instant): string {
  const p = dateTimeParts(t);
  return p ? `${p.month} ${p.day}, ${p.hour}:${p.minute} ${UTC_LABEL}` : "";
}

/** `Sep 29, 2026` */
export function formatDateUTC(t: Instant): string {
  const p = dateTimeParts(t);
  return p ? `${p.month} ${p.day}, ${p.year}` : "";
}

/** `Sep 29` */
export function formatMonthDayUTC(t: Instant): string {
  const p = dateTimeParts(t);
  return p ? `${p.month} ${p.day}` : "";
}

/** `14:58 UTC`, or `14:58` with `{ suffix: false }`. */
export function formatClockUTC(t: Instant, { suffix = true }: { suffix?: boolean } = {}): string {
  const p = dateTimeParts(t);
  if (!p) return "";
  return suffix ? `${p.hour}:${p.minute} ${UTC_LABEL}` : `${p.hour}:${p.minute}`;
}

/** What one axis step spans; decides how a tick is labelled. */
export type AxisGranularity = "minute" | "hour" | "day" | "month";

/**
 * A chart tick label: `14:30` for minute / hour ticks, `Sep 23` for day ticks, `Sep` for month
 * ticks (January shows the year instead, so year boundaries read at a glance).
 */
export function formatAxisLabel(t: Instant, granularity: AxisGranularity): string {
  const p = dateTimeParts(t);
  if (!p) return "";
  if (granularity === "minute" || granularity === "hour") return `${p.hour}:${p.minute}`;
  if (granularity === "day") return `${p.month} ${p.day}`;
  return p.month === "Jan" ? p.year : p.month;
}

const INPUT_VALUE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/;

/**
 * The instant a `datetime-local` value names, read as UTC (never `new Date(value)`, which reads it
 * in the viewer's zone). `null` when the value is empty or not a real date and time.
 */
export function parseUTCInput(value: string): number | null {
  const m = INPUT_VALUE.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(ms);
  // Date.UTC rolls over (Feb 30 → Mar 2); a round trip rejects dates that do not exist.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day || d.getUTCHours() !== hour || d.getUTCMinutes() !== minute) return null;
  return ms;
}

/** The ISO instant a `datetime-local` value names in UTC; `null` for an empty or invalid value. */
export function utcInputToIso(value: string): string | null {
  const ms = parseUTCInput(value);
  return ms === null ? null : new Date(ms).toISOString();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A `datetime-local` value (`YYYY-MM-DDTHH:mm`) showing an instant in UTC. */
export function toUTCInputValue(t: Instant): string {
  const ms = toMs(t);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** The current year in UTC (the footer's copyright). */
export function currentUTCYear(nowMs = Date.now()): number {
  return new Date(nowMs).getUTCFullYear();
}
