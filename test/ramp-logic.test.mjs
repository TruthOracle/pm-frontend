/**
 * Pure ramp logic (frontend/lib/rampLogic.ts): exact decimals (no float ever touches an amount
 * that is signed or compared), the amount input, limit and destination caps, the stale-quote
 * guard, the checks on provider links and QR images, the polling schedule, timeline collapsing,
 * the countdown, the consent body, retry keys on insecure origins, and selection keeping.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);

const logic = await import("../frontend/lib/rampLogic.ts");

describe("rampLogic: exact decimals", () => {
  it("reads wire decimals as 1e-10 units and back, without floats", () => {
    assert.equal(logic.toUnits("12.5000000000"), 125_000_000_000n);
    assert.equal(logic.toUnits("1234567.89"), 12_345_678_900_000_000n);
    assert.equal(logic.toUnits("0.00000000010"), 1n, "zeros past 10 dp are tolerated");
    assert.equal(logic.toUnits("0.00000000001"), null, "finer than the wire is refused");
    assert.equal(logic.toUnits("-3"), -30_000_000_000n);
    for (const junk of ["", "abc", "1e3", ".5", "1.2.3", null, undefined, 12]) assert.equal(logic.toUnits(junk), null);
    assert.equal(logic.fromUnits(12_345_678_900_000_000n), "1234567.8900000000");
    assert.equal(logic.fromUnits(-5n), "-0.0000000005");
  });

  it("compares and formats exactly", () => {
    assert.equal(logic.compareDecimal("10", "9.9999999999"), 1);
    assert.equal(logic.compareDecimal("2000.0000000000", "2000"), 0);
    assert.equal(logic.compareDecimal("0.1", "0.2"), -1);
    assert.equal(logic.compareDecimal("x", "1"), null);
    assert.equal(logic.isPositiveDecimal("0.0000000001"), true);
    assert.equal(logic.isPositiveDecimal("0.0000000000"), false);
    assert.equal(logic.formatFixed("1250.5000000000", 2), "1,250.50");
    assert.equal(logic.formatFixed("1250.5", 2, false), "1250.50");
    assert.equal(logic.formatFixed("0.3000000000", 2), "0.30");
    assert.equal(logic.formatFixed("12.999", 2), "12.99", "truncates, never rounds up");
    assert.equal(logic.formatFixed("1234567.89", 2), "1,234,567.89");
    assert.equal(logic.formatFixed("5", 0), "5");
    assert.equal(logic.formatFixed(null, 2), "—");
  });

  it("passes the exact amount to Daml: 1234567.89 never becomes 1234567.8899999999", () => {
    assert.equal(Number("1234567.89").toFixed(10), "1234567.8899999999", "the float path the v1 code took");
    assert.equal(logic.damlDecimalString("1234567.89"), "1234567.8900000000");
    assert.equal(logic.damlDecimalString("98.0000000000"), "98.0000000000");
    assert.throws(() => logic.damlDecimalString("0"), /positive/);
    assert.throws(() => logic.damlDecimalString("-1"), /positive/);
    assert.throws(() => logic.damlDecimalString("1e3"), /positive/);
  });

  it("matches a ledger amount to the wire amount at the instrument's scale", () => {
    assert.equal(logic.ledgerAmountEquals(12.5, "12.5000000000", 6), true);
    assert.equal(logic.ledgerAmountEquals(0.1 + 0.2, "0.3000000000", 6), true, "float noise below the scale is ignored");
    assert.equal(logic.ledgerAmountEquals(12.5, "12.5000010000", 6), false);
    assert.equal(logic.ledgerAmountEquals(12.5, "12.5000000001", 6), false, "finer than the instrument never matches");
    assert.equal(logic.ledgerAmountEquals(NaN, "1", 6), false);
    assert.equal(logic.ledgerAmountEquals(1234567.89, "1234567.8900000000", 6), true);
  });
});

describe("rampLogic: amount input and limits", () => {
  it("normalises what the person typed", () => {
    assert.deepEqual(logic.parseAmountInput("12,50", 2), { ok: true, value: "12.5" });
    assert.deepEqual(logic.parseAmountInput(" 1 250 ", 2), { ok: true, value: "1250" });
    assert.deepEqual(logic.parseAmountInput("007.10", 2), { ok: true, value: "7.1" });
    assert.deepEqual(logic.parseAmountInput(".5", 2), { ok: true, value: "0.5" });
    assert.deepEqual(logic.parseAmountInput("12.", 2), { ok: true, value: "12" });
    assert.deepEqual(logic.parseAmountInput("", 2), { ok: false, problem: "empty" });
    assert.deepEqual(logic.parseAmountInput("1,250.50", 2), { ok: true, value: "1250.5" }, "grouping before a point: one reading");
    assert.deepEqual(logic.parseAmountInput("1234567890", 2), { ok: false, problem: "format" });
    assert.deepEqual(logic.parseAmountInput("1.234", 2), { ok: false, problem: "decimals" });
    assert.deepEqual(logic.parseAmountInput("0.00", 2), { ok: false, problem: "zero" });
    assert.deepEqual(logic.parseAmountInput("-5", 2), { ok: false, problem: "format" });
  });

  it("never reads a thousands comma as a decimal point (review F13)", () => {
    // The forms print limits as 2,000.00 BYN, so "1,500" may mean fifteen hundred: refused, never 1.5.
    for (const typed of ["1,500", "15,000", "999,999", " 2,000 "]) {
      assert.deepEqual(logic.parseAmountInput(typed, 2), { ok: false, problem: "ambiguous" }, typed);
    }
    assert.deepEqual(logic.parseAmountInput("1,250,000", 2), { ok: true, value: "1250000" }, "two groups: grouping only");
    assert.deepEqual(logic.parseAmountInput("12,5", 2), { ok: true, value: "12.5" }, "decimal comma");
    assert.deepEqual(logic.parseAmountInput(",5", 2), { ok: true, value: "0.5" });
    assert.deepEqual(logic.parseAmountInput("1234,56", 2), { ok: true, value: "1234.56" }, "four digits first: no grouping");
    assert.deepEqual(logic.parseAmountInput("0,505", 2), { ok: false, problem: "decimals" }, "leading zero: a decimal comma");
    for (const junk of ["1.250,50", "1,2,3", "1,25,000", "12,50.1"]) {
      assert.deepEqual(logic.parseAmountInput(junk, 2), { ok: false, problem: "format" }, junk);
    }
  });

  it("names the first limit an amount breaks", () => {
    const limits = { min: "10.0000000000", max: "2000.0000000000", dailyRemaining: "500.0000000000", monthlyRemaining: "300.0000000000" };
    assert.deepEqual(logic.checkAmountLimits("5", limits), { kind: "min", bound: "10.0000000000" });
    assert.deepEqual(logic.checkAmountLimits("5000", limits), { kind: "max", bound: "2000.0000000000" });
    assert.deepEqual(logic.checkAmountLimits("600", limits), { kind: "daily", bound: "500.0000000000" });
    assert.deepEqual(logic.checkAmountLimits("400", limits), { kind: "monthly", bound: "300.0000000000" });
    assert.equal(logic.checkAmountLimits("10", limits), null, "bounds are inclusive");
    assert.equal(logic.checkAmountLimits("300", limits), null);
    assert.equal(logic.checkAmountLimits("300", null), null);
    assert.deepEqual(logic.checkCap("150.01", "150.0000000000", "card"), { kind: "card", bound: "150.0000000000" });
    assert.equal(logic.checkCap("150", "150.0000000000", "bank"), null);
    assert.equal(logic.checkCap("150", null, "bank"), null);
  });

  it("shows a quote only for the latest request and the inputs on screen", () => {
    const k100 = logic.quoteInputsKey({ direction: "onramp", amount: "100", method: "card" });
    const k1000 = logic.quoteInputsKey({ direction: "onramp", amount: "1000", method: "card" });
    const kOff = logic.quoteInputsKey({ direction: "offramp", amount: "1000", destination: "bank:1" });
    assert.equal(logic.isCurrentQuote(2, 2, k1000, k1000), true);
    assert.equal(logic.isCurrentQuote(1, 2, k100, k1000), false, "a slow reply for 100 after the one for 1000");
    assert.equal(logic.isCurrentQuote(2, 2, k1000, kOff), false, "a buy quote under Cash out");
    assert.notEqual(k1000, logic.quoteInputsKey({ direction: "onramp", amount: "1000", method: "erip" }));
  });
});

describe("rampLogic: provider links and images", () => {
  it("allows https, and http only on localhost; never script, data or credentials", () => {
    assert.equal(logic.safeExternalUrl("https://checkout.bepaid.by/v2/x?token=1"), "https://checkout.bepaid.by/v2/x?token=1");
    assert.equal(logic.safeExternalUrl("http://localhost:5173/wallet/ramp/mock-checkout"), "http://localhost:5173/wallet/ramp/mock-checkout");
    assert.equal(logic.safeExternalUrl("http://localhost:5173/x", { allowHttpLocalhost: false }), null);
    for (const bad of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:x",
      "file:///etc/passwd",
      "http://pay.example.com/x",
      "https://user:pw@pay.example.com/",
      "/wallet/ramp/1",
      "//evil.example/x",
      "",
      null,
      42,
    ])
      assert.equal(logic.safeExternalUrl(bad), null, String(bad));
  });

  it("accepts a QR only as real PNG base64 under 64 KB", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]).toString("base64");
    assert.equal(logic.safePngDataUrl(png), `data:image/png;base64,${png}`);
    assert.equal(logic.safePngDataUrl(`data:image/png;base64,${png}`), `data:image/png;base64,${png}`);
    assert.equal(logic.safePngDataUrl(Buffer.from("GIF89a....").toString("base64")), null, "not a PNG");
    assert.equal(logic.safePngDataUrl(`${png}"><script>`), null, "not base64");
    const big = Buffer.concat([Buffer.from(png, "base64"), Buffer.alloc(70_000)]).toString("base64");
    assert.equal(logic.safePngDataUrl(big), null, "over 64 KB");
    assert.equal(logic.safePngDataUrl(undefined), null);
  });

  it("opens an ERIP bank-app link only as https or a bank-app scheme, never script, data, http or credentials", () => {
    assert.equal(logic.safeDeeplinkUrl("belarusbank://erip/pay?code=100001&account=123456789012"), "belarusbank://erip/pay?code=100001&account=123456789012");
    assert.equal(logic.safeDeeplinkUrl("https://bank.example.by/erip?x=1"), "https://bank.example.by/erip?x=1");
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
      "blob:https://x/1",
      "about:blank",
      "http://bank.example.by/erip",
      "http://localhost:5173/x",
      "https://u:p@bank.example.by/",
      "mybank://u:p@pay/x",
      "/relative/path",
      "",
      null,
    ])
      assert.equal(logic.safeDeeplinkUrl(bad), null, String(bad));
  });
});

describe("rampLogic: polling", () => {
  it("stops only where nothing changes any more", () => {
    for (const s of ["completed", "failed", "expired", "cancelled", "refunded", "chargeback"]) assert.equal(logic.isFinalStatus(s), true, s);
    for (const s of ["awaiting_payment", "needs_review", "payout_queued", "payout_sent", "withdrawing", "reversing"])
      assert.equal(logic.isFinalStatus(s), false, s);
  });

  it("backs off from 2.5 s to 30 s, and starts slow steps at 30 s", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 50].map((n) => logic.pollDelayMs(n, "paying_out")), [2500, 5000, 10000, 20000, 30000, 30000]);
    assert.equal(logic.pollDelayMs(0, "payout_sent"), 30_000);
    assert.equal(logic.pollDelayMs(0, "needs_review"), 30_000);
    assert.equal(logic.pollDelayMs(0, "awaiting_payment", "erip"), 30_000);
    assert.equal(logic.pollDelayMs(0, "awaiting_payment", "card"), 2_500);
  });

  it("gives up on a definitive 4xx and retries everything else", () => {
    for (const s of [400, 401, 403, 404, 409]) assert.equal(logic.pollFailureVerdict(s), "stop", String(s));
    for (const s of [0, 408, 429, 500, 502, 503]) assert.equal(logic.pollFailureVerdict(s), "retry", String(s));
  });

  it("drops a reply older than the order on screen", () => {
    const shown = { updatedAt: "2026-10-19T10:00:05Z" };
    assert.equal(logic.isStaleReply({ updatedAt: "2026-10-19T10:00:01Z" }, shown), true);
    assert.equal(logic.isStaleReply({ updatedAt: "2026-10-19T10:00:05Z" }, shown), false);
    assert.equal(logic.isStaleReply({ updatedAt: "2026-10-19T10:00:09Z" }, shown), false);
    assert.equal(logic.isStaleReply({ updatedAt: "garbage" }, shown), false);
    assert.equal(logic.isStaleReply({ updatedAt: "2026-10-19T10:00:01Z" }, null), false);
  });
});

describe("rampLogic: timeline and countdown", () => {
  it("sorts by time and collapses steps that read the same", () => {
    const label = (s) => ({ paid: "Payment received", minting: "Payment received", crediting: "Payment received" })[s] ?? s;
    const out = logic.collapseTimeline(
      [
        { status: "minting", at: "2026-10-19T10:01:00Z" },
        { status: "awaiting_payment", at: "2026-10-19T10:00:00Z" },
        { status: "paid", at: "2026-10-19T10:00:30Z" },
        { status: "crediting", at: "2026-10-19T10:02:00Z" },
        { status: "completed", at: "2026-10-19T10:03:00Z" },
        { status: "broken", at: "not a date" },
      ],
      label,
    );
    assert.deepEqual(
      out.map((e) => [e.label, e.at]),
      [
        ["awaiting_payment", "2026-10-19T10:00:00Z"],
        ["Payment received", "2026-10-19T10:00:30Z"],
        ["completed", "2026-10-19T10:03:00Z"],
      ],
    );
    assert.deepEqual(logic.collapseTimeline(null, label), []);
  });

  it("counts down in words", () => {
    assert.equal(logic.formatCountdown(2 * 86_400_000 + 3 * 3_600_000 + 5_000), "2 d 3 h");
    assert.equal(logic.formatCountdown(5 * 3_600_000 + 7 * 60_000), "5 h 07 min");
    assert.equal(logic.formatCountdown(14 * 60_000 + 59_000), "14 min");
    assert.equal(logic.formatCountdown(45_500), "45 s");
    assert.equal(logic.formatCountdown(-1), "0 s");
    assert.equal(logic.formatCountdown(NaN), "0 s");
  });
});

describe("rampLogic: consent, keys, selection", () => {
  const blank = { termsAccepted: true, actsForSelf: true, principal: "", pepDeclared: false, pepDetail: "" };
  it("builds the consent body and names what is missing", () => {
    assert.deepEqual(logic.consentBody(blank, "2026-10"), { ok: true, body: { termsVersion: "2026-10", actsForSelf: true, pepDeclared: false } });
    assert.deepEqual(logic.consentBody({ ...blank, termsAccepted: false }, "v"), { ok: false, missing: "terms" });
    assert.deepEqual(logic.consentBody({ ...blank, actsForSelf: null }, "v"), { ok: false, missing: "actsForSelf" });
    assert.deepEqual(logic.consentBody({ ...blank, actsForSelf: false, principal: "  " }, "v"), { ok: false, missing: "principal" });
    assert.deepEqual(logic.consentBody({ ...blank, pepDeclared: null }, "v"), { ok: false, missing: "pep" });
    const other = logic.consentBody({ ...blank, actsForSelf: false, principal: " ACME LLC ", pepDeclared: true, pepDetail: " minister's spouse " }, "v");
    assert.deepEqual(other, { ok: true, body: { termsVersion: "v", actsForSelf: false, principal: "ACME LLC", pepDeclared: true, pepDetail: "minister's spouse" } });
    const long = logic.consentBody({ ...blank, actsForSelf: false, principal: "x".repeat(900) }, "v");
    assert.equal(long.body.principal.length, logic.CONSENT_TEXT_MAX);
  });

  it("makes a retry key on secure and insecure origins alike", () => {
    const shape = /^web-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert.match(logic.newIdempotencyKey(), shape);
    const insecure = {
      randomUUID() {
        throw new TypeError("crypto.randomUUID is not available on insecure origins");
      },
      getRandomValues: (a) => globalThis.crypto.getRandomValues(a),
    };
    assert.match(logic.newIdempotencyKey(insecure), shape);
    assert.match(logic.newIdempotencyKey({ getRandomValues: (a) => a }), /^web-00000000-0000-4000-8000-000000000000$/);
    assert.match(logic.newIdempotencyKey(undefined), shape);
    assert.notEqual(logic.newIdempotencyKey(insecure), logic.newIdempotencyKey(insecure));
  });

  it("keeps a selection only while it is still offered", () => {
    assert.equal(logic.keepSelection("b", ["a", "b"]), "b");
    assert.equal(logic.keepSelection("gone", ["a", "b"]), "a");
    assert.equal(logic.keepSelection("", []), "");
  });
});
