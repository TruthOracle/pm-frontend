/**
 * Pure logic behind the ramp screens (lib/ramp.ts holds the wording and the calls,
 * components/ramp/* the React): exact decimal handling of Money strings, the amount input,
 * limit checks, the stale-quote guard, link and image safety, the order page's polling
 * schedule, timeline and countdown text, the consent form, retry keys. No React, no network;
 * test/ramp-logic.test.mjs covers it.
 *
 * Money stays a string end to end: the wire's 10-dp decimals are compared as bigint units and
 * passed through verbatim, never through a float (a Withdraw of 1234567.89 must not become
 * 1234567.8899999999 and miss its order).
 */

// ---------------------------------------------------------------------------
// Exact decimals
// ---------------------------------------------------------------------------

/** The wire's scale: every Money string carries 10 decimals (truthoracle-backend src/util/money.ts). */
export const WIRE_DECIMALS = 10;
const SCALE = 10n ** 10n;
const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d*))?$/;

function clampDecimals(decimals: number): number {
  return Math.max(0, Math.min(WIRE_DECIMALS, Math.trunc(Number.isFinite(decimals) ? decimals : WIRE_DECIMALS)));
}

/** A decimal string as integer units of 1e-10; null when it is not a plain decimal or finer than 1e-10. */
export function toUnits(value: string | null | undefined): bigint | null {
  if (typeof value !== "string") return null;
  const m = DECIMAL_RE.exec(value.trim());
  if (!m) return null;
  const frac = m[3] ?? "";
  if (/[1-9]/.test(frac.slice(WIRE_DECIMALS))) return null;
  const units = BigInt(m[2]) * SCALE + BigInt(frac.slice(0, WIRE_DECIMALS).padEnd(WIRE_DECIMALS, "0"));
  return m[1] === "-" ? -units : units;
}

/** Units back to the wire's 10-dp string: `12.5000000000`. */
export function fromUnits(units: bigint): string {
  const abs = units < 0n ? -units : units;
  return `${units < 0n ? "-" : ""}${abs / SCALE}.${(abs % SCALE).toString().padStart(WIRE_DECIMALS, "0")}`;
}

