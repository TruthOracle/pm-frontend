/**
 * Unit tests for the frontend's pure TypeScript helpers behind the accounts
 * integration (ARCHITECTURE.md §16 / §18): the backend probe's three answers, the
 * error-code → sentence tables, the KYC status reading, the payout settlement outcome
 * mapping and the party formatter. Imported straight from frontend/lib through the
 * hooks in _support/frontend-loader.mjs — no bundler, no browser: `fetch` is stubbed
 * with real Response objects.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);

globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const { shortPartyId } = await import("../frontend/lib/party.ts");
const backend = await import("../frontend/lib/backend.ts");
const errors = await import("../frontend/lib/backendErrors.ts");
const kyc = await import("../frontend/lib/kyc.ts");
const wallet = await import("../frontend/lib/inAppWallet.ts");

const realFetch = globalThis.fetch;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** Queue of replies (a Response factory or an Error to throw), consumed one per call. */
function stubFetch(...replies) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    if (reply instanceof Error) throw reply;
    return reply();
  };
  return calls;
}

beforeEach(() => backend.resetBackendAvailability());
afterEach(() => {
  globalThis.fetch = realFetch;
  backend.resetBackendAvailability();
});

describe("shortPartyId", () => {
  it("keeps the hint and both ends of the fingerprint", () => {
    const party = `alice::1220${"ab".repeat(32)}`;
    assert.equal(shortPartyId(party), "alice::1220abab…abab");
  });

  it("truncates a long hint and passes short plain strings through", () => {
    assert.equal(shortPartyId(`averyveryverylonghint::1220${"cd".repeat(32)}`), "averyveryver…::1220cdcd…cdcd");
    assert.equal(shortPartyId("short"), "short");
    assert.equal(shortPartyId("x".repeat(30)), `${"x".repeat(10)}…${"x".repeat(6)}`);
  });
});

describe("probeBackend (lib/backend.ts)", () => {
  it("caches 'ok' for the page lifetime", async () => {
    const calls = stubFetch(() => json({ status: "ok" }));
    assert.equal(await backend.probeBackend(), "ok");
    assert.equal(await backend.probeBackend(), "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/__backend/health");
    assert.equal(calls[0].init.credentials, "include");
    assert.equal(calls[0].init.headers["x-requested-with"], "truthoracle");
  });

  it("caches 'unconfigured' on the relay's 503 backend_unconfigured (§4.1)", async () => {
    const calls = stubFetch(() => json({ error: "backend_unconfigured", message: "no BACKEND_URL" }, 503));
    assert.equal(await backend.probeBackend(), "unconfigured");
    assert.equal(await backend.probeBackend(), "unconfigured");
    assert.equal(calls.length, 1);
  });

  it("reports 502 backend_unreachable as 'unreachable' and does NOT cache it", async () => {
    const calls = stubFetch(
      () => json({ error: "backend_unreachable", message: "did not respond" }, 502),
      () => json({ status: "ok" }),
    );
    assert.equal(await backend.probeBackend(), "unreachable");
    // A configured-but-down backend must never look like "no backend": the next
    // refresh re-probes and finds it up.
    assert.equal(await backend.probeBackend(), "ok");
    assert.equal(calls.length, 2);
  });

  it("treats a network error and a plain 5xx as 'unreachable', re-probing each time", async () => {
    const calls = stubFetch(new Error("connect ECONNREFUSED"));
    assert.equal(await backend.probeBackend(), "unreachable");
    assert.equal(await backend.probeBackend(), "unreachable");
    assert.equal(calls.length, 2);

    backend.resetBackendAvailability();
    const html = () => new Response("<html>Bad gateway</html>", { status: 502 });
    const more = stubFetch(html, html);
    assert.equal(await backend.probeBackend(), "unreachable");
    assert.equal(await backend.probeBackend(), "unreachable");
    assert.equal(more.length, 2);
  });

  it("dedupes concurrent callers onto one in-flight probe", async () => {
    const calls = stubFetch(() => json({ status: "ok" }));
    const results = await Promise.all([backend.probeBackend(), backend.probeBackend(), backend.probeBackend()]);
    assert.deepEqual(results, ["ok", "ok", "ok"]);
    assert.equal(calls.length, 1);
  });
});

