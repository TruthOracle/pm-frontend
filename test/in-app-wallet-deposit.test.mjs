/**
 * The per-instrument deposit rail of lib/inAppWallet.ts (docs/TOKENS.md §5): the wallet-list
 * gate that refuses a token the connected wallet does not list BEFORE any popup, the transfer
 * the wallet is asked for (the wallet's own id for the token, the memo, the metadata), the
 * reconcile that names the instrument, and the balances loader behind the wallet card with its
 * participant fallback. Runs the real lib against a stubbed `fetch` that routes by URL: the
 * backend relay and the participant proxy answer differently in one flow.
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

const wallet = await import("../frontend/lib/inAppWallet.ts");

const realFetch = globalThis.fetch;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const CC = { admin: "dso::1220aa", id: "Amulet", symbol: "CC", name: "Canton Coin", decimals: 10 };
const BYN = { admin: "agent::1220bb", id: "cBYN", symbol: "cBYN", name: "Canton Belarusian Ruble", decimals: 6 };
const cantonCoinCatalog = { ...CC, kind: "collateral", enabled: true, isDefaultCollateral: true, walletInstrumentId: "Amulet" };
const catalogBYN = { ...BYN, kind: "collateral", enabled: true, isDefaultCollateral: false, walletInstrumentId: "cBYN" };
const walletLists = [{ instrumentId: "Amulet", name: "Canton Coin", symbol: "CC" }];

/** A UserWallet as the participant proxy returns it (plain array of { contractId, payload }). */
const ledgerRow = (balance) => ({
  contractId: `00${"11".repeat(32)}`,
  payload: {
    admin: TREASURY,
    owner: USER,
    instrument: { admin: CC.admin, id: CC.id },
    balance: `${balance}.0000000000`,
    deposited: `${balance}.0000000000`,
    withdrawn: "0.0000000000",
    creditRefs: ["deposit:1"],
    auditObservers: [],
  },
});

/** Route-based fetch stub: `[substring, reply]` pairs, first match wins; a reply is JSON or a function of (url, init). */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [match, reply] of routes) {
      if (u.includes(match)) return typeof reply === "function" ? reply(u, init) : json(reply);
    }
    return json({ error: "not_found", message: `unstubbed ${u}` }, 404);
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("missingWalletInstrumentReason (lib/inAppWallet.ts)", () => {
  it("names the token the connected wallet does not list, and nothing when it does", () => {
    assert.equal(wallet.missingWalletInstrumentReason(walletLists, cantonCoinCatalog), null);
    assert.equal(wallet.missingWalletInstrumentReason(walletLists, catalogBYN), "Your Cantor8 wallet does not list cBYN yet");
    assert.equal(wallet.walletMissingInstrumentSentence(BYN), "Your Cantor8 wallet does not list cBYN yet");
  });
  it("matches on the catalog's wallet id, falling back to the token id", () => {
    const aliased = { ...catalogBYN, walletInstrumentId: "CBYN-wallet" };
    assert.equal(wallet.missingWalletInstrumentReason([{ instrumentId: "CBYN-wallet", name: "", symbol: "" }], aliased), null);
    assert.equal(wallet.missingWalletInstrumentReason([{ instrumentId: "cBYN", name: "", symbol: "" }], { ...catalogBYN, walletInstrumentId: "" }), null);
  });
  it("never blocks on a list it does not have", () => {
    assert.equal(wallet.missingWalletInstrumentReason(null, catalogBYN), null);
    assert.equal(wallet.missingWalletInstrumentReason(undefined, catalogBYN), null);
  });
});

describe("ledgerWalletToRecord (lib/inAppWallet.ts)", () => {
  it("turns the wire's Money strings into the record the flows work with, admin = the treasury", () => {
    const rec = wallet.ledgerWalletToRecord({
      contractId: "00aa",
      owner: USER,
      instrument: CC,
      balance: "12.5000000000",
      deposited: "20.0000000000",
      withdrawn: "7.5000000000",
      creditRefs: ["a", "b"],
    });
    assert.deepEqual(rec, {
      contractId: "00aa",
      admin: TREASURY,
      owner: USER,
      instrument: CC,
      balance: 12.5,
      deposited: 20,
      withdrawn: 7.5,
      creditRefs: ["a", "b"],
    });
  });
});

