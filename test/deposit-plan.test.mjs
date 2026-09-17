/**
 * The deposit reconciliation's money arithmetic (api/_lib/depositPlan.mjs): which of
 * the user's ledger-visible transfers get credited, how the covering txRef is built,
 * and that anything already recorded on the UserWallet is never credited twice.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { creditedUpdateIds, planDeposit, LEDGER_TXREF_PREFIX } from "../api/_lib/depositPlan.mjs";

const USER = "user::1220aa";
const OTHER = "other::1220bb";
const SINCE = "2026-09-16T00:00:00Z";

const transfer = (overrides = {}) => ({
  updateId: "1220f40c",
  offset: 100,
  recordTime: "2026-09-16T10:00:00.000000Z",
  sender: USER,
  amountCC: 20,
  ...overrides,
});

describe("creditedUpdateIds", () => {
  it("parses one or many ids out of ledger: refs and ignores legacy refs", () => {
    const ids = creditedUpdateIds([`${LEDGER_TXREF_PREFIX}a,b`, `${LEDGER_TXREF_PREFIX}c`, "reconcile:deposit-xyz"]);
    assert.deepEqual([...ids].sort(), ["a", "b", "c"]);
  });

  it("treats a 1.0.0 wallet (depositRefs None) as having credited nothing", () => {
    assert.equal(creditedUpdateIds(null).size, 0);
    assert.equal(creditedUpdateIds(undefined).size, 0);
  });
});

describe("planDeposit", () => {
  it("credits every pending transfer from the user in one command, oldest first", () => {
    const transfers = [
      transfer({ updateId: "b", offset: 200, amountCC: 11 }),
      transfer({ updateId: "a", offset: 100, amountCC: 20 }),
      transfer({ updateId: "x", offset: 150, sender: OTHER, amountCC: 99 }),
    ];
    const plan = planDeposit({ transfers, userPartyId: USER, existing: null, since: SINCE });
    assert.equal(plan.seenCC, 31);
    assert.deepEqual(plan.pending.map((t) => t.updateId), ["a", "b"]);
    assert.equal(plan.credit.amount, "31.0000000000");
    assert.equal(plan.credit.txRef, `${LEDGER_TXREF_PREFIX}a,b`);
    assert.match(plan.credit.commandId, /^deposit-[0-9a-f]{40}$/);
  });

  it("skips transfers already recorded on the wallet, whether singly or in a batch ref", () => {
    const existing = { contractId: "cid1", depositedCC: 31, depositRefs: [`${LEDGER_TXREF_PREFIX}a,b`] };
    const transfers = [transfer({ updateId: "a" }), transfer({ updateId: "b", offset: 200 }), transfer({ updateId: "c", offset: 300, amountCC: 5 })];
    const plan = planDeposit({ transfers, userPartyId: USER, existing, since: SINCE });
    assert.deepEqual(plan.pending.map((t) => t.updateId), ["c"]);
    assert.equal(plan.credit.amount, "5.0000000000");
    assert.equal(plan.credit.txRef, `${LEDGER_TXREF_PREFIX}c`);
  });

  it("credits nothing when everything visible is already recorded", () => {
    const existing = { contractId: "cid1", depositedCC: 20, depositRefs: [`${LEDGER_TXREF_PREFIX}1220f40c`] };
    const plan = planDeposit({ transfers: [transfer()], userPartyId: USER, existing, since: SINCE });
    assert.equal(plan.credit, null);
    assert.equal(plan.seenCC, 20);
  });

  it("ignores transfers recorded before the cutover instant", () => {
    const old = transfer({ updateId: "old", recordTime: "2026-09-15T16:31:35.593625Z" });
    const plan = planDeposit({ transfers: [old], userPartyId: USER, existing: null, since: SINCE });
    assert.equal(plan.credit, null);
    assert.equal(plan.seenCC, 0);
  });

  it("ignores dust, missing update ids, and other senders", () => {
    const transfers = [
      transfer({ updateId: "dust", amountCC: 1e-12 }),
      transfer({ updateId: "", amountCC: 5 }),
      transfer({ updateId: "theirs", sender: OTHER }),
    ];
    assert.equal(planDeposit({ transfers, userPartyId: USER, existing: null, since: SINCE }).credit, null);
  });

  it("derives the same commandId for the same state and a new one for new state", () => {
    const base = { transfers: [transfer()], userPartyId: USER, existing: null, since: SINCE };
    const a = planDeposit(base).credit.commandId;
    const b = planDeposit(base).credit.commandId;
    const c = planDeposit({ ...base, transfers: [transfer(), transfer({ updateId: "n", offset: 900, amountCC: 1 })] }).credit.commandId;
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});