describe("backendFetch (lib/backend.ts)", () => {
  it("throws a BackendError carrying the server's envelope", async () => {
    stubFetch(() => json({ error: "kyc_required", message: "Verify first", details: { level: "basic" } }, 409));
    await assert.rejects(backend.backendFetch("/api/v1/x", { method: "POST", body: { a: 1 } }), (e) => {
      assert.ok(e instanceof backend.BackendError);
      assert.equal(e.status, 409);
      assert.equal(e.code, "kyc_required");
      assert.equal(e.message, "Verify first");
      assert.deepEqual(e.details, { level: "basic" });
      assert.ok(backend.isBackendError(e, "kyc_required"));
      assert.ok(!backend.isBackendError(e, "forbidden"));
      return true;
    });
  });

  it("sends JSON with the CSRF headers and credentials", async () => {
    const calls = stubFetch(() => json({ ok: true }));
    assert.deepEqual(await backend.backendFetch("/api/v1/auth/logout", { method: "POST", body: { a: 1 } }), { ok: true });
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body, '{"a":1}');
    assert.equal(calls[0].init.headers["content-type"], "application/json");
    assert.equal(calls[0].init.headers["x-requested-with"], "truthoracle");
    assert.equal(calls[0].init.credentials, "include");
  });

  it("replaces an HTML error page with a short generic message", async () => {
    stubFetch(() => new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 }));
    await assert.rejects(backend.backendFetch("/api/v1/me"), (e) => {
      assert.equal(e.code, "http_502");
      assert.equal(e.message, "Backend request failed (502).");
      return true;
    });
  });

  it("refuses a 2xx that is not JSON", async () => {
    stubFetch(() => new Response("<html>login page</html>", { status: 200 }));
    await assert.rejects(backend.backendFetch("/api/v1/me"), (e) => e.code === "invalid_response");
  });

  it("wraps a failed fetch as network_error", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    await assert.rejects(backend.backendFetch("/api/v1/me"), (e) => e.code === "network_error" && e.status === 0);
  });

  it("notifies the unauthenticated listener exactly on 401 unauthenticated", async () => {
    const seen = [];
    const off = backend.onUnauthenticated((e) => seen.push(e.code));
    try {
      stubFetch(
        () => json({ error: "unauthenticated", message: "expired" }, 401),
        () => json({ error: "forbidden", message: "nope" }, 403),
        () => json({ error: "http_401", message: "odd" }, 401),
      );
      await assert.rejects(backend.backendFetch("/api/v1/me"), (e) => e.code === "unauthenticated");
      await assert.rejects(backend.backendFetch("/api/v1/me"), (e) => e.code === "forbidden");
      await assert.rejects(backend.backendFetch("/api/v1/me"), (e) => e.code === "http_401");
      assert.deepEqual(seen, ["unauthenticated"]);
    } finally {
      off();
    }
    stubFetch(() => json({ error: "unauthenticated", message: "expired" }, 401));
    await assert.rejects(backend.backendFetch("/api/v1/me"));
    assert.deepEqual(seen, ["unauthenticated"], "unregistered listener is not called");
  });
});

describe("error sentences (lib/backendErrors.ts)", () => {
  const err = (code, status = 400, message = "server words") => new backend.BackendError(status, code, message);

  it("translates known codes, lets overrides win, and falls back to the server message", () => {
    assert.equal(errors.backendCodeMessage("unauthenticated"), errors.SESSION_EXPIRED_SENTENCE);
    assert.equal(errors.backendCodeMessage("no_such_code"), null);
    assert.equal(errors.backendCodeMessage("last_identity", { last_identity: "custom" }), "custom");
    assert.equal(errors.backendErrorMessage(err("rate_limited", 429)), errors.RATE_LIMITED_SENTENCE);
    assert.equal(errors.backendErrorMessage(err("no_such_code")), "server words");
    assert.equal(errors.backendErrorMessage(new Error("plain")), "plain");
    assert.equal(errors.backendErrorMessage("string"), "string");
  });

  it("names the §11 code 'unauthenticated' (not 'unauthorized') in every flavour", () => {
    assert.equal(errors.accountErrorMessage(err("unauthenticated", 401)), errors.SESSION_EXPIRED_SENTENCE);
    assert.equal(wallet.moneyErrorMessage(err("unauthenticated", 401)), errors.SESSION_EXPIRED_SENTENCE);
    assert.equal(kyc.kycErrorMessage(err("unauthenticated", 401)), errors.SESSION_EXPIRED_SENTENCE);
    assert.equal(errors.backendCodeMessage("unauthorized"), null);
  });

  it("flags only transient failures for automatic retry", () => {
    assert.ok(errors.isTransientBackendError(err("network_error", 0)));
    assert.ok(errors.isTransientBackendError(err("backend_unreachable", 502)));
    assert.ok(errors.isTransientBackendError(err("upstream_failed", 502)));
    assert.ok(errors.isTransientBackendError(err("http_500", 500)));
    assert.ok(!errors.isTransientBackendError(err("backend_unconfigured", 503)));
    assert.ok(!errors.isTransientBackendError(err("unauthenticated", 401)));
    assert.ok(!errors.isTransientBackendError(err("kyc_required", 409)));
    assert.ok(!errors.isTransientBackendError(new Error("plain")));
  });

  it("never names the other account for a KYC duplicate (§9.3)", () => {
    const sentence = errors.backendErrorMessage(err("kyc_duplicate_identity", 409, "bound to alice@example.com"));
    assert.equal(sentence, errors.KYC_DUPLICATE_SENTENCE);
    assert.ok(!sentence.includes("alice"));
  });
});