/** -1, 0 or 1 like a comparator; null when either side is not a decimal. */
export function compareDecimal(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const x = toUnits(a);
  const y = toUnits(b);
  if (x === null || y === null) return null;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isPositiveDecimal(value: string | null | undefined): boolean {
  const u = toUnits(value);
  return u !== null && u > 0n;
}

/** The exact 10-dp string a Daml `Decimal` argument takes; throws on anything that is not a positive decimal. */
export function damlDecimalString(value: string): string {
  const u = toUnits(value);
  if (u === null || u <= 0n) throw new Error(`not a positive decimal amount: ${JSON.stringify(value)}`);
  return fromUnits(u);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A figure with exactly `decimals` digits, truncated (never rounded up), thousands grouped:
 * `1,250.50`. Fiat is whole kopecks on the wire, so the truncation never drops anything real;
 * `grouping: false` gives the plain form a person types into ERIP (`1250.50`). "—" for junk.
 */
export function formatFixed(value: string | null | undefined, decimals: number, grouping = true): string {
  const u = toUnits(value);
  if (u === null) return "—";
  const d = clampDecimals(decimals);
  const abs = u < 0n ? -u : u;
  const scaled = abs / 10n ** BigInt(WIRE_DECIMALS - d);
  const unit = 10n ** BigInt(d);
  const whole = (scaled / unit).toString();
  const text =
    d > 0
      ? `${grouping ? groupThousands(whole) : whole}.${(scaled % unit).toString().padStart(d, "0")}`
      : grouping
        ? groupThousands(whole)
        : whole;
  return u < 0n && scaled !== 0n ? `-${text}` : text;
}

/**
 * A ledger amount (the participant's decimal, parsed to a number by utils/activeContracts) equals
 * a wire decimal at the instrument's scale. Used to recognise the PendingPayout a Withdraw of
 * exactly the order's amount created.
 */
export function ledgerAmountEquals(ledger: number, wire: string, decimals: number): boolean {
  const u = toUnits(wire);
  if (u === null || !Number.isFinite(ledger)) return false;
  const d = clampDecimals(decimals);
  const step = 10n ** BigInt(WIRE_DECIMALS - d);
  if (u % step !== 0n) return false;
  const scaled = Math.round(ledger * 10 ** d);
  return Number.isSafeInteger(scaled) && BigInt(scaled) === u / step;
}

// ---------------------------------------------------------------------------
// Amount input and limits
// ---------------------------------------------------------------------------

export const MAX_AMOUNT_INTEGER_DIGITS = 9;

export type AmountProblem = "empty" | "format" | "decimals" | "zero" | "ambiguous";

export type AmountInput = { ok: true; value: string } | { ok: false; problem: AmountProblem };

/** Commas exactly every three digits (`1,250`, `1,250,000.50`): the grouping the forms print limits with. */
const GROUPED_AMOUNT = /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d*)?$/;

/**
 * What the person typed, as the decimal string the backend takes: spaces dropped (a typed
 * `1 250`), trailing zeros trimmed. A comma is a thousands separator only where that is the one
 * reading (`1,250.50`, `1,250,000`) and a decimal comma otherwise (`12,50`); a lone `d,ddd`
 * (`1,500`: fifteen hundred, or 1.5?) is refused as `ambiguous`, never guessed. `maxDecimals` is
 * the finer side's limit — an order must be whole in the fiat's and the token's decimals.
 */
export function parseAmountInput(raw: string, maxDecimals: number): AmountInput {
  let s = raw.replace(/[\s\u00a0\u202f]/g, "");
  if (!s) return { ok: false, problem: "empty" };
  if (s.includes(",")) {
    const commas = s.split(",").length - 1;
    const point = s.includes(".");
    if (GROUPED_AMOUNT.test(s)) {
      if (!point && commas === 1) return { ok: false, problem: "ambiguous" };
      s = s.replace(/,/g, "");
    } else if (commas === 1 && !point) {
      s = s.replace(",", ".");
    } else {
      return { ok: false, problem: "format" };
    }
  }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[1] && !m[2]) || m[1].length > MAX_AMOUNT_INTEGER_DIGITS) return { ok: false, problem: "format" };
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > clampDecimals(maxDecimals)) return { ok: false, problem: "decimals" };
  const whole = (m[1] || "0").replace(/^0+(?=\d)/, "");
  const value = frac ? `${whole}.${frac}` : whole;
  if (!/[1-9]/.test(value)) return { ok: false, problem: "zero" };
  return { ok: true, value };
}

/** `GET /ramp` limits for one direction (amount = what the person gives: BYN on-ramp, tokens off-ramp). */
export interface LimitFigures {
  min: string;
  max: string;
  dailyRemaining: string;
  monthlyRemaining: string;
}

export type LimitProblem = { kind: "min" | "max" | "daily" | "monthly" | "card" | "bank"; bound: string };

/** The first limit `amount` breaks (min, max, then what is left today and this month), or null. */
export function checkAmountLimits(amount: string, limits: LimitFigures | null | undefined): LimitProblem | null {
  if (!limits) return null;
  if (compareDecimal(amount, limits.min) === -1) return { kind: "min", bound: limits.min };
  if (compareDecimal(amount, limits.max) === 1) return { kind: "max", bound: limits.max };
  if (compareDecimal(amount, limits.dailyRemaining) === 1) return { kind: "daily", bound: limits.dailyRemaining };
  if (compareDecimal(amount, limits.monthlyRemaining) === 1) return { kind: "monthly", bound: limits.monthlyRemaining };
  return null;
}

/** A destination's own cap: a card takes back at most what its purchases can still refund, a bank account what exposure leaves. */
export function checkCap(amount: string, cap: string | null | undefined, kind: "card" | "bank"): LimitProblem | null {
  return cap != null && compareDecimal(amount, cap) === 1 ? { kind, bound: cap } : null;
}

// ---------------------------------------------------------------------------
// Quotes: a reply only counts for the inputs it was asked for
// ---------------------------------------------------------------------------

export interface QuoteInputs {
  direction: string;
  amount: string;
  method?: string | null;
  destination?: string | null;
}

export function quoteInputsKey(q: QuoteInputs): string {
  return [q.direction, q.amount, q.method ?? "", q.destination ?? ""].join("|");
}

/**
 * A quote reply is shown only when it is the latest request AND was asked for what the form
 * shows now: a slow reply for 100 must not land over the one for 1000, and a buy quote must not
 * appear under Cash out with fiat and token swapped.
 */
