/**
 * The browser's check of a Belarusian IBAN before it is sent (truthoracle-backend docs/RAMP.md §10.1;
 * the server's src/util/iban.ts and its bank directory stay the authority). It catches typos while
 * the person is still looking at their bank app: wrong country, wrong length, stray characters, and
 * the ISO 13616 mod-97 check digits, which catch any single mistyped character and most swaps.
 *
 * A BY IBAN is 28 characters: `BY`, two check digits, the bank's 4-letter code (the first four
 * letters of its BIC), a 4-digit balance account and a 16-character account number. Pure functions,
 * tested in test/ramp-iban.test.mjs.
 */

export const BY_IBAN_LENGTH = 28;

/**
 * Cyrillic capitals that look like the Latin ones an IBAN uses. A ru/be keyboard layout types
 * them silently ("ВY…"); folding them here keeps a correct-looking IBAN from failing as "format".
 */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  У: "Y",
  Х: "X",
  І: "I",
};

/** Upper case, no spaces or dashes, Cyrillic look-alikes folded: the form the server is sent. */
export function normalizeIban(raw: string): string {
  return Array.from(raw.toUpperCase().replace(/[\s\u00a0\u202f-]/g, ""))
    .map((ch) => HOMOGLYPHS[ch] ?? ch)
    .join("");
}

/** ISO 7064 mod 97-10 over the rearranged IBAN (letters A=10 … Z=35); a valid IBAN leaves 1. */
export function ibanMod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const digits = code >= 48 && code <= 57 ? ch : code >= 65 && code <= 90 ? String(code - 55) : null;
    if (digits === null) return -1;
    for (const d of digits) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem;
}

export type IbanProblem = "empty" | "country" | "length" | "format" | "checksum";

export type IbanCheck =
  | { ok: true; iban: string; bankCode: string }
  | { ok: false; iban: string; problem: IbanProblem };

const BY_IBAN_SHAPE = /^BY\d{2}[A-Z0-9]{4}\d{4}[A-Z0-9]{16}$/;

/** Normalise and check one typed IBAN; `bankCode` is characters 5–8 (the BIC prefix). */
export function checkByIban(raw: string): IbanCheck {
  const iban = normalizeIban(raw);
  if (!iban) return { ok: false, iban, problem: "empty" };
  if (!iban.startsWith("BY")) return { ok: false, iban, problem: "country" };
  if (iban.length !== BY_IBAN_LENGTH) return { ok: false, iban, problem: "length" };
  if (!BY_IBAN_SHAPE.test(iban)) return { ok: false, iban, problem: "format" };
  if (ibanMod97(iban) !== 1) return { ok: false, iban, problem: "checksum" };
  return { ok: true, iban, bankCode: iban.slice(4, 8) };
}

/** What to tell the person about a problem (null when there is nothing to say yet). */
export function ibanProblemSentence(problem: IbanProblem, iban = ""): string | null {
  switch (problem) {
    case "empty":
      return null;
    case "country":
      return "Payouts go only to Belarusian accounts: the IBAN starts with BY.";
    case "length":
      return `A Belarusian IBAN has ${BY_IBAN_LENGTH} characters; this one has ${iban.length}.`;
    case "format":
      return "This IBAN has characters that do not belong in it. Copy it again from your bank app.";
    case "checksum":
      return "This IBAN has a typo: its check digits do not match. Copy it again from your bank app.";
  }
}

/** Groups of four for reading: `BY13 NBRB 3600 9000 0000 2Z00 AB00`. */
export function formatIbanGroups(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})(?=.)/g, "$1 ");
}

/** The masked form the server also returns: `BY•• •••• … 1234`. */
export function maskIban(iban: string): string {
  const n = normalizeIban(iban);
  return n.length < 8 ? "" : `${n.slice(0, 2)}•• •••• … ${n.slice(-4)}`;
}