describe("describeKyc (lib/kyc.ts, §9.2 precedence)", () => {
  const summary = (status, verification = null, extra = {}) => ({
    provider: "sumsub",
    status,
    levelName: "basic-kyc",
    requiredForWithdrawal: true,
    attachedIdentityId: null,
    verification,
    ...extra,
  });
  const verification = (status, extra = {}) => ({
    id: "v1",
    provider: "sumsub",
    levelName: "basic-kyc",
    attemptNo: 1,
    status,
    rejectLabels: [],
    moderationComment: null,
    reviewedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...extra,
  });

  it("lets the account-level status win over the verification", () => {
    const blocked = kyc.describeKyc(summary("blocked_duplicate", verification("approved")));
    assert.equal(blocked.tone, "bad");
    assert.equal(blocked.sentence, kyc.KYC_DUPLICATE_SENTENCE);
    assert.equal(blocked.canStart, false);

    const approved = kyc.describeKyc(summary("approved", verification("rejected_retry")));
    assert.equal(approved.label, "Verified");
    assert.equal(approved.canStart, false);
  });

  it("refines pending by the latest verification", () => {
    assert.equal(kyc.describeKyc(summary("pending", verification("initiated"))).startLabel, "Continue verification");
    assert.equal(kyc.describeKyc(summary("pending", verification("needs_review"))).label, "Manual review");
    const plain = kyc.describeKyc(summary("pending", verification("pending")));
    assert.equal(plain.label, "Under review");
    assert.equal(plain.canStart, false);
  });

  it("distinguishes a final rejection from a retryable one", () => {
    const final = kyc.describeKyc(summary("rejected", verification("rejected_final")));
    assert.equal(final.canStart, false);
    assert.match(final.sentence, /cannot be retried/);
    const retry = kyc.describeKyc(summary("rejected", verification("rejected_retry", { rejectLabels: ["BAD_PHOTO"] })));
    assert.equal(retry.canStart, true);
    assert.equal(retry.startLabel, "Try again");
    assert.match(retry.sentence, /bad_photo/);
  });

  it("says when verification is not configured, and whether withdrawals need it", () => {
    const off = kyc.describeKyc(summary("none", null, { provider: null }));
    assert.equal(off.canStart, false);
    assert.ok(off.sentence.startsWith(kyc.KYC_UNAVAILABLE_SENTENCE));
    const optional = kyc.describeKyc(summary("none", null, { requiredForWithdrawal: false }));
    assert.equal(optional.canStart, true);
    assert.equal(optional.startLabel, "Start verification");
    assert.match(optional.sentence, /optional/);
  });
});