export function isCurrentQuote(replySeq: number, latestSeq: number, replyKey: string, currentKey: string): boolean {
  return replySeq === latestSeq && replyKey === currentKey;
}

// ---------------------------------------------------------------------------
// Links and images from the provider: checked again before anything renders them
// ---------------------------------------------------------------------------

const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * An absolute `https:` URL (or `http:` on localhost, for a dev backend), without credentials;
 * null for anything else. React 18 still renders `javascript:` hrefs, so every link that came
 * from the backend or the provider (checkout redirect, terms) passes through here first.
 */
export function safeExternalUrl(raw: unknown, opts: { allowHttpLocalhost?: boolean } = {}): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && (opts.allowHttpLocalhost ?? true) && LOCAL_HOSTS.has(url.hostname)) return url.href;
  return null;
}

/**
 * Schemes a bank-app link may never use, whatever the backend let through (it refuses the same
 * set, X15): script and data URLs, local files and blobs, plain http, and browser-internal pages.
 */
const FORBIDDEN_LINK_SCHEMES: ReadonlySet<string> = new Set([
  "javascript",
  "data",
  "vbscript",
  "file",
  "blob",
  "about",
  "http",
  "filesystem",
  "view-source",
  "chrome",
  "jar",
  "ws",
  "wss",
  "ftp",
]);
const LINK_SCHEME_RE = /^[a-z][a-z0-9+.-]{0,31}$/;

/**
 * An ERIP bank-app link (`next.deeplinks[].url`): https as `safeExternalUrl` allows it, or a
 * custom app scheme (`belarusbank://…`) that is not one of the forbidden ones and carries no
 * credentials; null otherwise. The backend validated it against RAMP_DEEPLINK_SCHEMES first.
 */
export function safeDeeplinkUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme === "https") return safeExternalUrl(raw, { allowHttpLocalhost: false });
  if (!LINK_SCHEME_RE.test(scheme) || FORBIDDEN_LINK_SCHEMES.has(scheme) || url.username || url.password) return null;
  return url.href;
}

/** The base64 of the PNG signature (89 50 4E 47 0D 0A 1A 0A) followed by IHDR's leading zero byte. */
const PNG_BASE64_PREFIX = "iVBORw0KGgo";
export const QR_PNG_MAX_BYTES = 64 * 1024;

/** An ERIP QR image as a `data:image/png` URL: real base64, PNG magic, at most 64 KB; null otherwise. */
export function safePngDataUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const b64 = raw
    .trim()
    .replace(/^data:image\/png;base64,/i, "")
    .replace(/\s+/g, "");
  if (!b64.startsWith(PNG_BASE64_PREFIX) || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const bytes = (b64.length / 4) * 3 - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
  return bytes <= QR_PNG_MAX_BYTES ? `data:image/png;base64,${b64}` : null;
}

// ---------------------------------------------------------------------------
// The order page's polling schedule
// ---------------------------------------------------------------------------

export const POLL_MIN_MS = 2_500;
export const POLL_MAX_MS = 30_000;

const FINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "expired",
  "cancelled",
  "refunded",
  "chargeback",
]);
/** Steps measured in hours or business days (a hold, a bank batch, an ERIP payment): polled at the slowest rate. */
const SLOW_STATUSES: ReadonlySet<string> = new Set(["needs_review", "payout_queued", "payout_sent"]);

/** Nothing about the order changes any more; the page stops polling. */
export function isFinalStatus(status: string): boolean {
  return FINAL_STATUSES.has(status);
}

/** The wait before the next poll: 2.5 s doubling to 30 s while nothing changes (`idleTicks`); slow steps start at 30 s. */
export function pollDelayMs(idleTicks: number, status: string, method?: string | null): number {
  if (SLOW_STATUSES.has(status) || (status === "awaiting_payment" && method === "erip")) return POLL_MAX_MS;
  const doublings = Math.max(0, Math.min(10, Math.trunc(idleTicks)));
  return Math.min(POLL_MAX_MS, POLL_MIN_MS * 2 ** doublings);
}

/**
 * After a failed poll: `stop` on a definitive 4xx (a malformed or foreign id, a lost session — it
 * will not fix itself), `retry` with backoff on the network, 5xx, 408 and 429.
 */
export function pollFailureVerdict(httpStatus: number): "stop" | "retry" {
  return httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 429 ? "stop" : "retry";
}

