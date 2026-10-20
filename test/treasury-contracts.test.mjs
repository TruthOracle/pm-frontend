/**
 * Review R3-02: UserWallet, PendingPayout and PredictionMarket are `signatory admin`, so any party
 * can create one with itself as admin that names a victim as owner or payee and lists the treasury
 * as an audit observer; it then shows in the victim's and the treasury's participant reads. The
 * browser keeps only the treasury's (utils/activeContracts.ts): the cash-out step never takes a
 * planted withdrawal for the order's signature nor builds the Withdraw on a planted wallet, and
 * Pending payouts, the admin queue, the wallet card's fallback and the market list show none.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);

const TREASURY = `treasury::1220${"ab".repeat(32)}`;
const USER = `user::1220${"cd".repeat(32)}`;
const EVIL = `evil::1220${"ef".repeat(32)}`;
globalThis.__VITE_ENV__ = {
  VITE_BACKEND_PROXY_URL: "/__backend",
  VITE_ENTERPRISE_WALLET_PARTY_ID: TREASURY,
  VITE_TRUTHORACLE_PACKAGE_NAME: "truthoracle-v17",
};

const ramp = await import("../frontend/lib/ramp.ts");
const ledger = await import("../frontend/utils/activeContracts.ts");
const inApp = await import("../frontend/lib/inAppWallet.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BYN = { admin: "agent::1220bb", id: "cBYN", symbol: "cBYN", decimals: 6 };
const ORDER_ID = "00000000-0000-4000-8000-0000000000aa";
const EXACT = "100.0000000000";
const order = () => ({
  id: ORDER_ID,
  direction: "offramp",
  status: "awaiting_withdrawal",
  instrument: BYN,
  withdraw: { walletContractId: "00wallet-from-order", amount: EXACT },
  updatedAt: "2026-10-20T10:00:00Z",
});
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const payout = (cid, admin, createdAt, amount = EXACT) => ({
  contractId: cid,
  payload: { admin, user: USER, marketId: "0", instrument: { admin: BYN.admin, id: BYN.id }, amount, reason: "withdraw", createdAt, auditObservers: [TREASURY] },
});
const wallet = (cid, admin) => ({
  contractId: cid,
  payload: { admin, owner: USER, instrument: { admin: BYN.admin, id: BYN.id }, balance: "1000000.0000000000", deposited: "0", withdrawn: "0", creditRefs: [], auditObservers: [TREASURY] },
});
const market = (cid, admin) => ({
  contractId: cid,
  payload: { admin, marketId: "7", question: "Will it rain?", collateral: { admin: BYN.admin, id: BYN.id }, status: "Trading", currentPrice: "0.5", auditObservers: [TREASURY] },
});

// The planted rows sort first (a later createdAt; the wallet listed before the treasury's).
const PLANTED_PAYOUT = payout("00planted", EVIL, "1760000900");
const TREASURY_WALLET = wallet("00wallet-treasury", TREASURY);
const PLANTED_WALLET = wallet("00wallet-planted", EVIL);

/** The participant by the template in the body, the backend relay by its path. */
function stub({ payouts = [], wallets = [], markets = [], attach } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes("/v2/state/ledger-end")) return json({ offset: 7 });
    if (u.includes("/v2/state/active-contracts")) {
      const body = String(init.body ?? "");
      return json(body.includes("PendingPayout") ? payouts : body.includes("UserWallet") ? wallets : body.includes("PredictionMarket") ? markets : []);
    }
    if (u.includes("/attach") && attach) return attach(u, init);
    return json({ error: "not_found", message: `unstubbed ${u}` }, 404);
  };
  return calls;
}

describe("R3-02: the cash-out step reads the treasury's contracts only", () => {
  it("never takes a planted withdrawal of the order's amount as signed, nor builds on a planted wallet", async () => {
    stub({ payouts: [PLANTED_PAYOUT, payout("00older", TREASURY, "1760000100", "50.0000000000")], wallets: [PLANTED_WALLET, TREASURY_WALLET] });
    const ctx = await ramp.readWithdrawalContext(USER, order());
    assert.equal(ctx.signed, null, "nothing of the order's amount is the treasury's: Sign stays offered");
    assert.equal(ctx.walletContractId, "00wallet-treasury", "the Withdraw is built on the treasury's wallet");
    assert.deepEqual([...ctx.payoutCids], ["00older"]);
  });

  it("after the signature attaches the treasury's new withdrawal, never a planted one of the same amount", async () => {
    const calls = stub({
      payouts: [PLANTED_PAYOUT, payout("00new", TREASURY, "1760000500")],
      attach: () => json({ order: { ...order(), status: "withdrawing", withdraw: null }, bindPending: false, bindReason: null }),
    });
    const res = await ramp.signRampWithdrawal({
      order: order(),
      userParty: USER,
      primaryParty: USER,
      context: { payoutCids: new Set(), walletContractId: "00wallet-treasury" },
      signAndSubmitTransaction: async () => ({ hash: "h" }),
      waitMs: 0,
    });
    assert.equal(res.attached, true);
    const attached = calls.filter((c) => c.url.includes("/attach")).map((c) => JSON.parse(c.init.body).pendingPayoutCid);
    assert.deepEqual(attached, ["00new"]);
  });
});

describe("R3-02: Pending payouts, the admin queue, the wallet card and the market list", () => {
  it("drop every PendingPayout, UserWallet and PredictionMarket another party signed", async () => {
    stub({
      payouts: [PLANTED_PAYOUT, payout("00real", TREASURY, "1760000500")],
      wallets: [PLANTED_WALLET, TREASURY_WALLET],
      markets: [market("00market-planted", EVIL), market("00market-real", TREASURY)],
    });
    assert.deepEqual((await ledger.fetchPendingPayouts(USER)).map((p) => p.contractId), ["00real"], "Pending payouts");
    assert.deepEqual((await ledger.fetchPendingPayouts(TREASURY)).map((p) => p.contractId), ["00real"], "the admin queue");
    assert.deepEqual((await ledger.fetchUserWallets(USER)).map((w) => w.contractId), ["00wallet-treasury"]);
    assert.equal((await ledger.fetchUserWallet(USER, BYN))?.contractId, "00wallet-treasury");
    // The wallet card falls back to the participant when the backend does not answer (404 here).
    assert.deepEqual((await inApp.fetchAccountBalances(USER)).wallets.map((w) => w.contractId), ["00wallet-treasury"]);
    assert.deepEqual((await ledger.fetchAllPredictionMarkets()).map((m) => m.contractId), ["00market-real"], "the market list");
    assert.equal((await ledger.fetchPredictionMarketContractId(7, TREASURY))?.contractId, "00market-real", "a planted market never shadows the real one");
  });
});
