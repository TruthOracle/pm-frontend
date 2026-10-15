/**
 * Tests for the server-side Enterprise Wallet helpers in api/_lib/walletClient.mjs.
 * totalReceivedFrom sums one instrument of a party's inbound history, so every skip rule
 * gets a case: direction, status, instrument, and the party pair; `transfer` is the
 * treasury-signed outbound call and must name the instrument and carry the amount as the
 * ledger's 10-dp string. Row shapes mirror the wallet's real payloads (v0.1.35 history
 * events observed on DevNet: direction "IN"/"OUT", string amounts, status "completed").
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { collectHistory, totalReceivedFrom, transfer } from "../api/_lib/walletClient.mjs";

const ADMIN = "admin::1220aa";
const USER = "user::1220bb";
const OTHER = "other::1220cc";
const AMULET = "Amulet";

const row = (overrides = {}) => ({
  instrumentId: "Amulet",
  direction: "IN",
  status: "completed",
  amount: "10.0000000000",
  partyId: ADMIN,
  partyId2: USER,
  ...overrides,
});

/** The Keycloak mint posts a URL-encoded form; everything else is JSON. Keep the recorded body honest for both. */
function parseBody(body) {
  if (typeof body !== "string" || !body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

describe("totalReceivedFrom", () => {
  it("sums settled inbound transfers from the counterparty", () => {
    const rows = [row(), row({ amount: "2.5000000000" })];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER, AMULET), 12.5);
  });

  it("is case-insensitive on direction and status", () => {
    const rows = [row({ direction: "in", status: "Completed" })];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER, AMULET), 10);
  });

  it("counts rows without a status (pre-0.1.35 wallets)", () => {
    const rows = [row({ status: undefined })];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER, AMULET), 10);
  });

  it("never credits pending, failed, or unknown-status transfers", () => {
    for (const status of ["pending", "failed", "rejected", "expired", "something_new"]) {
      assert.equal(totalReceivedFrom([row({ status })], ADMIN, USER, AMULET), 0, `status=${status}`);
    }
  });

  it("skips outbound transfers (a payout is not a deposit)", () => {
    assert.equal(totalReceivedFrom([row({ direction: "OUT" })], ADMIN, USER, AMULET), 0);
  });

  it("skips other instruments and swap payloads without an instrumentId", () => {
    const swapPayload = { orderId: "x", status: "completed", sendAmount: "5" };
    const rows = [row({ instrumentId: "USDC" }), swapPayload];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER, AMULET), 0);
  });

  it("sums the instrument it is asked for and refuses to sum without one", () => {
    const rows = [row(), row({ instrumentId: "cBYN", amount: "2.0000000000" }), row({ instrumentId: "cBYN", amount: "0.5000000000" })];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER, AMULET), 10);
    assert.equal(totalReceivedFrom(rows, ADMIN, USER, "cBYN"), 2.5);
    assert.throws(() => totalReceivedFrom(rows, ADMIN, USER), /instrument id/);
  });

  it("requires the pair to be exactly {admin, counterparty}", () => {
    const rows = [
      row({ partyId2: OTHER }), // inbound, but from someone else
      row({ partyId: OTHER }), // mentions the user, not the admin
      row({ partyId: USER, partyId2: USER }), // degenerate self-pair
    ];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER, AMULET), 0);
  });

  it("accepts the pair in either column order", () => {
    assert.equal(totalReceivedFrom([row({ partyId: USER, partyId2: ADMIN })], ADMIN, USER, AMULET), 10);
  });

  it("ignores non-positive and non-numeric amounts", () => {
    const rows = [row({ amount: "0" }), row({ amount: "-3" }), row({ amount: "abc" })];
    assert.equal(totalReceivedFrom(rows, ADMIN, USER, AMULET), 0);
  });
});

/**
 * Paging. The wallet 500s on its own documented default limit (100000 on DevNet
 * v0.1.35), so history is read in pages keyed by the oldest timestamp seen. The
 * reconciliation needs the COMPLETE history, so the walker must either return all
 * of it or throw — never a silent partial.
 */
