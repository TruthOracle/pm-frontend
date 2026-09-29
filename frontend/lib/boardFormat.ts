/**
 * Formatting helpers for the trending event board (components/TrendingEventBoard.tsx). Pure
 * functions, covered by test/board-format.test.mjs.
 */

/** Kalshi-style "Pays out" figure for a Yes share bought at `price`: 1 / price, e.g. 0.64 → "1.56x". */
export function payoutMultiplier(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  const x = 1 / Math.min(1, price);
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return `${x.toFixed(digits)}x`;
}

/** Up to `max` initials of the leading words ("Fed rate decisions" → "FR"); "?" when empty. */
export function initialsOf(text: string, max = 2): string {
  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.slice(0, max).map((w) => w[0]!.toUpperCase());
  return letters.length ? letters.join("") : "?";
}

/** The first `count` sentences of `text`, capped at `maxChars` with an ellipsis. */
export function leadSentences(text: string, count = 2, maxChars = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [clean];
  let out = sentences.slice(0, count).join("").trim();
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1).trimEnd()}…`;
  return out;
}

/** What a row calls the outcome: the Yes label unless it is the bare word "Yes", else the question. */
export function outcomeLabel(m: { yesSubTitle: string; question: string }): string {
  return m.yesSubTitle && m.yesSubTitle.trim().toLowerCase() !== "yes" ? m.yesSubTitle : m.question;
}
