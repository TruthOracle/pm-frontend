/**
 * Unit tests for the instrument helpers (frontend/lib/instruments.ts): money formatted next to
 * the instrument it is in, quantisation to an instrument's decimals and the catalog lookups the
 * components share.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const inst = await import("../frontend/lib/instruments.ts");

const CC = { admin: "dso::1220aa", id: "Amulet", symbol: "CC", name: "Canton Coin", decimals: 10 };
const BYN = { admin: "agent::1220bb", id: "cBYN", symbol: "cBYN", name: "Canton Belarusian Ruble", decimals: 6 };
const TRO = { admin: "issuer::1220cc", id: "TRO", symbol: "TRO", name: "TruthOracle Token", decimals: 6 };
const catalog = [
  { ...CC, kind: "collateral", enabled: true, isDefaultCollateral: false, walletInstrumentId: "Amulet" },
  { ...BYN, kind: "collateral", enabled: true, isDefaultCollateral: true, walletInstrumentId: "cBYN" },
  { ...TRO, kind: "rewards", enabled: true, isDefaultCollateral: false, walletInstrumentId: "TRO" },
];

describe("formatAmount / formatMoney", () => {
  it("groups thousands, trims trailing zeros and shows at most the instrument's decimals", () => {
    assert.equal(inst.formatAmount("1250.0000000000", BYN), "1,250");
    assert.equal(inst.formatAmount("0.5000000000", CC), "0.5");
    assert.equal(inst.formatAmount("1234.5678912345", CC), "1,234.5678912345");
    assert.equal(inst.formatAmount("1234.5678912345", BYN), "1,234.567891");
    // A view may ask for fewer decimals (a ticket shows two), never for more than the instrument has.
    assert.equal(inst.formatAmount(1.23456, BYN, 2), "1.23");
    assert.equal(inst.formatAmount(1.23456789, BYN, 8), "1.234568");
    assert.equal(inst.formatMoney("5.0000000000", CC), "5 CC");
    assert.equal(inst.formatMoney(7, null), "7");
  });
  it("prints nothing, a non-number and negative zero as 0", () => {
    assert.equal(inst.formatAmount(null, CC), "0");
    assert.equal(inst.formatAmount(undefined, CC), "0");
    assert.equal(inst.formatAmount("", CC), "0");
    assert.equal(inst.formatAmount(Number.NaN, CC), "0");
    assert.equal(inst.formatAmount(-0, CC), "0");
    assert.equal(inst.formatAmount(-0.00000000001, BYN), "0");
  });
});

describe("quantizeAmount / amountStep", () => {
  it("floors to the instrument's decimals so a withdrawal never carries dust the treasury would keep", () => {
    assert.equal(inst.quantizeAmount(1.23456789, 6), 1.234567);
    assert.equal(inst.quantizeAmount(0.1 + 0.2, 6), 0.3);
    assert.equal(inst.quantizeAmount(5, 0), 5);
    assert.equal(inst.quantizeAmount(0.0000001, 6), 0);
    assert.equal(inst.quantizeAmount(Number.NaN, 6), 0);
    assert.equal(inst.amountStep(BYN), "0.000001");
    assert.equal(inst.amountStep({ decimals: 0 }), "1");
    assert.equal(inst.amountStep(null), "0.0000000001");
  });
  it("never quantises finer than the ledger's 10 dp and keeps whole-unit instruments whole", () => {
    // A registry claiming more decimals than the ledger carries is capped at 10; the step follows.
    assert.equal(inst.quantizeAmount(1.23456789012345, 18), 1.2345678901);
    assert.equal(inst.amountStep({ decimals: 18 }), "0.0000000001");
    assert.equal(inst.quantizeAmount(7.999, 0), 7);
    // Negative or infinite input never becomes a withdrawal amount above zero.
    assert.equal(inst.quantizeAmount(-1.5, 6), -1.5);
    assert.equal(inst.quantizeAmount(Number.POSITIVE_INFINITY, 6), 0);
    // Flooring, not rounding: 0.9999999 at six decimals is 0.999999, never 1.
    assert.equal(inst.quantizeAmount(0.9999999, 6), 0.999999);
  });
  it("formats with the instrument's scale even when a view asks for more, and groups large figures", () => {
    assert.equal(inst.formatAmount("1234567.1234567890", CC), "1,234,567.123456789");
    assert.equal(inst.formatAmount("1234567.1234567890", BYN), "1,234,567.123457");
    assert.equal(inst.formatAmount("1234567.1234567890", { decimals: 0 }), "1,234,567");
    assert.equal(inst.formatAmount(0.000001, BYN), "0.000001");
    assert.equal(inst.formatAmount(0.0000001, BYN), "0");
    // An unknown instrument prints at the ledger's own 10 dp.
    assert.equal(inst.formatAmount("0.1234567891", null), "0.1234567891");
    assert.equal(inst.formatMoney("2.5000000000", TRO, 0), "3 TRO");
  });
});

describe("catalog lookups", () => {
  it("picks the flagged default collateral, else the first enabled collateral, else nothing", () => {
    assert.equal(inst.defaultCollateral(catalog)?.symbol, "cBYN");
    assert.equal(inst.defaultCollateral(catalog.filter((i) => i.symbol !== "cBYN"))?.symbol, "CC");
    assert.equal(inst.defaultCollateral([catalog[2]]), null);
    assert.equal(inst.defaultCollateral(undefined), null);
    assert.deepEqual(inst.enabledCollaterals(catalog).map((i) => i.symbol), ["CC", "cBYN"]);
    assert.equal(inst.rewardsInstrument(catalog)?.symbol, "TRO");
  });
  it("resolves a ledger identity to the catalog's display data and keeps the fallback otherwise", () => {
    const fromLedger = inst.instrumentRefFromId({ admin: CC.admin, id: CC.id });
    assert.deepEqual(fromLedger, { admin: CC.admin, id: CC.id, symbol: "Amulet", name: "Amulet", decimals: 10 });
    assert.equal(inst.resolveInstrument(catalog, fromLedger).symbol, "CC");
    const unknown = inst.instrumentRefFromId({ admin: "x::1", id: "FOO" });
    assert.equal(inst.resolveInstrument(catalog, unknown), unknown);
    assert.equal(inst.instrumentForWalletId(catalog, "Amulet")?.symbol, "CC");
    assert.equal(inst.instrumentForWalletId(catalog, "nope"), null);
    // The wallet's id for a token: the catalog's mapping, else the token id itself.
    assert.equal(inst.walletInstrumentId(catalog[0]), "Amulet");
    assert.equal(inst.walletInstrumentId({ id: "cBYN", walletInstrumentId: "" }), "cBYN");
  });
  it("labels, keys and identity", () => {
    assert.equal(inst.instrumentLabel(CC), "Canton Coin (CC)");
    assert.equal(inst.instrumentLabel({ symbol: "TRO", name: "TRO" }), "TRO");
    assert.equal(inst.instrumentKey(CC), `${CC.admin}:Amulet`);
    assert.ok(inst.sameInstrument(CC, { admin: CC.admin, id: "Amulet" }));
    assert.ok(!inst.sameInstrument(CC, BYN));
    assert.ok(!inst.sameInstrument(CC, null));
  });
  it("adds amounts up per instrument, in first-seen order", () => {
    const totals = inst.sumByInstrument([
      { instrument: CC, amount: 1 },
      { instrument: BYN, amount: 2 },
      { instrument: CC, amount: 3.5 },
    ]);
    assert.deepEqual(
      totals.map((t) => [t.instrument.symbol, t.amount]),
      [
        ["CC", 4.5],
        ["cBYN", 2],
      ],
    );
  });
});
