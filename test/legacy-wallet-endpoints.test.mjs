/**
 * ARCHITECTURE.md §18 — once an accounts backend is configured (BACKEND_URL), the
 * legacy money endpoints step aside entirely: api/wallet/deposit.mjs and
 * api/wallet/settle-payout.mjs both answer 410 for every caller and every reason
 * (the KYC gate lives in the backend, and its payout processor settles bond /
 * model-prize rows itself — a second settler here would pay twice). Without
 * BACKEND_URL nothing may change — that baseline is asserted here too.
 *
 * Plain `node --test`: Keycloak, the ledger and the wallet are one routed fetch stub.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Readable } from "node:stream";

import depositHandler from "../api/wallet/deposit.mjs";
import settleHandler from "../api/wallet/settle-payout.mjs";
import { SESSION_COOKIE, issueSession } from "../api/_lib/adminSession.mjs";
import { resetSharedStoreForTests } from "../api/_lib/sharedStore.mjs";

const realFetch = globalThis.fetch;

// Everything the two handlers (and the upstream helpers beneath them) read from env.
const ENV = [
  "BACKEND_URL",
  "ADMIN_SESSION_SECRET",
  "ADMIN_OPERATORS",
  "ADMIN_SESSION_TTL_HOURS",
  "VITE_APP_NETWORK",
  "VITE_ENTERPRISE_WALLET_PARTY_ID",
  "VITE_ENTERPRISE_WALLET_APP_NAME",
  "VITE_TRUTHORACLE_PACKAGE_ID",
  "VITE_TRUTHORACLE_PACKAGE_NAME",
  "CANTON_LEDGER_PROXY_TARGET_URL",
  "VITE_CANTON_PARTICIPANT_URL",
  "ENTERPRISE_WALLET_PROXY_TARGET_URL",
  "VITE_ENTERPRISE_WALLET_URL",
  "KEYCLOAK_URL",
  "KEYCLOAK_REALM",
  "KEYCLOAK_CLIENT_ID",
  "KEYCLOAK_CLIENT_SECRET",
  "VITE_KEYCLOAK_URL",
  "VITE_KEYCLOAK_REALM",
  "LEDGER_KEYCLOAK_URL",
  "LEDGER_KEYCLOAK_REALM",
  "LEDGER_KEYCLOAK_CLIENT_ID",
  "LEDGER_KEYCLOAK_CLIENT_SECRET",
  "WALLET_KEYCLOAK_URL",
  "WALLET_KEYCLOAK_REALM",
  "WALLET_KEYCLOAK_CLIENT_ID",
  "WALLET_KEYCLOAK_CLIENT_SECRET",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];
const saved = {};

const TREASURY = `treasury::1220${"ab".repeat(32)}`;
const OPERATOR = `operator::1220${"cd".repeat(32)}`;
const PAYEE = `user::1220${"ef".repeat(32)}`;
const CID = `00${"11".repeat(32)}`;
// The page-load binding token a browser would hold in JS memory (base64url, ≥22 chars).
const INSTANCE = "dGVzdC1pbnN0YW5jZS10b2tlbi0xMjM0NTY";

beforeEach(() => {
  resetSharedStoreForTests();
  for (const key of ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** Enough config for the legacy paths to reach their (stubbed) upstreams. */
function configureUpstreams() {
  process.env.VITE_ENTERPRISE_WALLET_PARTY_ID = TREASURY;
  process.env.VITE_TRUTHORACLE_PACKAGE_ID = "0a786ef1027354cb70a1cd78331680bf34054a642520dc0eb94c9ac4f775b837";
  process.env.VITE_TRUTHORACLE_PACKAGE_NAME = "truthoracle-v13";
  process.env.CANTON_LEDGER_PROXY_TARGET_URL = "https://ledger.test/api/ledger";
  process.env.ENTERPRISE_WALLET_PROXY_TARGET_URL = "https://wallet.test";
  process.env.KEYCLOAK_URL = "https://keycloak.test";
  process.env.KEYCLOAK_CLIENT_ID = "client";
  process.env.KEYCLOAK_CLIENT_SECRET = "secret";
}

/** An operator session exactly as the browser presents it: cookie + page-instance header. */
function operatorHeaders() {
  process.env.ADMIN_SESSION_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  process.env.ADMIN_OPERATORS = `${OPERATOR}=${"aa".repeat(32)}`;
  const { token } = issueSession(OPERATOR, INSTANCE);
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, "x-admin-instance": INSTANCE };
}

/**
 * One routed stub for every upstream the handlers touch. `payout` (or null) is what
 * the ledger reports for CID; the wallet answers "never submitted" for the status
 * check, then accepts the transfer and the MarkPaid submit.
 */
function stubUpstreams({ payout = null } = {}) {
  const calls = [];
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method || "GET" });
    if (target.includes("/protocol/openid-connect/token")) return json({ access_token: "tok", expires_in: 900 });
    if (target.endsWith("/v2/state/ledger-end")) return json({ offset: 42 });
    if (target.endsWith("/v2/state/active-contracts")) {
      if (!payout) return json([]);
      return json([
        {
          contractEntry: {
            JsActiveContract: {
              createdEvent: {
                contractId: CID,
                createArgument: {
                  admin: TREASURY,
                  user: PAYEE,
                  marketId: "7",
                  amountCC: "5.0000000000",
                  reason: payout.reason,
                },
              },
            },
          },
        },
      ]);
    }
    if (target.includes("/api/v1/history/")) return json({ events: [] });
    if (target.includes("/api/v1/transfer/")) return json({ error: "not found" }, 404);
    if (target.endsWith("/api/v1/transfer")) return json({ commandId: "accepted" });
    if (target.endsWith("/api/v1/external/submit")) return json({ ok: true });
    return json({ error: `unexpected upstream call: ${target}` }, 500);
  };
  return calls;
}

