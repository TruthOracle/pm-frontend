/**
 * Cash-out step 2 (frontend/lib/ramp.ts signRampWithdrawal / readWithdrawalContext), run against
 * a stubbed fetch that routes the backend relay and the participant proxy apart:
 *  - the wallet call is the FIRST await of the click (wallets/cantor8/popupGesture.ts rule 2): it
 *    runs synchronously inside signRampWithdrawal, before any request;
 *  - the Withdraw carries the order's exact decimal string (1234567.89, which a float turns into
 *    1234567.8899999999) on the freshest UserWallet id;
 *  - the PendingPayout attached is the new one of exactly the order's amount, never an older one;
 *  - before the signature every failure is RampNotSignedError and nothing is requested; after it
 *    nothing throws — an attach failure comes back as `attached: false`.
 */
import assert from "node:assert/strict";
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
const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";
const EXACT = "1234567.8900000000";
const order = (over = {}) => ({
  id: ORDER_ID,
  direction: "offramp",
  status: "awaiting_withdrawal",
  instrument: BYN,
  withdraw: { walletContractId: "00wallet-from-order", amount: EXACT },
  updatedAt: "2026-10-19T10:00:00Z",
  ...over,
});
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const payoutRow = (cid, amount, reason = "withdraw", user = USER) => ({
  contractId: cid,
  payload: { admin: TREASURY, user, marketId: "0", instrument: { admin: BYN.admin, id: BYN.id }, amount, reason, createdAt: "1760000000" },
});
const walletRow = (cid) => ({
  contractId: cid,
  payload: { admin: TREASURY, owner: USER, instrument: { admin: BYN.admin, id: BYN.id }, balance: "5000000.0000000000", deposited: "0", withdrawn: "0", creditRefs: [] },
});

/** Participant (PendingPayout / UserWallet by the template in the body) + backend routes. */
function stub({ payouts = [], wallets = [], attach = () => json({ order: order({ status: "withdrawing", withdraw: null }), bindPending: false, bindReason: null }) } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes("/v2/state/ledger-end")) return json({ offset: 7 });
    if (u.includes("/v2/state/active-contracts"))
      return json(String(init.body ?? "").includes("PendingPayout") ? payouts : wallets);
    if (u.includes("/attach")) return attach(u, init);
    return json({ error: "not_found", message: `unstubbed ${u}` }, 404);
  };
  return calls;
}

describe("cash-out signing: the wallet popup comes first", () => {
  it("calls the wallet synchronously, before any request, with the exact amount on the fresh wallet id", async () => {
    const calls = stub({ payouts: [payoutRow("00old", "50.0000000000"), payoutRow("00new", EXACT)] });
    const events = [];
    let params = null;
    const pending = ramp.signRampWithdrawal({
      order: order(),
      userParty: USER,
      primaryParty: USER,
      context: { payoutCids: new Set(["00old"]), walletContractId: "00wallet-fresh" },
      signAndSubmitTransaction: async (p) => {
        events.push(`sign after ${calls.length} requests`);
        params = p;
        return { hash: "h" };
      },
      onSigned: () => events.push("onSigned"),
      waitMs: 0,
    });
    assert.deepEqual(events, ["sign after 0 requests"], "the popup opened inside the click, nothing awaited in front of it");
    const res = await pending;
    assert.deepEqual(events, ["sign after 0 requests", "onSigned"]);
    assert.equal(res.attached, true);
    assert.equal(res.order.status, "withdrawing");

    const exercise = params.commands[0].exercise;
    assert.equal(exercise.choice, "Withdraw");
    assert.equal(exercise.contractId, "00wallet-fresh");
    assert.equal(exercise.choiceArgument.amount, "1234567.8900000000", "not 1234567.8899999999");
    assert.deepEqual(params.actAs, [USER]);

    const attach = calls.filter((c) => c.url.includes("/attach"));
    assert.equal(attach.length, 1);
    assert.equal(attach[0].url, `/__backend/api/v1/ramp/orders/${ORDER_ID}/attach`);
    assert.deepEqual(JSON.parse(attach[0].init.body), { pendingPayoutCid: "00new" });
  });

  it("uses the order's wallet id when no fresher one was read", async () => {
    stub({ payouts: [] });
    let params = null;
    await ramp.signRampWithdrawal({
      order: order(),
      userParty: USER,
      primaryParty: USER,
      context: null,
      signAndSubmitTransaction: async (p) => ((params = p), { hash: "h" }),
      waitMs: 0,
    });
    assert.equal(params.commands[0].exercise.contractId, "00wallet-from-order");
  });

  it("never attaches an older withdrawal of another amount, even when the snapshot read failed", async () => {
    const calls = stub({ payouts: [payoutRow("00old", "50.0000000000"), payoutRow("00foreign", EXACT, "withdraw", "other::1220ee")] });
    const res = await ramp.signRampWithdrawal({
      order: order(),
      userParty: USER,
      primaryParty: USER,
      context: { payoutCids: new Set(), walletContractId: null },
      signAndSubmitTransaction: async () => ({ hash: "h" }),
      waitMs: 0,
    });
    assert.deepEqual(res, { attached: false, order: null });
    assert.equal(calls.filter((c) => c.url.includes("/attach")).length, 0, "the backend scan binds it instead");
  });
});

