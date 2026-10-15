/**
 * The server-side ledger client (api/_lib/ledgerClient.mjs) against a stubbed participant.
 *
 * Two things are pinned here. The template-id spellings: the JSON Ledger API accepts two
 * and is strict about where each may appear — active-contracts filters take ONLY the
 * package-name form ("#name:Module:Entity") and reject the package-id form with
 * INVALID_FIELD "expected a package name", while commands pin the package by id. And the
 * GetActiveContractsRequest body: Canton 3.6 disables the legacy top-level `filter` /
 * `verbose` fields (DEPRECATED_API_DISABLED), so only `activeAtOffset` may sit next to
 * `eventFormat`, whose own `verbose` flag is the one that counts. The record parsers follow
 * truthoracle-v17: one UserWallet per (owner, instrument), amounts next to their instrument.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  activeContractsRequest,
  fetchPendingPayout,
  fetchUserWallet,
  filterTemplateId,
  parseInstrument,
  sameInstrument,
  templateId,
} from "../api/_lib/ledgerClient.mjs";

const PKG_ID = "64653d3a4b63abcff3a0f016cdf08b0c46aa827f0b971b8990a7fdf5ede6446a";
const TREASURY = "treasury::1220aa";
const USER = "user::1220bb";
const CC = { admin: "DSO::1220dd", id: "Amulet" };
const BYN = { admin: "agent::1220ee", id: "cBYN" };

const ENV = {
  VITE_TRUTHORACLE_PACKAGE_ID: PKG_ID,
  VITE_TRUTHORACLE_PACKAGE_NAME: "truthoracle-v17",
  VITE_APP_NETWORK: "devnet",
  CANTON_LEDGER_PROXY_TARGET_URL: "https://ledger.test/api/ledger",
  KEYCLOAK_URL: "https://auth.test",
  KEYCLOAK_REALM: "master",
  KEYCLOAK_CLIENT_ID: "test-client",
  KEYCLOAK_CLIENT_SECRET: "test-secret",
};
const saved = {};
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  globalThis.fetch = realFetch;
});

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** A participant that answers the token mint, ledger-end and one active-contracts page, recording every request. */
function stubParticipant(contracts) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", body: parseBody(init.body) });
    if (u.includes("/protocol/openid-connect/token")) return json({ access_token: "tok", expires_in: 300 });
    if (u.endsWith("/v2/state/ledger-end")) return json({ offset: 4242 });
    if (u.endsWith("/v2/state/active-contracts")) {
      return json(
        contracts.map(({ contractId, payload }) => ({
          contractEntry: { JsActiveContract: { createdEvent: { contractId, createArgument: payload } } },
        })),
      );
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return calls;
}