describe("payout helpers (lib/inAppWallet.ts)", () => {
  const CID = `00${"11".repeat(32)}`;
  const payout = (status, extra = {}) => ({
    pendingPayoutCid: CID,
    payeeParty: "user::1220aa",
    walletId: "w1",
    amountCC: "5.0000000000",
    reason: "withdraw",
    status,
    retryAfterKyc: status === "blocked_kyc",
    attempts: 0,
    lastError: null,
    firstSeenAt: "2026-01-01T00:00:00Z",
    settledAt: null,
    onLedger: status === "queued",
    ...extra,
  });

  it("narrows wire strings to the Payout status enum", () => {
    assert.ok(wallet.isPayoutStatus("blocked_kyc"));
    assert.ok(wallet.isPayoutStatus("settled_in_app"));
    assert.ok(!wallet.isPayoutStatus("paid"));
    assert.ok(!wallet.isPayoutStatus(undefined));
    assert.ok(!wallet.isPayoutStatus(42));
  });

  it("explains a blocked payout in the payee's words", () => {
    assert.match(wallet.payoutBlockedSentence("blocked_kyc"), /identity verification/);
    assert.match(wallet.payoutBlockedSentence("blocked_unknown_user"), /not linked to any account/);
    assert.match(wallet.payoutBlockedSentence("settling"), /being sent right now/);
    assert.equal(wallet.payoutBlockedSentence(undefined), "This payout cannot be settled right now.");
  });

  it("resolves payout_blocked through details.status, guarded", () => {
    const blocked = (details) => new backend.BackendError(409, "payout_blocked", "blocked", details);
    assert.equal(wallet.moneyErrorMessage(blocked({ status: "blocked_wallet_revoked" })), wallet.payoutBlockedSentence("blocked_wallet_revoked"));
    assert.equal(wallet.moneyErrorMessage(blocked({ status: "not-a-status" })), wallet.payoutBlockedSentence(undefined));
    assert.equal(wallet.moneyErrorMessage(blocked(undefined)), wallet.payoutBlockedSentence(undefined));
    assert.equal(wallet.moneyErrorMessage(new backend.BackendError(409, "no_primary_wallet", "x")), "Your account has no primary wallet yet. Link a wallet on the Account page before depositing.");
  });

  it("maps a settled response, carrying the mode (external vs in_app)", async () => {
    const calls = stubFetch(() => json({ payout: payout("settled_in_app"), mode: "in_app" }));
    const outcome = await wallet.settlePayoutWithBackend(CID);
    assert.deepEqual(outcome, { settled: true, mode: "in_app", status: "settled_in_app" });
    assert.equal(calls[0].url, `/__backend/api/v1/in-app-wallet/payouts/${CID}/settle`);
    assert.equal(calls[0].init.method, "POST");

    stubFetch(() => json({ payout: payout("settled_external"), mode: "already_settled" }));
    assert.equal((await wallet.settlePayoutWithBackend(CID)).settled, true);
  });

  it("reports a parked payout without throwing", async () => {
    stubFetch(() => json({ payout: payout("blocked_kyc"), mode: "external" }));
    const parked = await wallet.settlePayoutWithBackend(CID);
    assert.equal(parked.settled, false);
    assert.equal(parked.blocked, "blocked_kyc");
    assert.equal(parked.detail, wallet.payoutBlockedSentence("blocked_kyc"));

    stubFetch(() => json({ error: "kyc_required", message: "verify" }, 409));
    const gated = await wallet.settlePayoutWithBackend(CID);
    assert.deepEqual(gated, { settled: false, status: "blocked_kyc", blocked: "kyc", detail: wallet.payoutBlockedSentence("blocked_kyc") });

    stubFetch(() => json({ error: "payout_blocked", message: "x", details: { status: "settling" } }, 409));
    const settling = await wallet.settlePayoutWithBackend(CID);
    assert.equal(settling.blocked, "settling");
    assert.equal(settling.status, "settling");

    stubFetch(() => json({ error: "payout_blocked", message: "x" }, 409));
    assert.equal((await wallet.settlePayoutWithBackend(CID)).blocked, "blocked");

    stubFetch(() => json({ error: "payout_not_found", message: "x" }, 404));
    const unknown = await wallet.settlePayoutWithBackend(CID);
    assert.equal(unknown.settled, false);
    assert.equal(unknown.detail, errors.backendCodeMessage("payout_not_found"));

    stubFetch(new TypeError("Failed to fetch"));
    assert.equal((await wallet.settlePayoutWithBackend(CID)).detail, errors.BACKEND_UNREACHABLE_SENTENCE);
  });
});

describe("creditPendingDeposits (lib/inAppWallet.ts, §8.3 credit-only rail)", () => {
  it("posts the reconcile with no amount and returns the server's answer", async () => {
    const result = { credited: "1.0000000000", status: "confirmed", perWallet: [], ledger: null };
    const calls = stubFetch(() => json(result));
    assert.deepEqual(await wallet.creditPendingDeposits({ windowMs: 0 }), result);
    assert.equal(calls[0].url, "/__backend/api/v1/in-app-wallet/deposits/reconcile");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body, undefined, "the browser never asserts an amount");
  });

  it("returns nothing_outstanding once the window is spent instead of looping", async () => {
    const calls = stubFetch(() => json({ credited: "0.0000000000", status: "nothing_outstanding", perWallet: [], ledger: null }));
    assert.equal((await wallet.creditPendingDeposits({ windowMs: 0 })).status, "nothing_outstanding");
    assert.equal(calls.length, 1);
  });

  it("turns any other failure into a credit-pending error with the translated sentence", async () => {
    stubFetch(() => json({ error: "unauthenticated", message: "expired" }, 401));
    await assert.rejects(wallet.creditPendingDeposits({ windowMs: 0 }), (e) => {
      assert.ok(wallet.isDepositCreditPending(e));
      assert.equal(e.message, errors.SESSION_EXPIRED_SENTENCE);
      return true;
    });

    stubFetch(() => json({ error: "deposit_in_progress", message: "locked" }, 409));
    await assert.rejects(wallet.creditPendingDeposits({ windowMs: 0 }), (e) => {
      assert.ok(wallet.isDepositCreditPending(e));
      assert.match(e.message, /Another deposit is still being credited/);
      return true;
    });
  });
});
