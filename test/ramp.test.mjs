/**
 * The ramp client and its wording (frontend/lib/ramp.ts): status words per direction and rail,
 * the neutral wording of every hold and compliance reason (no tipping-off), labels that print fiat
 * with its own two decimals, error sentences that name their figure, the API calls (paths, bodies,
 * the Idempotency-Key, the `{order}` envelope), the payout statuses of lib/inAppWallet.ts, and the
 * security headers in vercel.json.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const ramp = await import("../frontend/lib/ramp.ts");
const wallet = await import("../frontend/lib/inAppWallet.ts");
const { BackendError } = await import("../frontend/lib/backend.ts");

const token = { admin: "t::1220" + "a".repeat(64), id: "cBYN", symbol: "cBYN", decimals: 6 };
const order = (over = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  direction: "onramp",
  status: "completed",
  reviewStep: null,
  method: "card",
  rail: null,
  instrument: token,
  fiatCurrency: "BYN",
  fiatAmount: "100.0000000000",
  tokenAmount: "98.0000000000",
  feeAmount: "2.0000000000",
  next: null,
  withdraw: null,
  destination: null,
  card: { brand: "VISA", last4: "4242" },
  payoutReference: "TO-123456789012",
  expiresAt: null,
  timeline: [],
  operator: { name: "TruthOracle LLC" },
  createdAt: "2026-10-17T00:00:00Z",
  updatedAt: "2026-10-17T00:00:00Z",
  completedAt: null,
  ...over,
});
const view = (status, direction = "onramp", rail = null) => ramp.rampStatusView({ status, direction, rail });
// Words that would tell a person their order is being looked at for compliance.
const TIPPING_OFF = /review|compliance|aml|suspicious|frozen|freeze|sanction|check(ed|ing)? by|investigat/i;

describe("ramp status words", () => {
  it("words a status for the direction and rail the person took", () => {
    assert.deepEqual(view("completed"), { label: "Credited", tone: "ok" });
    assert.deepEqual(view("completed", "offramp"), { label: "Paid out", tone: "ok" });
    assert.equal(view("refunded", "offramp").label, "Returned to your balance");
    assert.equal(view("payout_queued", "offramp", "bank").label, "Queued for bank transfer");
    assert.equal(view("payout_sent", "offramp", "bank").label, "Sent by bank transfer");
    assert.equal(view("payout_queued", "onramp").label, "Refund queued");
    assert.equal(view("payout_sent", "onramp").label, "Refund sent");
    assert.equal(view("awaiting_withdrawal", "offramp").label, "Waiting for your signature");
    assert.equal(ramp.rampTimelineLabel({ direction: "onramp" }, "created"), "Order opened");
  });

  it("shows every hold and review exactly like ordinary processing", () => {
    for (const s of ["needs_review", "withdrawing", "burning", "something_new"]) {
      assert.deepEqual(view(s, "offramp"), { label: "Processing", tone: "pending" }, s);
      assert.doesNotMatch(ramp.rampStatusSentence(order({ status: s, direction: "offramp" })), TIPPING_OFF, s);
    }
    assert.doesNotMatch(ramp.rampStatusSentence(order({ status: "needs_review" })), TIPPING_OFF);
  });

  it("says what happens next, by method and rail", () => {
    assert.match(ramp.rampStatusSentence(order({ status: "awaiting_payment", method: "erip" })), /in ERIP/);
    assert.match(ramp.rampStatusSentence(order({ status: "awaiting_payment" })), /card page/);
    assert.match(ramp.rampStatusSentence(order({ status: "expired", method: "erip" })), /Do not pay it/);
    assert.match(ramp.rampStatusSentence(order({ status: "payout_sent", direction: "offramp", rail: "bank" }), { bankDays: 2 }), /within 2 business days/);
    assert.match(ramp.rampStatusSentence(order({ status: "payout_sent", direction: "offramp", rail: "bank" })), /within a few business days/);
    assert.match(ramp.rampStatusSentence(order({ status: "completed", direction: "offramp", rail: "bank" })), /bank account/);
    assert.match(ramp.rampStatusSentence(order({ status: "completed", direction: "offramp", rail: "card" })), /back to your card/);
    assert.match(ramp.rampStatusSentence(order({ status: "awaiting_withdrawal", direction: "offramp" })), /Nothing leaves your balance until you sign/);
    assert.equal(ramp.rampOrderTitle(order({ direction: "offramp", rail: "bank" })), "Cash-out to bank account");
    assert.equal(ramp.rampOrderTitle(order({ method: "erip" })), "ERIP purchase");
    assert.equal(ramp.rampOrderTitle(null), "Order");
  });
});

describe("ramp eligibility reasons", () => {
  it("names only identity, consent and wallet steps; everything else is one neutral sentence", () => {
    assert.equal(ramp.rampReasonSentence("kyc_required"), "Verify your identity first.");
    assert.match(ramp.rampReasonSentence("additional_info_required"), /refresh/);
    assert.equal(ramp.rampReasonSentence("consent_required"), "Accept the terms first.");
    for (const r of ["compliance", "user_suspended", "frozen", "edd_required", "kyc_duplicate_identity", "something_new"]) {
      assert.equal(ramp.rampReasonSentence(r), ramp.RAMP_NEUTRAL_SENTENCE, r);
      assert.doesNotMatch(ramp.rampReasonSentence(r), new RegExp(r.replace(/_/g, ".")), "never echoes the code");
    }
    assert.equal(ramp.rampReasonNeedsVerification("additional_info_required"), true);
    assert.equal(ramp.rampReasonNeedsVerification("compliance"), false);
    assert.deepEqual(
      ramp.rampReasonSentences(["compliance", "user_suspended", "kyc_required"]).map((l) => l.reason),
      ["compliance", "kyc_required"],
      "two neutral reasons read as one line",
    );
  });
});

describe("ramp labels", () => {
  it("prints fiat with its own two decimals, from the string", () => {
    assert.equal(ramp.fiatLabel("12.5000000000", "BYN"), "12.50 BYN");
    assert.equal(ramp.fiatLabel("1250", "BYN"), "1,250.00 BYN");
    assert.equal(ramp.rampFeeLabel({ bps: 0, fixed: "0.0000000000" }, "BYN"), "free");
    assert.equal(ramp.rampFeeLabel({ bps: 150, fixed: "0.3000000000" }, "BYN"), "1.5% + 0.30 BYN");
    assert.equal(ramp.rampFeeLabel({ bps: 0, fixed: "1.0000000000" }, "BYN"), "1.00 BYN");
    assert.equal(ramp.rampFeeLabel(null, "BYN"), "free");
    assert.equal(ramp.cardLabel({ brand: "VISA", last4: "4242", expMonth: 3, expYear: 2030 }), "VISA •••• 4242 (03/30)");
    assert.equal(ramp.cardLabel({ brand: null, last4: null }), "Card •••• ????");
    assert.equal(ramp.bankAccountLabel({ bankName: "Belarusbank", ibanMasked: "BY•• •••• … 0933" }), "Belarusbank BY•• •••• … 0933");
    assert.equal(ramp.ttlLabel(30), "30 min");
    assert.equal(ramp.ttlLabel(1440), "1 d");
    assert.equal(ramp.ttlLabel(120), "2 h");
    assert.equal(ramp.amountInputSentence("empty", 2), null);
    assert.match(ramp.amountInputSentence("decimals", 2), /at most 2 decimals/);
    assert.match(ramp.amountInputSentence("ambiguous", 2), /thousands without a comma \(1500\)/);
  });

  it("says where a bank account stands, with its usable-from time in UTC", () => {
    const cooling = ramp.bankAccountStatusView({ status: "cooling_off", usableFrom: "2026-10-20T09:30:00Z", proof: null });
    assert.equal(cooling.label, "Usable from Oct 20, 2026, 09:30 UTC");
    assert.equal(ramp.bankAccountStatusView({ status: "pending_proof", usableFrom: null, proof: null }).label, "Waiting for confirmation");
    assert.match(ramp.bankAccountStatusView({ status: "active", usableFrom: null, proof: "payer_match" }).detail, /payment from this account/);
    assert.match(ramp.bankAccountStatusView({ status: "active", usableFrom: null, proof: "manual" }).detail, /our team/);
    const blocked = ramp.bankAccountStatusView({ status: "blocked", usableFrom: null, proof: null });
    assert.equal(blocked.label, "Not available");
    assert.doesNotMatch(blocked.detail, TIPPING_OFF);
  });
});

describe("ramp error sentences", () => {
  const err = (status, code, details) => new BackendError(status, code, "server words", details);
  it("names the figure of the limit, cap or exposure it hit", () => {
    assert.equal(
      ramp.rampErrorMessage(err(409, "ramp_limit_exceeded", { limit: "daily", available: "12.5000000000" })),
      "This is above what is left of your daily limit (12.50 left).",
    );
    assert.equal(ramp.rampErrorMessage(err(400, "validation_failed", { min: "10.0000000000", max: "2000.0000000000" })), "Enter an amount between 10.00 and 2,000.00.");
    assert.match(ramp.rampErrorMessage(err(409, "ramp_exposure", { withdrawableToBank: "40.0000000000" })), /^Up to 40\.00 can go to a bank account now\. BYN bought by card/);
    assert.equal(ramp.rampErrorMessage(err(409, "ramp_card_cashout_limit", { available: "75.0000000000" })), "Up to 75.00 can go back to this card. Send the rest to a bank account.");
    assert.match(ramp.rampErrorMessage(err(409, "ramp_order_open", { orderId: "o-1" })), /already have an order waiting/);
    assert.equal(ramp.openOrderIdOf(err(409, "ramp_order_open", { orderId: "o-1" })), "o-1");
    assert.equal(ramp.openOrderIdOf(err(409, "ramp_order_state", { orderId: "o-1" })), null);
    assert.match(ramp.rampErrorMessage(err(503, "ramp_paused")), /paused/);
    assert.match(ramp.rampErrorMessage(err(401, "recent_auth_required")), /sign in again/);
  });

  it("keeps an ineligible account's sentence neutral", () => {
    assert.equal(ramp.rampErrorMessage(err(403, "ramp_not_eligible", { reasons: ["compliance"] })), ramp.RAMP_NEUTRAL_SENTENCE);
    assert.equal(ramp.rampErrorMessage(err(403, "ramp_not_eligible", { reasons: ["kyc_required"] })), "Verify your identity first.");
    assert.equal(ramp.rampErrorMessage(err(403, "ramp_not_eligible")), ramp.RAMP_NEUTRAL_SENTENCE);
    assert.doesNotMatch(ramp.rampErrorMessage(err(403, "ramp_not_eligible")), TIPPING_OFF);
  });

  it("turns limit problems and a quote's own verdict into sentences", () => {
    assert.equal(ramp.limitProblemSentence({ kind: "min", bound: "10" }, "BYN"), "The smallest amount is 10.00 BYN.");
    assert.equal(ramp.limitProblemSentence({ kind: "monthly", bound: "300" }, "cBYN"), "This is above what is left of your monthly limit: 300.00 cBYN.");
    const quote = (limit) => ({ fiatAmount: "1", tokenAmount: "1", fee: "0", withinLimits: false, limit });
    assert.equal(ramp.quoteLimitSentence({ ...quote(null), withinLimits: true }, "BYN"), null);
    assert.equal(ramp.quoteLimitSentence(quote({ name: "daily", available: "5" }), "BYN"), "This is above what is left of your daily limit: 5.00 BYN.");
    assert.match(ramp.quoteLimitSentence(quote({ name: "card_cashout", available: "7" }), "BYN"), /^Up to 7\.00 BYN can go back to this card/);
    assert.match(ramp.quoteLimitSentence(quote({ name: "mystery" }), "BYN"), /above what this order can take/);
  });
});

describe("ramp calls", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  function stub(reply) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(reply(String(url), init)), { status: 200, headers: { "content-type": "application/json" } });
    };
    return calls;
  }

  it("opens a purchase with its Idempotency-Key, method and expected figure, and unwraps {order}", async () => {
    const calls = stub(() => ({ order: order({ status: "awaiting_payment", next: { kind: "redirect", url: "https://pay.test/x" } }) }));
    const res = await ramp.startOnramp({ amount: "100", method: "erip", expectedTokenAmount: "98", idempotencyKey: "web-abc12345" });
    assert.equal(res.next.url, "https://pay.test/x");
    assert.equal(calls[0].url, "/__backend/api/v1/ramp/onramp");
    assert.equal(calls[0].init.headers["idempotency-key"], "web-abc12345");
    assert.equal(calls[0].init.headers["x-requested-with"], "truthoracle");
    assert.deepEqual(JSON.parse(calls[0].init.body), { amount: "100", method: "erip", expectedTokenAmount: "98" });
  });

  it("opens a cash-out with a destination, and never sends a card id for a bank payout", async () => {
    const calls = stub(() => ({ order: order({ direction: "offramp", status: "awaiting_withdrawal" }) }));
    await ramp.startOfframp({ amount: "50", destination: { kind: "bank", bankAccountId: "ba-1" }, expectedFiatAmount: "49", idempotencyKey: "web-k2345678" });
    assert.equal(calls[0].url, "/__backend/api/v1/ramp/offramp");
    assert.equal(calls[0].init.headers["idempotency-key"], "web-k2345678");
    assert.deepEqual(JSON.parse(calls[0].init.body), { amount: "50", destination: { kind: "bank", bankAccountId: "ba-1" }, expectedFiatAmount: "49" });
  });

  it("reads orders, cards and bank accounts out of their envelopes, ids escaped", async () => {
    const calls = stub((url) =>
      url.includes("/orders?")
        ? { orders: [order()], nextCursor: "c2" }
        : url.includes("/orders/")
          ? { order: order({ id: "x/y" }) }
          : url.endsWith("/payment-methods")
            ? { cards: [{ id: "c1" }] }
            : url.endsWith("/bank-accounts")
              ? { accounts: [{ id: "b1" }] }
              : {},
    );
    assert.equal((await ramp.fetchRampOrder("x/y")).id, "x/y");
    assert.equal(calls[0].url, "/__backend/api/v1/ramp/orders/x%2Fy");
    const page = await ramp.fetchRampOrders({ cursor: "c 1", limit: 5 });
    assert.equal(page.nextCursor, "c2");
    assert.equal(calls[1].url, "/__backend/api/v1/ramp/orders?limit=5&cursor=c+1");
    assert.deepEqual(await ramp.fetchRampCards(), [{ id: "c1", cashout: { mode: "none", available: "0" } }]);
    assert.deepEqual(await ramp.fetchBankAccounts(), [{ id: "b1" }]);
  });

  it("refuses a 2xx without the order it promised", async () => {
    stub(() => ({}));
    await assert.rejects(ramp.fetchRampOrder("o"), (e) => e instanceof BackendError && e.code === "invalid_response");
  });

  it("posts consent, quotes, bank accounts, cancels and attaches to their paths", async () => {
    const calls = stub((url) =>
      url.includes("/bank-accounts")
        ? { account: { id: "b9" } }
        : url.includes("/attach")
          ? { order: order(), bindPending: false, bindReason: null }
          : url.includes("/orders/")
            ? { order: order() }
            : { consent: { required: false } },
    );
    await ramp.submitRampConsent({ termsVersion: "2026-10", actsForSelf: true, pepDeclared: false });
    assert.deepEqual(JSON.parse(calls[0].init.body), { termsVersion: "2026-10", actsForSelf: true, pepDeclared: false });
    await ramp.quoteRamp({ direction: "offramp", amount: "10", destination: { kind: "card", paymentMethodId: "c1" } });
    assert.deepEqual(JSON.parse(calls[1].init.body), { direction: "offramp", amount: "10", destination: { kind: "card", paymentMethodId: "c1" } });
    assert.equal((await ramp.addBankAccount({ iban: "BY13NBRB3600900000002Z00AB00", nameForm: "lat" })).id, "b9");
    assert.deepEqual(JSON.parse(calls[2].init.body), { iban: "BY13NBRB3600900000002Z00AB00", nameForm: "lat" });
    await ramp.cancelRampOrder("o1");
    await ramp.attachWithdrawal("o1", "00cid");
    assert.equal((await ramp.removeBankAccount("b9")).id, "b9", "DELETE answers the removed {account}");
    await ramp.removeRampCard("c1");
    assert.deepEqual(
      calls.slice(3).map((c) => `${c.init.method} ${c.url}`),
      [
        "POST /__backend/api/v1/ramp/orders/o1/cancel",
        "POST /__backend/api/v1/ramp/orders/o1/attach",
        "DELETE /__backend/api/v1/ramp/bank-accounts/b9",
        "DELETE /__backend/api/v1/ramp/payment-methods/c1",
      ],
    );
    assert.deepEqual(JSON.parse(calls[4].init.body), { pendingPayoutCid: "00cid" });
  });
});

describe("payout statuses and headers", () => {
  it("knows the v2 payout holds and words the compliance one like any wait", () => {
    for (const s of ["blocked_ramp_exposure", "blocked_compliance"]) assert.equal(wallet.isPayoutStatus(s), true, s);
    assert.equal(wallet.isPayoutStatus("blocked_ramp_hold"), false, "the v1 72-hour hold is gone");
    assert.match(wallet.payoutBlockedSentence("blocked_ramp_exposure"), /card dispute window/);
    assert.doesNotMatch(wallet.payoutBlockedSentence("blocked_compliance"), TIPPING_OFF);
  });

  it("vercel.json forbids framing and trims the Referer on every route", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    const all = config.headers.find((h) => h.source === "/(.*)");
    const get = (k) => all.headers.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value;
    assert.equal(get("Content-Security-Policy"), "frame-ancestors 'none'");
    assert.equal(get("Referrer-Policy"), "strict-origin-when-cross-origin");
  });
});

describe("ramp overview normalisation", () => {
  const v2 = {
    enabled: true,
    paused: { orders: false, reason: null },
    provider: "mock",
    operator: { name: "TruthOracle LLC", termsUrl: "https://truthoracle.io/terms", termsVersion: "2026-10" },
    consent: { required: true, termsVersion: "2026-10", termsUrl: "https://truthoracle.io/terms" },
    instrument: token,
    fiat: { currency: "BYN", decimals: 2 },
    methods: [{ method: "card", ttlMinutes: 30, fee: { bps: 0, fixed: "0" } }, { method: "krok", ttlMinutes: 5, fee: { bps: 0, fixed: "0" } }],
    rails: [{ rail: "bank", fee: { bps: 0, fixed: "1" }, eta: { businessDays: 2 } }],
    limits: {
      onramp: { min: "10", max: "2000", dailyMax: "2000", monthlyMax: "3000", dailyRemaining: "500", monthlyRemaining: "900" },
      offramp: {},
    },
    exposure: { amount: "40", withdrawableToBank: "10" },
    eligibility: { onramp: { allowed: true, reasons: [] }, offramp: { allowed: false, reasons: ["compliance", 7] } },
    openOrders: [order()],
  };

  it("keeps a v2 answer, dropping methods and junk it does not know", () => {
    const o = ramp.normalizeOverview(v2);
    assert.equal(o.enabled, true);
    assert.deepEqual(o.methods.map((m) => m.method), ["card"], "KROK is out of scope");
    assert.equal(o.rails[0].eta.businessDays, 2);
    assert.deepEqual(o.limits.onramp, { min: "10", max: "2000", dailyMax: "2000", monthlyMax: "3000", dailyRemaining: "500", monthlyRemaining: "900" });
    assert.deepEqual(
      o.limits.offramp,
      { min: "0", max: "0", dailyMax: "0", monthlyMax: "0", dailyRemaining: "0", monthlyRemaining: "0" },
      "missing limits fail closed",
    );
    assert.deepEqual(o.eligibility.offramp, { allowed: false, reasons: ["compliance"] });
    assert.equal(o.consent.required, true);
    assert.equal(o.openOrders.length, 1);
  });

  it("degrades a partial or broken answer instead of throwing, and never keeps the halt's reason", () => {
    // A v1-shaped answer (bare reason lists, no methods / rails) is not the v2 contract: closed, not guessed.
    const v1 = { enabled: true, provider: "mock", instrument: token, fees: {}, holdHours: 72, eligibility: { onramp: [], offramp: ["no_payout_card"] }, openOrders: [] };
    const o = ramp.normalizeOverview(v1);
    assert.deepEqual(o.methods, []);
    assert.deepEqual(o.rails, []);
    assert.deepEqual(o.eligibility.onramp, { allowed: false, reasons: [] });
    assert.deepEqual(o.eligibility.offramp, { allowed: false, reasons: [] });
    assert.deepEqual(o.paused, { orders: false, reason: null });
    assert.deepEqual(ramp.normalizeOverview({ ...v2, paused: { orders: true, reason: "ops: statement stale" } }).paused, { orders: true, reason: null });
    for (const junk of [null, "x", 42, []]) {
      const n = ramp.normalizeOverview(junk);
      assert.equal(n.enabled, false);
      assert.equal(n.eligibility.onramp.allowed, false, "unknown eligibility is closed");
      assert.deepEqual(n.fiat, { currency: "BYN", decimals: 2 });
    }
  });

  it("gives every card a cash-out figure, and reads only the {cards} / {accounts} / {orders} envelopes", async () => {
    const realFetch = globalThis.fetch;
    const answer = (body) => async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    try {
      globalThis.fetch = answer({ cards: [{ id: "c1", brand: "VISA", last4: "1" }, { id: "c2", cashout: { mode: "refund", available: "5" } }] });
      const cards = await ramp.fetchRampCards();
      assert.deepEqual(cards.map((c) => c.cashout), [{ mode: "none", available: "0" }, { mode: "refund", available: "5" }]);
      // A bare list is not the contract: the screen says the list could not load instead of guessing.
      globalThis.fetch = answer([{ id: "c1" }]);
      await assert.rejects(ramp.fetchRampCards(), (e) => e instanceof BackendError && e.code === "invalid_response");
      globalThis.fetch = answer([{ id: "b1" }]);
      await assert.rejects(ramp.fetchBankAccounts(), (e) => e instanceof BackendError && e.code === "invalid_response");
      globalThis.fetch = answer({ items: [] });
      await assert.rejects(ramp.fetchRampOrders(), (e) => e instanceof BackendError && e.code === "invalid_response");
      globalThis.fetch = answer({ orders: [], nextCursor: null });
      assert.deepEqual(await ramp.fetchRampOrders(), { orders: [], nextCursor: null });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("F3 alignment: the final backend's order view", () => {
  it("reads a held order (statusText processing) as processing, except where the next step is the person's", () => {
    for (const status of ["paying_out", "crediting", "payout_queued", "refunding", "withdrawing"]) {
      const held = order({ status, direction: "offramp", rail: "card", statusText: "processing" });
      assert.deepEqual(ramp.rampStatusView(held), { label: "Processing", tone: "pending" }, status);
      assert.doesNotMatch(ramp.rampStatusSentence(held), TIPPING_OFF, status);
      assert.match(ramp.rampStatusSentence(held), /taking longer than usual/, status);
    }
    // The signature and the payment are still the person's to give, hold or not.
    assert.equal(ramp.rampStatusView(order({ status: "awaiting_withdrawal", direction: "offramp", statusText: "processing" })).label, "Waiting for your signature");
    assert.equal(ramp.rampStatusView(order({ status: "paying_out", direction: "offramp", rail: "card", statusText: null })).label, "Paying to your card");
    // A past timeline entry is worded for its own status, not for today's hold.
    assert.equal(ramp.rampTimelineLabel({ direction: "offramp", rail: "card", method: null, statusText: "processing" }, "paying_out"), "Paying to your card");
  });

  it("names the bank's first-payout cap, the name form and stale terms instead of a generic refusal", () => {
    const err = (status, code, details) => new BackendError(status, code, "server words", details);
    assert.equal(
      ramp.rampErrorMessage(err(409, "ramp_limit_exceeded", { limit: "bank_first_payout", max: "500.0000000000", available: "120.0000000000" })),
      "Until a first payout to this bank account has arrived, it can take at most 500.00 in total (120.00 left). Send less, or use another account.",
    );
    assert.doesNotMatch(ramp.rampErrorMessage(err(409, "ramp_limit_exceeded", { limit: "bank_first_payout", available: "1" })), /bank_first_payout/);
    assert.equal(
      ramp.rampErrorMessage(err(400, "validation_failed", { nameForms: ["ru", "lat"] })),
      "Your verified name is not on file in that spelling. Choose Russian (Cyrillic) or Latin, as in your passport.",
    );
    const stale = err(400, "validation_failed", { termsVersion: "2026-11" });
    assert.match(ramp.rampErrorMessage(stale), /terms were updated/);
    assert.equal(ramp.isStaleTermsError(stale), true);
    assert.equal(ramp.isStaleTermsError(err(400, "validation_failed", { min: "1", max: "2" })), false);
  });

  it("says why a bank account or rail cannot take a payout, in UTC", () => {
    const rail = (details) => ramp.rampErrorMessage(new BackendError(409, "ramp_rail_unavailable", "x", details));
    assert.equal(
      rail({ rail: "bank", reason: "bank_account_cooling_off", usableFrom: "2026-10-20T09:30:00Z" }),
      "This bank account can receive payouts from Oct 20, 2026, 09:30 UTC.",
    );
    assert.match(rail({ rail: "bank", reason: "bank_account_pending_proof", usableFrom: null }), /not confirmed as yours yet/);
    assert.match(rail({ rail: "bank", reason: "bank_account_blocked" }), /cannot receive payouts at the moment/);
    assert.match(rail({ rail: "bank", reason: "bank_blocked" }), /another bank/);
    assert.match(rail({ rail: "card" }), /to a card are not available/);
    assert.match(rail({}), /payout method is not available/, "no details: the base sentence");
    assert.match(ramp.rampErrorMessage(new BackendError(503, "ramp_unavailable", "x", { reason: "method_unavailable", method: "erip" })), /payment method is not available/);
    assert.equal(ramp.rampErrorMessage(new BackendError(409, "bank_account_limit", "x", { max: 2 })), "You can keep at most 2 bank accounts. Remove one first.");
    assert.match(ramp.rampErrorMessage(new BackendError(409, "bank_account_limit", "x", { perDay: 5 })), /at most 5 bank accounts a day/);
    // A screen words a code for itself: removing a card is not an order.
    assert.match(ramp.rampErrorMessage(new BackendError(409, "ramp_order_state", "x"), { ramp_order_state: "Card busy." }), /^Card busy\.$/);
  });

  it("shows the card exposure a plain withdrawal of the ramp token runs into, for that token only", () => {
    const overview = { instrument: token, exposure: { amount: "60.0000000000", withdrawableToBank: "40.0000000000" } };
    const x = ramp.withdrawExposureFor(overview, { admin: token.admin, id: token.id });
    assert.deepEqual(x, { exposure: "60.0000000000", withdrawable: "40.0000000000" });
    assert.equal(ramp.withdrawExceedsExposure(x, "40.0000000000"), false);
    assert.equal(ramp.withdrawExceedsExposure(x, "40.0000000001"), true);
    assert.equal(ramp.withdrawExposureFor(overview, { admin: token.admin, id: "TRO" }), null, "another instrument");
    assert.equal(ramp.withdrawExposureFor({ ...overview, exposure: { amount: "0.0000000000", withdrawableToBank: "100" } }, token), null, "nothing inside the window");
    assert.equal(ramp.withdrawExposureFor(null, token), null);
  });

  it("knows the payout gate's hold and words it like any wait", () => {
    assert.equal(wallet.isPayoutStatus("blocked_payout_gate"), true);
    assert.equal(wallet.payoutBlockedSentence("blocked_payout_gate"), wallet.payoutBlockedSentence("blocked_compliance"));
  });

  it("links the mock acquirer's test page for an ERIP order by the order's own id, and posts the ERIP knobs", async () => {
    assert.equal(ramp.mockCheckoutHref("o-1", { method: "erip" }), "/wallet/ramp/mock-checkout?payment=o-1&order=o-1&method=erip");
    assert.equal(ramp.mockCheckoutHref("o-1", { paymentId: "p-9" }), "/wallet/ramp/mock-checkout?payment=p-9&order=o-1");
    const realFetch = globalThis.fetch;
    const calls = [];
    try {
      globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ delivered: true }), { status: 200, headers: { "content-type": "application/json" } });
      };
      assert.deepEqual(await ramp.completeMockPayment("o-1", { outcome: "succeeded", channel: "cash" }), { delivered: true });
      assert.deepEqual(calls, [{ url: "/__backend/api/v1/ramp/mock/payments/o-1/complete", body: { outcome: "succeeded", channel: "cash" } }]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