describe("fetchAccountBalances (lib/inAppWallet.ts)", () => {
  it("reads GET /in-app-wallet and keeps every instrument row, with or without a wallet", async () => {
    const calls = stubFetch([
      [
        "/__backend/api/v1/in-app-wallet",
        {
          partyId: USER,
          wallets: [],
          balances: [
            { instrument: CC, ledger: { contractId: "00aa", owner: USER, instrument: CC, balance: "3.0000000000", deposited: "3.0000000000", withdrawn: "0.0000000000", creditRefs: [] }, attribution: { creditedTotal: "3", ledgerDeposited: "3", delta: "0" } },
            { instrument: BYN, ledger: null, attribution: { creditedTotal: "0", ledgerDeposited: "0", delta: "0" } },
          ],
          pending: { submitted: 0 },
          payouts: [],
        },
      ],
    ]);
    const balances = await wallet.fetchAccountBalances(USER);
    assert.deepEqual(balances.instruments.map((i) => i.symbol), ["CC", "cBYN"]);
    assert.equal(balances.wallets.length, 1);
    assert.equal(balances.wallets[0].balance, 3);
    assert.equal(balances.wallets[0].instrument.symbol, "CC");
    assert.equal(calls.length, 1, "the participant is not asked when the backend answers");
  });

  it("falls back to the participant's UserWallets when the backend does not answer", async () => {
    stubFetch([
      ["/__backend/", () => json({ error: "backend_unreachable", message: "down" }, 502)],
      ["/v2/state/ledger-end", { offset: 7 }],
      ["/v2/state/active-contracts", [ledgerRow(9)]],
    ]);
    const balances = await wallet.fetchAccountBalances(USER);
    assert.equal(balances.wallets.length, 1);
    assert.equal(balances.wallets[0].balance, 9);
    assert.deepEqual(balances.instruments.map((i) => i.id), ["Amulet"]);
  });
});

describe("depositToInAppWallet (lib/inAppWallet.ts)", () => {
  it("refuses a token the connected wallet does not list before any popup opens", async () => {
    let transfers = 0;
    stubFetch([]);
    await assert.rejects(
      wallet.depositToInAppWallet({
        userParty: USER,
        instrument: catalogBYN,
        amount: 5,
        transfer: async () => {
          transfers += 1;
          return { txId: "never" };
        },
        walletInstruments: walletLists,
      }),
      /does not list cBYN yet/,
    );
    assert.equal(transfers, 0);
  });

  it("sends the transfer under the wallet's token id with the memo and metadata, then reconciles that instrument", async () => {
    // What the participant shows: 10 on the "before" read (the first active-contracts query, issued
    // ahead of the transfer), 15 on every read after it — the credit has landed.
    let reads = 0;
    const calls = stubFetch([
      ["/v2/state/ledger-end", { offset: 1 }],
      ["/v2/state/active-contracts", () => json([ledgerRow(++reads === 1 ? 10 : 15)])],
      [
        "/in-app-wallet/deposits/reconcile",
        { instrument: CC, credited: "5.0000000000", status: "confirmed", perWallet: [{ walletId: "w1", partyId: USER, amount: "5.0000000000" }], ledger: null },
      ],
    ]);
    const transfers = [];
    const outcome = await wallet.depositToInAppWallet({
      userParty: USER,
      instrument: cantonCoinCatalog,
      amount: 5,
      transfer: async (args) => {
        transfers.push(args);
        return { txId: "tx-1" };
      },
      walletInstruments: walletLists,
    });
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].to, TREASURY);
    assert.equal(transfers[0].instrumentId, "Amulet", "the wallet's own id for the token, not the symbol");
    assert.equal(transfers[0].amount, 5);
    assert.equal(transfers[0].memo, "TruthOracle: deposit 5 CC to in-app wallet");
    assert.deepEqual(transfers[0].metadata, { kind: "truthoracle_deposit", amount: "5", instrument: `${CC.admin}:Amulet` });
    const reconcile = calls.find((c) => c.url.includes("/deposits/reconcile"));
    assert.ok(reconcile, "the credit step ran");
    assert.deepEqual(JSON.parse(reconcile.init.body), { instrument: { admin: CC.admin, id: "Amulet" } });
    assert.equal(outcome.credited, true);
    assert.equal(outcome.pending, false);
    assert.equal(outcome.wallet?.balance, 15);
  });
});
