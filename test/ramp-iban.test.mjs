/**
 * The browser's Belarusian IBAN check (frontend/lib/iban.ts): normalisation (spaces, case, the
 * Cyrillic look-alikes a ru/be keyboard types), the BY shape (28 characters), the ISO 13616
 * mod-97 check digits, the bank code, grouping and masking, and the sentence per problem.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);

const iban = await import("../frontend/lib/iban.ts");

// The IBAN registry's example for Belarus, and two more with valid check digits.
const REGISTRY = "BY13NBRB3600900000002Z00AB00";
const OLMP = "BY20OLMP31350000001000000933";
const AKBB = "BY86AKBB10100000002966000000";

describe("iban: normalise", () => {
  it("drops spaces and dashes, upper-cases, folds Cyrillic look-alikes", () => {
    assert.equal(iban.normalizeIban(" by13 nbrb-3600 9000\u00a00000 2z00 ab00 "), REGISTRY);
    // "BY" typed on a Cyrillic layout (U+0412 U+0423), and a Cyrillic A (U+0410) inside the account part.
    assert.equal(iban.normalizeIban("\u0412\u042313NBRB3600900000002Z00\u0410B00"), REGISTRY);
  });
});

describe("iban: checkByIban", () => {
  it("accepts valid BY IBANs and returns the bank code (characters 5-8)", () => {
    assert.deepEqual(iban.checkByIban(REGISTRY), { ok: true, iban: REGISTRY, bankCode: "NBRB" });
    assert.deepEqual(iban.checkByIban("by20 olmp 3135 0000 0010 0000 0933"), { ok: true, iban: OLMP, bankCode: "OLMP" });
    assert.equal(iban.checkByIban(AKBB).ok, true);
    assert.equal(iban.ibanMod97(REGISTRY), 1);
  });

  it("names the problem: empty, another country, length, characters, check digits", () => {
    assert.equal(iban.checkByIban("   ").problem, "empty");
    assert.equal(iban.checkByIban("GB82WEST12345698765432").problem, "country", "a valid foreign IBAN is still refused");
    assert.equal(iban.checkByIban(REGISTRY.slice(0, 27)).problem, "length");
    assert.equal(iban.checkByIban(REGISTRY + "0").problem, "length");
    assert.equal(iban.checkByIban("BY13NBRB36X0900000002Z00AB00").problem, "format", "the balance account is 4 digits");
    assert.equal(iban.checkByIban("BY13NBRB3600900000002Z00AB0*").problem, "format");
  });

  it("catches a single mistyped character and a swap of neighbours", () => {
    assert.equal(iban.checkByIban("BY13NBRB3600900000002Z00AB01").problem, "checksum");
    assert.equal(iban.checkByIban("BY31NBRB3600900000002Z00AB00").problem, "checksum");
    assert.equal(iban.checkByIban("BY20OLMP31350000001000000393").problem, "checksum");
  });

  it("says what to fix, and nothing for an empty field", () => {
    assert.equal(iban.ibanProblemSentence("empty"), null);
    assert.match(iban.ibanProblemSentence("country"), /starts with BY/);
    assert.equal(iban.ibanProblemSentence("length", "BY13"), "A Belarusian IBAN has 28 characters; this one has 4.");
    assert.match(iban.ibanProblemSentence("checksum"), /typo/);
    assert.match(iban.ibanProblemSentence("format"), /characters/);
  });
});

describe("iban: display", () => {
  it("groups by four and masks like the server", () => {
    assert.equal(iban.formatIbanGroups(REGISTRY), "BY13 NBRB 3600 9000 0000 2Z00 AB00");
    assert.equal(iban.formatIbanGroups("by13nb"), "BY13 NB");
    assert.equal(iban.maskIban(REGISTRY), "BY•• •••• … AB00");
    assert.equal(iban.maskIban("BY13"), "");
  });
});
