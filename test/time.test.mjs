/**
 * Unit tests for frontend/lib/time.ts: every instant is shown and read in UTC, whatever zone the
 * browser (or this process) runs in, except chart labels, which follow the viewer's clock (their
 * cases build local instants). Run under several zones — `TZ=Asia/Kolkata npm test`,
 * `TZ=America/Los_Angeles npm test`, `TZ=UTC npm test` — the expectations are identical.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const time = await import("../frontend/lib/time.ts");

describe("formatting (always UTC)", () => {
  const t = Date.UTC(2026, 8, 29, 14, 58, 41);
  it("full date-time, short date-time, date, month-day and clock", () => {
    assert.equal(time.formatDateTimeUTC(t), "Sep 29, 2026, 14:58 UTC");
    assert.equal(time.formatShortDateTimeUTC(t), "Sep 29, 14:58 UTC");
    assert.equal(time.formatDateUTC(t), "Sep 29, 2026");
    assert.equal(time.formatMonthDayUTC(t), "Sep 29");
    assert.equal(time.formatClockUTC(t), "14:58 UTC");
    assert.equal(time.formatClockUTC(t, { suffix: false }), "14:58");
  });
  it("accepts ms, ISO strings and Dates alike", () => {
    assert.equal(time.formatDateTimeUTC("2026-09-29T14:58:41Z"), "Sep 29, 2026, 14:58 UTC");
    assert.equal(time.formatDateTimeUTC("2026-09-29T20:28:41+05:30"), "Sep 29, 2026, 14:58 UTC");
    assert.equal(time.formatDateTimeUTC(new Date(t)), "Sep 29, 2026, 14:58 UTC");
  });
  it("near midnight UTC the date is the UTC date, not the viewer's", () => {
    // 23:45 UTC is already the next day in Asia; 00:15 UTC is still the previous day in America.
    assert.equal(time.formatDateTimeUTC(Date.UTC(2026, 8, 29, 23, 45)), "Sep 29, 2026, 23:45 UTC");
    assert.equal(time.formatDateTimeUTC(Date.UTC(2026, 8, 30, 0, 15)), "Sep 30, 2026, 00:15 UTC");
    assert.equal(time.formatClockUTC(Date.UTC(2026, 8, 30, 0, 5)), "00:05 UTC");
  });
  it("is unaffected by daylight-saving transitions", () => {
    // 2026-03-08 07:30 UTC is the US spring-forward hour; 2026-10-25 01:30 UTC the EU fall-back hour.
    assert.equal(time.formatDateTimeUTC(Date.UTC(2026, 2, 8, 7, 30)), "Mar 8, 2026, 07:30 UTC");
    assert.equal(time.formatDateTimeUTC(Date.UTC(2026, 9, 25, 1, 30)), "Oct 25, 2026, 01:30 UTC");
  });
  it("chart labels per granularity, on the viewer's clock", () => {
    assert.equal(time.formatAxisLabel(new Date(2026, 8, 29, 14, 30), "minute"), "14:30");
    assert.equal(time.formatAxisLabel(new Date(2026, 8, 29, 9), "hour"), "09:00");
    assert.equal(time.formatAxisLabel(new Date(2026, 8, 23), "day"), "Sep 23");
    assert.equal(time.formatAxisLabel(new Date(2026, 8, 1), "month"), "Sep");
    assert.equal(time.formatAxisLabel(new Date(2027, 0, 1), "month"), "2027");
  });
  it("chart tooltips on the viewer's clock, with no zone marker", () => {
    const local = new Date(2026, 8, 29, 14, 58, 41);
    assert.equal(time.formatLocalClock(local), "14:58");
    assert.equal(time.formatLocalShortDateTime(local), "Sep 29, 14:58");
    assert.equal(time.formatLocalClock(new Date(2026, 8, 30, 0, 5)), "00:05");
    assert.equal(time.formatLocalClock("not a date"), "");
  });
  it("invalid input formats to an empty string", () => {
    assert.equal(time.formatDateTimeUTC("not a date"), "");
    assert.equal(time.formatMonthDayUTC(Number.NaN), "");
  });
  it("the current year is the UTC year", () => {
    assert.equal(time.currentUTCYear(Date.UTC(2026, 11, 31, 23, 30)), 2026);
    assert.equal(time.currentUTCYear(Date.UTC(2027, 0, 1, 0, 30)), 2027);
  });
});

describe("date inputs (read as UTC)", () => {
  it("parses a datetime-local value as a UTC instant", () => {
    assert.equal(time.parseUTCInput("2026-12-16T19:00"), Date.UTC(2026, 11, 16, 19, 0));
    assert.equal(time.parseUTCInput("2026-12-16T19:00:30"), Date.UTC(2026, 11, 16, 19, 0, 30));
    assert.equal(time.utcInputToIso("2026-12-16T19:00"), "2026-12-16T19:00:00.000Z");
  });
  it("rejects empty, malformed and impossible values", () => {
    assert.equal(time.parseUTCInput(""), null);
    assert.equal(time.parseUTCInput("2026-12-16"), null);
    assert.equal(time.parseUTCInput("2026-02-30T10:00"), null);
    assert.equal(time.parseUTCInput("2026-12-16T24:00"), null);
    assert.equal(time.utcInputToIso(""), null);
  });
  it("round-trips an instant through the input value in UTC", () => {
    const t = Date.UTC(2026, 8, 30, 0, 15);
    assert.equal(time.toUTCInputValue(t), "2026-09-30T00:15");
    assert.equal(time.parseUTCInput(time.toUTCInputValue(t)), t);
  });
});