/** The Keycloak mint posts a URL-encoded form; everything else is JSON. Keep the recorded body honest for both. */
function parseBody(body) {
  if (typeof body !== "string" || !body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

describe("templateId (commands)", () => {
  it("uses the package-id form", () => {
    assert.equal(templateId("UserWallet"), `${PKG_ID}:Truthoracle:UserWallet`);
  });

  it("fails fast without a package id", () => {
    delete process.env.VITE_TRUTHORACLE_PACKAGE_ID;
    assert.throws(() => templateId("UserWallet"), /VITE_TRUTHORACLE_PACKAGE_ID/);
  });
});

describe("filterTemplateId (active-contracts filters)", () => {
  it("uses the package-name reference the participant requires", () => {
    assert.equal(filterTemplateId("UserWallet"), "#truthoracle-v17:Truthoracle:UserWallet");
    assert.equal(filterTemplateId("PendingPayout"), "#truthoracle-v17:Truthoracle:PendingPayout");
  });

  it("never falls back to the package-id form", () => {
    delete process.env.VITE_TRUTHORACLE_PACKAGE_NAME;
    assert.throws(() => filterTemplateId("UserWallet"), /VITE_TRUTHORACLE_PACKAGE_NAME/);
  });

  it("honours the module override", () => {
    assert.equal(filterTemplateId("PredictionModel", "Marketplace"), "#truthoracle-v17:Marketplace:PredictionModel");
  });
});

describe("activeContractsRequest (GetActiveContractsRequest body)", () => {
  it("sends only activeAtOffset next to eventFormat — no legacy top-level verbose or filter", () => {
    const body = activeContractsRequest(TREASURY, "UserWallet", "4242");
    assert.deepEqual(Object.keys(body).sort(), ["activeAtOffset", "eventFormat"]);
    assert.equal(body.activeAtOffset, "4242");
    assert.equal(body.eventFormat.verbose, false);
    const [filter] = body.eventFormat.filtersByParty[TREASURY].cumulative;
    assert.deepEqual(filter, {
      identifierFilter: {
        TemplateFilter: { value: { templateId: "#truthoracle-v17:Truthoracle:UserWallet", includeCreatedEventBlob: false } },
      },
    });
  });
});

describe("fetchUserWallet (truthoracle-v17: one wallet per owner and instrument)", () => {
  const wallets = [
    {
      contractId: "00cc",
      payload: { admin: TREASURY, owner: USER, instrument: CC, balance: "12.5000000000", deposited: "20.0000000000", withdrawn: "7.5000000000", creditRefs: ["dep:1"] },
    },
    {
      contractId: "00byn",
      payload: { admin: TREASURY, owner: USER, instrument: BYN, balance: "3.0000000000", deposited: "3.0000000000", withdrawn: "0.0000000000", creditRefs: [] },
    },
    { contractId: "00other", payload: { admin: TREASURY, owner: "someone::1", instrument: CC, balance: "99", deposited: "99", withdrawn: "0", creditRefs: [] } },
  ];

  it("reads the ledger end, posts the eventFormat request as the admin and picks the owner's wallet of that instrument", async () => {
    const calls = stubParticipant(wallets);
    const wallet = await fetchUserWallet(TREASURY, USER, BYN);
    assert.deepEqual(wallet, {
      contractId: "00byn",
      owner: USER,
      instrument: BYN,
      balance: 3,
      deposited: 3,
      withdrawn: 0,
      creditRefs: [],
    });
    const acs = calls.find((c) => c.url.endsWith("/v2/state/active-contracts"));
    assert.equal(acs.method, "POST");
    assert.deepEqual(Object.keys(acs.body).sort(), ["activeAtOffset", "eventFormat"]);
    assert.equal(acs.body.activeAtOffset, "4242");
    assert.ok(acs.body.eventFormat.filtersByParty[TREASURY], "queried as the admin party");
    const ledgerEnd = calls.find((c) => c.url.endsWith("/v2/state/ledger-end"));
    assert.equal(ledgerEnd.method, "GET");
  });

  it("keeps instruments apart and answers null for one the owner never held", async () => {
    stubParticipant(wallets);
    const cc = await fetchUserWallet(TREASURY, USER, CC);
    assert.equal(cc?.contractId, "00cc");
    assert.equal(cc?.balance, 12.5);
    assert.deepEqual(cc?.creditRefs, ["dep:1"]);
    assert.equal(await fetchUserWallet(TREASURY, USER, { admin: "issuer::1", id: "TRO" }), null);
  });

  it("refuses a call that does not name the instrument", async () => {
    stubParticipant(wallets);
    await assert.rejects(fetchUserWallet(TREASURY, USER), /instrument/);
  });
});

describe("fetchPendingPayout", () => {
  it("returns the payout with the instrument it is owed in, or null once archived", async () => {
    stubParticipant([
      {
        contractId: "00pay",
        payload: { admin: TREASURY, user: USER, marketId: "7", instrument: BYN, amount: "4.2500000000", reason: "withdraw", createdAt: "1700000000", auditObservers: [] },
      },
    ]);
    assert.deepEqual(await fetchPendingPayout(TREASURY, "00pay"), {
      contractId: "00pay",
      user: USER,
      marketId: 7,
      instrument: BYN,
      amount: 4.25,
      reason: "withdraw",
    });
    assert.equal(await fetchPendingPayout(TREASURY, "00gone"), null);
  });
});

describe("instrument helpers", () => {
  it("parse the ledger's InstrumentId shape and compare field by field", () => {
    assert.deepEqual(parseInstrument({ admin: "a", id: "cBYN" }), { admin: "a", id: "cBYN" });
    assert.deepEqual(parseInstrument(undefined), { admin: "", id: "" });
    assert.ok(sameInstrument(CC, { admin: CC.admin, id: "Amulet" }));
    assert.ok(!sameInstrument(CC, BYN));
    assert.ok(!sameInstrument(CC, null));
  });
});
