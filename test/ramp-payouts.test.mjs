/**
 * The payee's payout statuses after review wave 9 (C8 / C11): the backend folds every internal
 * hold — a freeze, a compliance review, the payout gate — into the one neutral `processing`, and
 * `lastError` is null except a fixed sentence for `failed`. frontend/lib/inAppWallet.ts must read
 * it like any other wait: the same words, the same pill, cancel allowed, never a hint of why.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const wallet = await import("../frontend/lib/inAppWallet.ts");

const TIPPING_OFF = /review|compliance|aml|suspicious|frozen|freeze|sanction|gate|investigat/i;
const CID = `00${"22".repeat(32)}`;
const payout = (status, extra = {}) => ({
  pendingPayoutCid: CID,
  payeeParty: "user::1220aa",
  walletId: "w1",
  instrument: { admin: "t::1220aa", id: "cBYN", symbol: "cBYN", decimals: 6 },
  amount: "5.0000000000",
  reason: "withdraw",
  status,
  retryAfterKyc: false,
  attempts: 0,
  lastError: null,
  firstSeenAt: "2026-10-19T10:00:00Z",
  settledAt: null,
  onLedger: true,
  ...extra,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
function answer(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return calls;
}

describe("payee payout status `processing` (C8 / C11)", () => {
  it("is a known status, worded exactly like the holds it hides", () => {
    assert.equal(wallet.isPayoutStatus("processing"), true);
    const sentence = wallet.payoutBlockedSentence("processing");
    assert.equal(sentence, wallet.payoutBlockedSentence("blocked_compliance"));
    assert.equal(sentence, wallet.payoutBlockedSentence("blocked_payout_gate"));
    assert.doesNotMatch(sentence, TIPPING_OFF);
    assert.match(sentence, /cancel it back into your in-app balance/);
  });

  it("shows the Processing pill, and an unknown code the same, never as-is", () => {
    assert.deepEqual(wallet.payoutStatusView(payout("processing")), { label: "Processing", tone: "pending" });
    assert.deepEqual(wallet.payoutStatusView(payout("blocked_compliance")), wallet.payoutStatusView(payout("processing")));
    assert.deepEqual(wallet.payoutStatusView(payout("blocked_sanctions_v9")), { label: "Processing", tone: "pending" });
    assert.deepEqual(wallet.payoutStatusView(payout("blocked_kyc")), { label: "Waiting for identity verification", tone: "warn", verifyLink: true });
    assert.equal(wallet.payoutStatusView(payout("settled_in_app")).label, "Settled");
    assert.equal(wallet.payoutStatusView(payout("failed")).tone, "bad");
    assert.deepEqual(wallet.payoutStatusView(undefined), { label: "Queued", tone: "neutral" });
  });

  it("lets the payee cancel a held (processing) withdrawal, never one in flight or settled", () => {
    for (const s of ["processing", "blocked_compliance", "blocked_payout_gate", "blocked_ramp_exposure", "blocked_kyc"])
      assert.equal(wallet.payoutCancelAllowed(payout(s)), true, s);
    assert.equal(wallet.payoutCancelAllowed(payout("queued")), true, "untouched queued row");
    assert.equal(wallet.payoutCancelAllowed(payout("queued", { attempts: 1 })), false, "the processor started on it");
    for (const s of ["settling", "settled_external", "settled_in_app", "failed", "archived"])
      assert.equal(wallet.payoutCancelAllowed(payout(s)), false, s);
    assert.equal(wallet.payoutCancelAllowed(undefined), false, "not indexed yet: the backend may settle it within a scan");
  });

  it("reports a settle answered `processing` as parked, in the neutral words", async () => {
    let calls = answer(200, { payout: payout("processing"), mode: "external" });
    const parked = await wallet.settlePayoutWithBackend(CID);
    assert.equal(calls[0].url, `/__backend/api/v1/in-app-wallet/payouts/${CID}/settle`);
    assert.deepEqual(parked, {
      settled: false,
      mode: "external",
      status: "processing",
      blocked: "processing",
      detail: wallet.payoutBlockedSentence("processing"),
    });
    // The settle 409 names the payee's status in details (block() and a lost race send `processing`).
    calls = answer(409, { error: "payout_blocked", message: "this payout cannot be settled right now", details: { status: "processing" } });
    const refused = await wallet.settlePayoutWithBackend(CID);
    assert.equal(refused.blocked, "processing");
    assert.equal(refused.detail, wallet.payoutBlockedSentence("processing"));
    assert.equal(calls.length, 1);
  });

  it("words a payout_blocked error carrying `processing` like any wait", async () => {
    answer(409, { error: "payout_blocked", message: "x", details: { status: "processing", reason: "in_flight" } });
    const e = await wallet.fetchBackendPayouts().catch((err) => err);
    assert.equal(wallet.moneyErrorMessage(e), wallet.payoutBlockedSentence("processing"));
    assert.doesNotMatch(wallet.moneyErrorMessage(e), TIPPING_OFF);
  });
});