describe("collectHistory", () => {
  const ev = (i) => ({ eventType: "transfer", timestamp: `2026-09-03T00:00:${String(i).padStart(2, "0")}Z`, event: { i } });

  it("returns a single short page as-is with no cursor", async () => {
    const calls = [];
    const out = await collectHistory(async (c) => (calls.push(c), [ev(3), ev(2), ev(1)]), { pageSize: 5 });
    assert.deepEqual(calls, [undefined]);
    assert.equal(out.length, 3);
  });

  it("walks full pages using the oldest timestamp as an exclusive cursor", async () => {
    const all = [9, 8, 7, 6, 5, 4, 3, 2, 1].map(ev);
    const calls = [];
    const fetchPage = async (cursor) => {
      calls.push(cursor);
      const from = cursor ? all.findIndex((e) => e.timestamp === cursor) + 1 : 0;
      return all.slice(from, from + 4);
    };
    const out = await collectHistory(fetchPage, { pageSize: 4 });
    assert.deepEqual(calls, [undefined, all[3].timestamp, all[7].timestamp]);
    assert.deepEqual(out.map((e) => e.event.i), [9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("stops on an exactly-full final page by asking once more and getting nothing", async () => {
    const pages = [[ev(2), ev(1)], []];
    const out = await collectHistory(async () => pages.shift(), { pageSize: 2 });
    assert.equal(out.length, 2);
  });

  it("throws instead of returning a partial history when a full page has no cursor", async () => {
    await assert.rejects(
      collectHistory(async () => [{ event: {} }, { event: {} }], { pageSize: 2 }),
      /no timestamp cursor/,
    );
  });

  it("throws when the cursor stops advancing", async () => {
    await assert.rejects(
      collectHistory(async () => [ev(1), ev(1)], { pageSize: 2 }),
      /did not advance/,
    );
  });

  it("throws past maxPages rather than looping forever", async () => {
    let i = 100;
    await assert.rejects(
      collectHistory(async () => [ev(i--), ev(i--)], { pageSize: 2, maxPages: 3 }),
      /exceeded 6 events/,
    );
  });
});

/**
 * Outbound treasury transfers name their instrument (Enterprise Wallet v0.1.35 `POST
 * /api/v1/transfer` is instrument-aware) and carry the amount as a 10-dp string; a call
 * without an instrument or with a non-positive amount never reaches the wallet.
 */
describe("transfer", () => {
  const ENV = {
    ENTERPRISE_WALLET_PROXY_TARGET_URL: "https://wallet.test",
    KEYCLOAK_URL: "https://auth.test",
    KEYCLOAK_REALM: "master",
    KEYCLOAK_CLIENT_ID: "test-client",
    KEYCLOAK_CLIENT_SECRET: "test-secret",
  };
  const realFetch = globalThis.fetch;
  const saved = {};

  function withWallet() {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      calls.push({ url: u, method: init.method ?? "GET", body: parseBody(init.body) });
      if (u.includes("/protocol/openid-connect/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 300 }), { status: 200 });
      }
      return new Response(JSON.stringify({ commandId: "cmd-1", status: "pending" }), { status: 200 });
    };
    return calls;
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    globalThis.fetch = realFetch;
  });

  it("posts the instrument and the amount as the ledger's 10-dp string", async () => {
    const calls = withWallet();
    const result = await transfer({
      from: ADMIN,
      to: USER,
      instrumentId: "cBYN",
      amount: "4.25",
      reason: "payout",
      app: "truthoracle",
      commandId: "cmd-1",
      metadata: { kind: "payout" },
    });
    assert.deepEqual(result, { commandId: "cmd-1", status: "pending" });
    const call = calls.find((c) => c.url === "https://wallet.test/api/v1/transfer");
    assert.equal(call.method, "POST");
    assert.deepEqual(call.body, {
      from: ADMIN,
      to: USER,
      instrumentId: "cBYN",
      transferAmount: "4.2500000000",
      reason: "payout",
      app: "truthoracle",
      commandId: "cmd-1",
      metadata: { kind: "payout" },
    });
  });

  it("refuses a transfer without an instrument or with a non-positive amount before any call", () => {
    const calls = withWallet();
    assert.throws(() => transfer({ from: ADMIN, to: USER, amount: 1, commandId: "x" }), /instrumentId/);
    assert.throws(() => transfer({ from: ADMIN, to: USER, instrumentId: AMULET, amount: 0, commandId: "x" }), /positive/);
    assert.throws(() => transfer({ from: ADMIN, to: USER, instrumentId: AMULET, amount: "abc", commandId: "x" }), /positive/);
    assert.equal(calls.length, 0);
  });
});