describe("cash-out signing: errors before and after the signature", () => {
  it("refuses before the popup: wrong wallet, order moved on, malformed amount", async () => {
    const calls = stub();
    let popups = 0;
    const sign = async () => ((popups += 1), { hash: "h" });
    const base = { userParty: USER, primaryParty: USER, context: null, signAndSubmitTransaction: sign, waitMs: 0 };
    await assert.rejects(ramp.signRampWithdrawal({ ...base, order: order(), primaryParty: "primary::1220ff" }), (e) => {
      assert.ok(e instanceof ramp.RampNotSignedError);
      assert.match(e.message, /primary Cantor8 wallet/);
      return true;
    });
    await assert.rejects(ramp.signRampWithdrawal({ ...base, order: order({ status: "withdrawing" }) }), ramp.RampNotSignedError);
    await assert.rejects(ramp.signRampWithdrawal({ ...base, order: order({ withdraw: null }) }), ramp.RampNotSignedError);
    await assert.rejects(
      ramp.signRampWithdrawal({ ...base, order: order({ withdraw: { walletContractId: "w", amount: "1e3" } }) }),
      ramp.RampNotSignedError,
    );
    assert.equal(popups, 0, "no popup opened");
    assert.equal(calls.length, 0, "nothing requested");
  });

  it("a wallet rejection is RampNotSignedError with the cause kept, and nothing follows it", async () => {
    const calls = stub();
    const rejection = Object.assign(new Error("User rejected the request"), { code: "USER_REJECTED" });
    let signed = false;
    await assert.rejects(
      ramp.signRampWithdrawal({
        order: order(),
        userParty: USER,
        primaryParty: USER,
        context: null,
        signAndSubmitTransaction: async () => {
          throw rejection;
        },
        onSigned: () => (signed = true),
        waitMs: 0,
      }),
      (e) => e instanceof ramp.RampNotSignedError && e.cause === rejection,
    );
    assert.equal(signed, false);
    assert.equal(calls.length, 0);
  });

  it("after the signature nothing throws: a rate-limited or refused attach comes back as attached:false", async () => {
    for (const reply of [
      () => json({ error: "rate_limited", message: "slow down" }, 429),
      () => json({ error: "ramp_order_state", message: "the signed withdrawal does not match this cash-out" }, 409),
      () => json({ error: "internal_error", message: "boom" }, 500),
    ]) {
      stub({ payouts: [payoutRow("00new", EXACT)], attach: reply });
      let signed = 0;
      const res = await ramp.signRampWithdrawal({
        order: order(),
        userParty: USER,
        primaryParty: USER,
        context: { payoutCids: new Set(), walletContractId: null },
        signAndSubmitTransaction: async () => ({ hash: "h" }),
        onSigned: () => (signed += 1),
        waitMs: 0,
      });
      assert.equal(res.attached, false);
      assert.equal(res.order, null);
      assert.ok(res.error, "the error is handed back, not thrown");
      assert.equal(signed, 1);
    }
  });
});

describe("cash-out signing: what the page reads before the click", () => {
  it("finds a withdrawal of exactly the order's amount as already signed, and the current wallet id", async () => {
    stub({
      payouts: [payoutRow("00a", "50.0000000000"), payoutRow("00b", EXACT), payoutRow("00c", EXACT, "bond")],
      wallets: [walletRow("00wallet-now")],
    });
    const ctx = await ramp.readWithdrawalContext(USER, order());
    assert.equal(ctx.signed?.contractId, "00b");
    assert.equal(ctx.walletContractId, "00wallet-now");
    assert.deepEqual([...ctx.payoutCids].sort(), ["00a", "00b", "00c"]);
    const excluded = await ramp.readWithdrawalContext(USER, order(), new Set(["00b"]));
    assert.equal(excluded.signed, null, "a cid the backend said is not this order's is not offered again");
  });

  it("builds Withdraw params from the exact string and refuses junk", () => {
    const p = ramp.rampWithdrawParams(USER, "00w", "98.5");
    assert.equal(p.commands[0].exercise.choiceArgument.amount, "98.5000000000");
    assert.match(String(p.commands[0].exercise.choiceArgument.nowSeconds), /^\d+$/);
    assert.throws(() => ramp.rampWithdrawParams(USER, "00w", "0"), /positive/);
    assert.throws(() => ramp.rampWithdrawParams(USER, "00w", "12,5"), /positive/);
  });
});

describe("cash-out signing: the attach answer's bindPending (F6)", () => {
  it("hands back a matched withdrawal not bound yet with bindPending and why, and a bound one without", async () => {
    const sign = (attach) => {
      stub({ payouts: [payoutRow("00new", EXACT)], attach });
      return ramp.signRampWithdrawal({
        order: order(),
        userParty: USER,
        primaryParty: USER,
        context: { payoutCids: new Set(), walletContractId: "00wallet" },
        signAndSubmitTransaction: async () => ({ hash: "h" }),
        waitMs: 0,
      });
    };
    const waiting = await sign(() => json({ order: order(), bindPending: true, bindReason: "settlement_in_progress" }));
    assert.deepEqual([waiting.attached, waiting.bindPending, waiting.bindReason, waiting.order.status], [true, true, "settlement_in_progress", "awaiting_withdrawal"]);
    assert.equal(ramp.attachOutcome(waiting), "pending");
    const bound = await sign(() => json({ order: order({ status: "withdrawing", withdraw: null }), bindPending: false, bindReason: null }));
    assert.deepEqual([bound.attached, bound.bindPending, bound.bindReason], [true, false, null]);
    // An answer that does not say whether it is bound is no answer: after the signature nothing throws.
    const unsaid = await sign(() => json({ order: order() }));
    assert.equal(unsaid.attached, false);
    assert.equal(unsaid.error?.code, "invalid_response");
  });
});