const walletCalls = (calls) => calls.filter((call) => call.url.startsWith("https://wallet.test"));

function post(body, headers = {}) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: "POST",
    url: "/api/wallet/test",
    headers: { host: "app.example.com", "x-real-ip": "203.0.113.5", ...headers },
  });
}

function response() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    body: "",
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk === undefined ? "" : Buffer.from(chunk).toString("utf8");
    },
  };
}

describe("deposit.mjs with BACKEND_URL set", () => {
  it("answers 410 moved_to_backend before touching any upstream", async () => {
    process.env.BACKEND_URL = "https://backend.example";
    configureUpstreams();
    const calls = stubUpstreams();
    const res = response();
    await depositHandler(post({ userPartyId: PAYEE }), res);
    assert.equal(res.statusCode, 410);
    const body = JSON.parse(res.body);
    assert.equal(body.error, "moved_to_backend");
    assert.match(body.message, /sign in/i);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(calls.length, 0);
  });

  it("treats a BACKEND_URL that is not an absolute URL as unset", async () => {
    stubUpstreams();
    for (const value of ["backend.example", "  ", "localhost:8091"]) {
      process.env.BACKEND_URL = value;
      const res = response();
      await depositHandler(post({ userPartyId: PAYEE }), res);
      // No treasury party configured → the LEGACY path's own 503, proving it ran.
      assert.equal(res.statusCode, 503, `BACKEND_URL=${JSON.stringify(value)}`);
      assert.match(JSON.parse(res.body).error, /VITE_ENTERPRISE_WALLET_PARTY_ID/);
    }
  });
});

describe("deposit.mjs without BACKEND_URL", () => {
  it("reconciles exactly as before", async () => {
    configureUpstreams();
    const calls = stubUpstreams();
    const res = response();
    await depositHandler(post({ userPartyId: PAYEE }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).credited, 0);
    assert.ok(calls.some((call) => call.url.includes("/api/v1/history/")), "reads the treasury transfer history");
    assert.ok(calls.some((call) => call.url.endsWith("/v2/state/active-contracts")), "reads the on-ledger wallet");
  });
});

describe("settle-payout.mjs with BACKEND_URL set", () => {
  beforeEach(() => {
    process.env.BACKEND_URL = "https://backend.example";
    configureUpstreams();
  });

  it("answers 410 to anyone without an operator session, before any upstream call", async () => {
    const calls = stubUpstreams({ payout: { reason: "bond" } });
    const res = response();
    await settleHandler(post({ pendingPayoutCid: CID }), res);
    assert.equal(res.statusCode, 410);
    assert.equal(JSON.parse(res.body).error, "moved_to_backend");
    assert.equal(calls.length, 0);
  });

  it("answers 410 to an operator too — withdrawal or not — before any upstream call", async () => {
    const headers = operatorHeaders();
    for (const reason of ["withdraw", "bond", "model-prize"]) {
      const calls = stubUpstreams({ payout: { reason } });
      const res = response();
      await settleHandler(post({ pendingPayoutCid: CID }, headers), res);
      assert.equal(res.statusCode, 410, reason);
      const body = JSON.parse(res.body);
      assert.equal(body.error, "moved_to_backend");
      assert.match(body.message, /backend/i);
      assert.equal(calls.length, 0, `${reason}: no ledger read, no transfer, no MarkPaid`);
    }
  });

  it("treats a BACKEND_URL that is not an absolute URL as unset", async () => {
    stubUpstreams({ payout: { reason: "bond" } });
    for (const value of ["backend.example", "  ", "localhost:8091"]) {
      process.env.BACKEND_URL = value;
      delete process.env.VITE_ENTERPRISE_WALLET_PARTY_ID;
      const res = response();
      await settleHandler(post({ pendingPayoutCid: CID }), res);
      // No treasury party configured → the LEGACY path's own 503, proving it ran.
      assert.equal(res.statusCode, 503, `BACKEND_URL=${JSON.stringify(value)}`);
      assert.match(JSON.parse(res.body).error, /VITE_ENTERPRISE_WALLET_PARTY_ID/);
    }
  });
});

describe("settle-payout.mjs without BACKEND_URL", () => {
  it("keeps the open-by-design behaviour, withdrawals included", async () => {
    configureUpstreams();
    const calls = stubUpstreams({ payout: { reason: "withdraw" } });
    const res = response();
    await settleHandler(post({ pendingPayoutCid: CID }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).settled, true);
    assert.ok(walletCalls(calls).some((call) => call.method === "POST" && call.url.endsWith("/api/v1/transfer")));
  });

  it("settles a non-withdraw payout for an operator exactly as before", async () => {
    configureUpstreams();
    const headers = operatorHeaders();
    const calls = stubUpstreams({ payout: { reason: "bond" } });
    const res = response();
    await settleHandler(post({ pendingPayoutCid: CID }, headers), res);
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.settled, true);
    assert.equal(body.to, PAYEE);
    assert.equal(body.amountCC, 5);
    const wallet = walletCalls(calls);
    assert.ok(wallet.some((call) => call.method === "POST" && call.url.endsWith("/api/v1/transfer")), "transfers");
    assert.ok(wallet.some((call) => call.method === "POST" && call.url.endsWith("/api/v1/external/submit")), "MarkPaid");
  });

  it("reports an already-archived payout as not settled, as before", async () => {
    configureUpstreams();
    stubUpstreams({ payout: null });
    const res = response();
    await settleHandler(post({ pendingPayoutCid: CID }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).settled, false);
  });
});