/** A reply older than the order on screen (a poll that raced a Cancel) must not overwrite it. */
export function isStaleReply(reply: { updatedAt: string }, shown: { updatedAt: string } | null): boolean {
  if (!shown) return false;
  const a = Date.parse(reply.updatedAt);
  const b = Date.parse(shown.updatedAt);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

// ---------------------------------------------------------------------------
// Timeline and countdown
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  status: string;
  at: string;
}

/**
 * The order's history in time order, with consecutive steps that read the same to the person
 * (minting and crediting are both "Payment received") collapsed into the first one.
 */
export function collapseTimeline(
  entries: readonly TimelineEntry[] | null | undefined,
  labelOf: (status: string) => string,
): { label: string; at: string; status: string }[] {
  const sorted = [...(entries ?? [])]
    .filter((e) => e && typeof e.status === "string" && Number.isFinite(Date.parse(e.at)))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at) || a.i - b.i);
  const out: { label: string; at: string; status: string }[] = [];
  for (const { e } of sorted) {
    const label = labelOf(e.status);
    if (out.length > 0 && out[out.length - 1].label === label) continue;
    out.push({ label, at: e.at, status: e.status });
  }
  return out;
}

/** Time left in words: `2 d 3 h`, `5 h 07 min`, `14 min`, `45 s`; `0 s` once it has passed. */
export function formatCountdown(msLeft: number): string {
  const s = Number.isFinite(msLeft) && msLeft > 0 ? Math.floor(msLeft / 1000) : 0;
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min`;
  return `${s % 60} s`;
}

// ---------------------------------------------------------------------------
// Consent, retry keys, selections
// ---------------------------------------------------------------------------

/** The consent step as the form holds it; the two declarations start unanswered on purpose. */
export interface ConsentForm {
  termsAccepted: boolean;
  actsForSelf: boolean | null;
  principal: string;
  pepDeclared: boolean | null;
  pepDetail: string;
}

export interface ConsentBody {
  termsVersion: string;
  actsForSelf: boolean;
  principal?: string;
  pepDeclared: boolean;
  pepDetail?: string;
}

export const CONSENT_TEXT_MAX = 500;

export type ConsentCheck =
  | { ok: true; body: ConsentBody }
  | { ok: false; missing: "terms" | "actsForSelf" | "principal" | "pep" };

/** `POST /ramp/consent` from the form, or which answer is still missing (someone acting for another names them). */
export function consentBody(form: ConsentForm, termsVersion: string): ConsentCheck {
  if (!form.termsAccepted) return { ok: false, missing: "terms" };
  if (form.actsForSelf === null) return { ok: false, missing: "actsForSelf" };
  const principal = form.principal.trim().slice(0, CONSENT_TEXT_MAX);
  if (!form.actsForSelf && !principal) return { ok: false, missing: "principal" };
  if (form.pepDeclared === null) return { ok: false, missing: "pep" };
  const pepDetail = form.pepDetail.trim().slice(0, CONSENT_TEXT_MAX);
  return {
    ok: true,
    body: {
      termsVersion,
      actsForSelf: form.actsForSelf,
      ...(form.actsForSelf ? {} : { principal }),
      pepDeclared: form.pepDeclared,
      ...(form.pepDeclared && pepDetail ? { pepDetail } : {}),
    },
  };
}

// getRandomValues comes from the DOM lib, whose signature changes between TypeScript releases
// (5.9 dropped `| null`); CI installs the newest 5.x, as there is no lockfile.
type RandomSource = Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string };

/**
 * A fresh retry token for one order attempt (`web-<uuid>`). `crypto.randomUUID` exists only on
 * secure origins; an http LAN dev server or a cleartext app URL falls back to getRandomValues
 * instead of throwing during render.
 */
export function newIdempotencyKey(source: RandomSource | undefined = globalThis.crypto): string {
  if (source?.randomUUID) {
    try {
      return `web-${source.randomUUID()}`;
    } catch {
      // Not a secure context: fall through to getRandomValues.
    }
  }
  const bytes = new Uint8Array(16);
  if (source?.getRandomValues) source.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `web-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Keep the chosen id while it is still offered (a removed card must not stay selected); else the first one. */
export function keepSelection(current: string, ids: readonly string[]): string {
  return ids.includes(current) ? current : (ids[0] ?? "");
}
