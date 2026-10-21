/**
 * The cash-out step's signed withdrawal (lib/ramp.ts, components/ramp/RampWithdrawStep.tsx):
 *  - R3-03: a withdrawal the backend binds to ANOTHER cash-out (a failed order keeps its binding)
 *    is never taken as this order's signature and attached, and the page never claims support was
 *    notified;
 *  - R3-04: a wallet that did not answer in time settles nothing (its popup may still sign), so it
 *    is no "Not signed — nothing left your balance": the step holds Sign and Cancel as after a
 *    signature and attaches the withdrawal once it shows.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);

const TREASURY = `treasury::1220${"ab".repeat(32)}`;
const USER = `user::1220${"cd".repeat(32)}`;
globalThis.__VITE_ENV__ = {
  VITE_BACKEND_PROXY_URL: "/__backend",
  VITE_ENTERPRISE_WALLET_PARTY_ID: TREASURY,
  VITE_TRUTHORACLE_PACKAGE_NAME: "truthoracle-v17",
};

const ramp = await import("../frontend/lib/ramp.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BYN = { admin: "agent::1220bb", id: "cBYN", symbol: "cBYN", decimals: 6 };
const ORDER_B = "00000000-0000-4000-8000-0000000000bb";
const ORDER_A = "00000000-0000-4000-8000-0000000000aa";
const EXACT = "100.0000000000";
const order = (over = {}) => ({
  id: ORDER_B,
  direction: "offramp",
  status: "awaiting_withdrawal",
  instrument: BYN,
  withdraw: { walletContractId: "00wallet", amount: EXACT },
  updatedAt: "2026-10-20T10:00:00Z",
  ...over,
});
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const ledgerPayout = (cid) => ({
  contractId: cid,
  payload: { admin: TREASURY, user: USER, marketId: "0", instrument: { admin: BYN.admin, id: BYN.id }, amount: EXACT, reason: "withdraw", createdAt: "1760000500" },
});
/** GET /in-app-wallet/payouts's row for a withdrawal, bound to `offrampOrderId` (or to none). */
const backendPayout = (cid, offrampOrderId) => ({
  pendingPayoutCid: cid,
  payeeParty: USER,
  walletId: "w1",
  instrument: BYN,
  amount: EXACT,
  reason: "withdraw",
  status: "processing",
  retryAfterKyc: false,
  attempts: 1,
  lastError: null,
  firstSeenAt: "2026-10-20T09:00:00Z",
  settledAt: null,
  onLedger: true,
  offrampOrderId,
});

function stub({ payouts = [], backend = () => json({ payouts: [] }), attach } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes("/v2/state/ledger-end")) return json({ offset: 7 });
    if (u.includes("/v2/state/active-contracts")) return json(String(init.body ?? "").includes("PendingPayout") ? payouts : []);
    if (u.endsWith("/api/v1/in-app-wallet/payouts")) return backend();
    if (u.includes("/attach") && attach) return attach(u, init);
    return json({ error: "not_found", message: `unstubbed ${u}` }, 404);
  };
  return calls;
}

describe("R3-03: a withdrawal bound to another cash-out is never this one's", () => {
  it("does not take as signed a withdrawal the backend binds to another (failed) cash-out", async () => {
    stub({ payouts: [ledgerPayout("00x")], backend: () => json({ payouts: [backendPayout("00x", ORDER_A)] }) });
    const ctx = await ramp.readWithdrawalContext(USER, order());
    assert.equal(ctx.signed, null, "cash-out A's withdrawal is not offered to cash-out B: Sign stays");
    assert.deepEqual([...ctx.payoutCids], ["00x"], "it is still the party's: a new one is told apart from it");
  });

  it("still takes one bound to this order, or bound to none, and one the backend cannot say about", async () => {
    stub({ payouts: [ledgerPayout("00x")], backend: () => json({ payouts: [backendPayout("00x", ORDER_B)] }) });
    assert.equal((await ramp.readWithdrawalContext(USER, order())).signed?.contractId, "00x");
    stub({ payouts: [ledgerPayout("00x")], backend: () => json({ payouts: [backendPayout("00x", null)] }) });
    assert.equal((await ramp.readWithdrawalContext(USER, order())).signed?.contractId, "00x");
    stub({ payouts: [ledgerPayout("00x")], backend: () => json({ error: "internal_error", message: "boom" }, 500) });
    assert.equal((await ramp.readWithdrawalContext(USER, order())).signed?.contractId, "00x", "unreadable: as before");
  });

  it("asks the backend only when a withdrawal of the amount is there", async () => {
    const calls = stub({ payouts: [] });
    await ramp.readWithdrawalContext(USER, order());
    assert.equal(calls.filter((c) => c.url.endsWith("/in-app-wallet/payouts")).length, 0);
  });

  it("a matched withdrawal that needs an operator never claims support was notified", () => {
    for (const reason of ["blocked_unknown_reason", "failed"]) {
      const s = ramp.attachWaitSentence(reason);
      assert.match(s, /needs an operator to look at it/);
      assert.doesNotMatch(s, /notified/i);
    }
  });
});

describe("R3-04: a wallet that did not answer in time settles nothing", () => {
  const sign = (signAndSubmitTransaction, extra = {}) =>
    ramp.signRampWithdrawal({
      order: order(),
      userParty: USER,
      primaryParty: USER,
      context: { payoutCids: new Set(), walletContractId: "00wallet" },
      signAndSubmitTransaction,
      waitMs: 0,
      ...extra,
    });

  it("is no RampNotSignedError: it comes back unanswered, and the withdrawal it may still sign is attached once it shows", async () => {
    const timeout = new Error("Wallet sign timed out");
    const calls = stub({ payouts: [] });
    let signed = 0;
    const res = await sign(async () => {
      throw timeout;
    }, { onSigned: () => (signed += 1) });
    assert.deepEqual(res, { attached: false, order: null, error: timeout, unanswered: true });
    assert.equal(signed, 0, "nothing claims a signature either");
    assert.equal(calls.length, 0, "nothing requested");
    // The popup is approved after all: the page's next participant read finds it and attaches it.
    stub({ payouts: [ledgerPayout("00late")] });
    assert.equal((await ramp.readWithdrawalContext(USER, order())).signed?.contractId, "00late");
    assert.equal(ramp.isWalletTimeout(timeout), true);
    assert.equal(ramp.isWalletTimeout(new Error("User rejected the request")), false);
  });

  it("a refusal is still RampNotSignedError", async () => {
    stub();
    await assert.rejects(
      sign(async () => {
        throw new Error("User rejected the request");
      }),
      ramp.RampNotSignedError,
    );
  });

  it("the step holds Sign and Cancel as after a signature and says the popup may still sign (TSX, pinned)", () => {
    const step = readFileSync(new URL("../frontend/components/ramp/RampWithdrawStep.tsx", import.meta.url), "utf8");
    assert.match(step, /if \(res\.unanswered\) \{\s+hold\(\);\s+setUnanswered\(true\);\s+\}/);
    assert.match(step, /const hold = \(\) => \{\s+const at = Date\.now\(\);\s+rememberRampSigned\(order\.id, at\);\s+setSignedAt\(at\);\s+\};/);
    assert.match(step, /\{unanswered \? RAMP_WALLET_UNANSWERED_SENTENCE : "Signed in your wallet\. Waiting for the network/);
    assert.match(ramp.RAMP_WALLET_UNANSWERED_SENTENCE, /^Your wallet did not answer in time, and its window may still be open\./);
    assert.doesNotMatch(ramp.RAMP_WALLET_UNANSWERED_SENTENCE, /nothing left/i);
  });
});
