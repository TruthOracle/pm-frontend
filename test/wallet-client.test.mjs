/**
 * Tests for the deposit-reconciliation arithmetic in api/_lib/walletClient.mjs.
 * totalReceivedFrom is what stands between "transfer history" and "minted balance",
 * so every skip rule gets a case: direction, status, instrument, and the party pair.
 * Row shapes mirror the wallet's real payloads (v0.1.35 history events observed on
 * DevNet: direction "IN"/"OUT", string amounts, status "completed").
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { totalReceivedFrom } from "../api/_lib/walletClient.mjs";

const ADMIN = "admin::1220aa";
const USER = "user::1220bb";
const OTHER = "other::1220cc";

const row = (overrides = {}) => ({
  instrumentId: "Amulet",
  direction: "IN",
  status: "completed",
  amount: "10.0000000000",
  partyId: ADMIN,
  partyId2: USER,
  ...overrides,
});

describe("totalReceivedFrom", () => {
  it("sums settled inbound transfers from the counterparty", () => {
    const rows = [row(), row({ amount: "2.5000000000" })];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER), 12.5);
  });

  it("is case-insensitive on direction and status", () => {
    const rows = [row({ direction: "in", status: "Completed" })];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER), 10);
  });

  it("counts rows without a status (pre-0.1.35 wallets)", () => {
    const rows = [row({ status: undefined })];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER), 10);
  });

  it("never credits pending, failed, or unknown-status transfers", () => {
    for (const status of ["pending", "failed", "rejected", "expired", "something_new"]) {
      assert.equal(totalReceivedFrom([row({ status })], ADMIN, USER), 0, `status=${status}`);
    }
  });

  it("skips outbound transfers (a payout is not a deposit)", () => {
    assert.equal(totalReceivedFrom([row({ direction: "OUT" })], ADMIN, USER), 0);
  });

  it("skips other instruments and swap payloads without an instrumentId", () => {
    const swapPayload = { orderId: "x", status: "completed", sendAmount: "5" };
    const rows = [row({ instrumentId: "USDC" }), swapPayload];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER), 0);
  });

  it("requires the pair to be exactly {admin, counterparty}", () => {
    const rows = [
      row({ partyId2: OTHER }), // inbound, but from someone else
      row({ partyId: OTHER }), // mentions the user, not the admin
      row({ partyId: USER, partyId2: USER }), // degenerate self-pair
    ];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER), 0);
  });

  it("accepts the pair in either column order", () => {
    assert.equal(totalReceivedFrom([row({ partyId: USER, partyId2: ADMIN })], ADMIN, USER), 10);
  });

  it("ignores non-positive and non-numeric amounts", () => {
    const rows = [row({ amount: "0" }), row({ amount: "-3" }), row({ amount: "abc" })];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER), 0);
  });
});
