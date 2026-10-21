/**
 * The ledger relay inventory (X1, truthoracle-backend docs/RAMP.md §14 F2): every call the browser
 * makes through /__proxy/ledger, classified, and the admin branch's allow-list pinned against it.
 *
 *   ledger, public   GET v2/state/connected-synchronizers, GET v2/state/ledger-end,
 *                    POST v2/state/active-contracts (lib/cantonParticipant.ts reads:
 *                    utils/activeContracts.ts, PayoutQueue's list),
 *                    POST v2/interactive-submission/prepare|execute (CantonWalletContext with
 *                    VITE_USE_PARTICIPANT_API, as the user's own party: never as the treasury,
 *                    never naming a ledger user; the body is checked before a token is minted).
 *   ledger, admin    GET v2/version, v2/packages, v2/parties/participant-id (diagnostics;
 *                    no console caller). Everything else, /v2/users and /v2/parties writes
 *                    included: 403 relay_write_disabled.
 *   wallet           gone (review F0): market resolution is the accounts backend's four-eyes
 *                    `market.resolve`; nothing in the browser signs as the treasury.
 *
 * The command bodies are built with the frontend's own builders and participant client, so a
 * change there shows up here.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { register } from "node:module";
import { Readable } from "node:stream";

register("./_support/frontend-loader.mjs", import.meta.url);

const PKG = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const TREASURY = "treasury::1220" + "ab".repeat(32);
globalThis.__VITE_ENV__ = { VITE_TRUTHORACLE_PACKAGE_ID: PKG, VITE_ENTERPRISE_WALLET_PARTY_ID: TREASURY };

const commands = await import("../frontend/utils/cantonCommands.ts");
// A namespace, not named imports: the red run on the code before this change reports each
// missing export as its own failing test instead of one unlinkable file.
const guard = await import("../api/_lib/proxyGuard.mjs");
const { authorise, inspectLedgerRead } = guard;
const { SESSION_COOKIE, issueSession } = await import("../api/_lib/adminSession.mjs");
const ledger = await import("../api/proxy/ledger.mjs");

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const OPERATOR = "operator::1220" + "cd".repeat(32);
const INSTANCE = "dGVzdC1pbnN0YW5jZS10b2tlbi0xMjM0NTY";
const USER = "user::1220" + "12".repeat(32);
const ENV = [
  "ADMIN_SESSION_SECRET",
  "ADMIN_OPERATORS",
  "VITE_TRUTHORACLE_PACKAGE_ID",
  "VITE_TRUTHORACLE_PACKAGE_NAME",
  "VITE_ENTERPRISE_WALLET_PARTY_ID",
  "CANTON_LEDGER_PROXY_TARGET_URL",
  "VITE_CANTON_PARTICIPANT_URL",
  "VITE_APP_NETWORK",
  ...["LEDGER_KEYCLOAK", "KEYCLOAK", "VITE_KEYCLOAK", "ZKPC_KEYCLOAK"].flatMap((p) =>
    ["URL", "REALM", "CLIENT_ID", "CLIENT_SECRET"].map((suffix) => `${p}_${suffix}`),
  ),
];
const saved = {};
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.ADMIN_SESSION_SECRET = SECRET;
  process.env.ADMIN_OPERATORS = `${OPERATOR}=${"00".repeat(32)}`;
  process.env.VITE_TRUTHORACLE_PACKAGE_ID = PKG;
  process.env.VITE_ENTERPRISE_WALLET_PARTY_ID = TREASURY;
  process.env.CANTON_LEDGER_PROXY_TARGET_URL = "https://ledger.example.test";
  process.env.VITE_TRUTHORACLE_PACKAGE_NAME = "truthoracle-v17";
  // The relay mints a client_credentials token before forwarding.
  process.env.KEYCLOAK_URL = "https://kc.example.test";
  process.env.KEYCLOAK_CLIENT_ID = "relay-test";
  process.env.KEYCLOAK_CLIENT_SECRET = "not-a-secret";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function sessionHeaders() {
  const { token } = issueSession(OPERATOR, INSTANCE);
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, "x-admin-instance": INSTANCE };
}

function request({ method = "GET", path, query = "", headers = {}, body } = {}) {
  const stream = body === undefined ? Readable.from([]) : Readable.from([Buffer.from(body)]);
  return Object.assign(stream, {
    method,
    url: `/__proxy/x/${path}${query ? `?${query}` : ""}`,
    query: { path },
    headers: { host: "app.example.com", ...headers },
  });
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk === undefined ? "" : Buffer.from(chunk).toString("utf8");
    },
  };
}

// ── the protobuf a participant's prepare answers (PreparedTransaction, only the parts the relay reads) ──
const varint = (n) => {
  const out = [];
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
  return Buffer.from(out);
};
const pbField = (number, payload) => Buffer.concat([varint(number * 8 + 2), varint(payload.length), payload]);
const pbText = (s) => Buffer.from(s, "utf8");
/** Metadata (field 2) with submitter_info (field 2) → act_as (field 1, repeated), command_id, synchronizer_id. */
const metadata = (actAs) =>
  pbField(2, Buffer.concat([pbField(2, Buffer.concat([...actAs.map((p) => pbField(1, pbText(p))), pbField(2, pbText("cmd-1"))])), pbField(3, pbText("sync::1220"))]));
const preparedTx = (actAs) => Buffer.concat([pbField(1, pbText("daml-transaction")), metadata(actAs)]).toString("base64");

/**
 * Every upstream the relay reaches: the Keycloak token endpoint and the ledger, whose prepare
 * answers a prepared transaction acting as the request's actAs. Records every call.
 */
function stubUpstream() {
  const calls = [];
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    calls.push({ url: href, init });
    if (href.startsWith("https://kc.example.test/")) return json({ access_token: "t", expires_in: 900 });
    if (href === "https://ledger.example.test/v2/state/ledger-end") return json({ offset: 7 });
    if (href === "https://ledger.example.test/v2/state/connected-synchronizers") return json({ connectedSynchronizers: [{ synchronizerId: "sync::1220" }] });
    if (href === "https://ledger.example.test/v2/interactive-submission/prepare") {
      return json({ preparedTransaction: preparedTx(JSON.parse(init.body).actAs), preparedTransactionHash: "aGFzaA==", hashingSchemeVersion: "HASHING_SCHEME_VERSION_V2" });
    }
    if (href === "https://ledger.example.test/v2/interactive-submission/execute") return json({ updateId: "upd-1" });
    return json({});
  };
  return calls;
}
const ledgerCalls = (calls) => calls.filter((c) => c.url.startsWith("https://ledger.example.test/"));

describe("relay inventory: the ledger relay", () => {
  it("keeps every read and the user's own submission the browser makes public", () => {
    for (const [method, path] of [
      ["GET", "v2/state/connected-synchronizers"],
      ["GET", "v2/state/ledger-end"],
      ["POST", "v2/state/active-contracts"],
      ["POST", "v2/interactive-submission/prepare"],
      ["POST", "v2/interactive-submission/execute"],
    ]) {
      const gate = authorise({ req: { method, headers: {} }, path, kind: "ledger", method });
      assert.equal(gate.allow, true, path);
      assert.equal(gate.operator, null, path);
      // F1 / F0: the active-contracts body (whose contracts it reads) and the submission's (whom it
      // acts as) are inspected before they go upstream.
      const inspected = ["v2/state/active-contracts", "v2/interactive-submission/prepare", "v2/interactive-submission/execute"];
      assert.equal(typeof gate.inspect, inspected.includes(path) ? "function" : "undefined", path);
    }
  });

  it("opens only GET diagnostics to a session, and nothing that writes", () => {
    const headers = { host: "app.example.com", ...sessionHeaders() };
    for (const path of ["v2/version", "v2/packages", "v2/parties/participant-id"]) {
      assert.equal(authorise({ req: { headers }, path, kind: "ledger", method: "GET" }).allow, true, path);
      assert.equal(authorise({ req: { headers }, path, kind: "ledger", method: "POST" }).error, "relay_write_disabled", `POST ${path}`);
    }
    for (const [method, path] of [
      ["POST", "v2/users"],
      ["POST", "v2/users/someone/rights"],
      ["GET", "v2/users"],
      ["POST", "v2/parties"],
      ["PATCH", "v2/parties/x"],
      ["POST", "v2/commands/submit-and-wait"],
      ["POST", "v2/commands/submit-and-wait-for-transaction"],
      ["POST", "v2/updates/flats"],
      ["DELETE", "v2/idps/x"],
      ["GET", "v2/version/../users"],
    ]) {
      const gate = authorise({ req: { headers }, path, kind: "ledger", method });
      assert.equal(gate.allow, false, `${method} ${path}`);
      assert.equal(gate.status, 403, `${method} ${path}`);
      assert.equal(gate.error, "relay_write_disabled", `${method} ${path}`);
    }
  });
});

describe("relay handlers", () => {
  it("ledger: public reads pass without a session; rights grants are refused before any upstream call", async () => {
    const calls = stubUpstream();
    const read = response();
    await ledger.default(request({ method: "POST", path: "v2/state/active-contracts", body: "{}" }), read);
    assert.equal(read.statusCode, 200);
    assert.equal(ledgerCalls(calls).length, 1);

    for (const headers of [{}, sessionHeaders()]) {
      const res = response();
      await ledger.default(request({ method: "POST", path: "v2/users/someone/rights", headers, body: "{}" }), res);
      assert.equal(res.statusCode, 403);
      assert.equal(JSON.parse(res.body).error, "relay_write_disabled");
    }
    assert.equal(ledgerCalls(calls).length, 1);

    const diag = response();
    await ledger.default(request({ method: "GET", path: "v2/version", headers: sessionHeaders() }), diag);
    assert.equal(diag.statusCode, 200);
    assert.equal(ledgerCalls(calls).length, 2);
  });

  it("ledger: bounds the body even on the public paths", async () => {
    const calls = stubUpstream();
    const res = response();
    await ledger.default(request({ method: "POST", path: "v2/interactive-submission/prepare", body: "x".repeat(ledger.MAX_BODY_BYTES + 1) }), res);
    assert.equal(res.statusCode, 413);
    assert.equal(ledgerCalls(calls).length, 0);
  });
});

describe("review F4: no Keycloak passthrough", () => {
  it("serves no function, rewrite or dev proxy that would forward the app's cookies to Keycloak", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    assert.equal(existsSync(new URL("../api/proxy/keycloak.mjs", import.meta.url)), false, "a file under api/ is a public function even without a rewrite");
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    assert.deepEqual(
      config.rewrites.filter((r) => /keycloak/i.test(`${r.source} ${r.destination}`)),
      [],
    );
    assert.doesNotMatch(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8"), /["']\/__proxy\/keycloak["']/);
  });
});

describe("review F1: the public ledger relay serves the treasury's market data, not its customers' contracts", () => {
  const acs = (party, ...entities) => ({
    activeAtOffset: "7",
    eventFormat: {
      filtersByParty: {
        [party]: {
          cumulative: entities.map((entity) => ({
            identifierFilter: { TemplateFilter: { value: { templateId: `#truthoracle-v17:Truthoracle:${entity}`, includeCreatedEventBlob: true } } },
          })),
        },
      },
      verbose: false,
    },
  });
  const USER = "user::1220" + "12".repeat(32);
  const read = (body, headers = {}) => request({ method: "POST", path: "v2/state/active-contracts", headers, body: JSON.stringify(body) });

  it("answers the browser's market reads as the treasury, and a party's own reads, with no session", async () => {
    const calls = stubUpstream();
    for (const body of [acs(TREASURY, "PredictionMarket"), acs(TREASURY, "MarketCounter"), acs(TREASURY, "OutcomeAttestation"), acs(USER, "UserWallet"), acs(USER, "PendingPayout")]) {
      const res = response();
      await ledger.default(read(body), res);
      assert.equal(res.statusCode, 200, JSON.stringify(body.eventFormat.filtersByParty));
    }
    const sent = ledgerCalls(calls).filter((c) => c.url.endsWith("/v2/state/active-contracts"));
    assert.equal(sent.length, 5);
    assert.deepEqual(JSON.parse(sent[0].init.body), acs(TREASURY, "PredictionMarket"), "the checked JSON is what goes upstream");
  });

  it("needs an admin session for any other read keyed by the treasury, or for every party", async () => {
    const wildcard = acs(TREASURY);
    wildcard.eventFormat.filtersByParty[TREASURY] = { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] };
    const anyParty = { activeAtOffset: "7", eventFormat: { filtersForAnyParty: { cumulative: [] }, verbose: false } };
    const legacy = { activeAtOffset: "7", filter: acs(TREASURY, "UserWallet").eventFormat };
    const userWildcard = acs(USER);
    userWildcard.eventFormat.filtersByParty[USER] = wildcard.eventFormat.filtersByParty[TREASURY];
    const userAmulet = acs(USER, "X");
    userAmulet.eventFormat.filtersByParty[USER].cumulative[0].identifierFilter.TemplateFilter.value.templateId = "#splice-amulet:Splice.Amulet:Amulet";
    const refused = [
      userWildcard,
      userAmulet,
      acs(TREASURY, "UserWallet"),
      acs(TREASURY, "PendingPayout"),
      acs(TREASURY, "PredictionMarket", "UserWallet"),
      wildcard,
      { ...acs(TREASURY, "PredictionMarket"), eventFormat: { ...acs(TREASURY, "PredictionMarket").eventFormat, filtersByParty: { [TREASURY]: { cumulative: [], extra: 1 } } } },
      anyParty,
      legacy,
    ];
    const calls = stubUpstream();
    for (const body of refused) {
      const res = response();
      await ledger.default(read(body), res);
      assert.equal(res.statusCode, 401, JSON.stringify(body));
      assert.match(JSON.parse(res.body).message, /needs an admin session/);
    }
    assert.equal(ledgerCalls(calls).length, 0);
    // The payout queue's read, from the operator's console: forwarded.
    const res = response();
    await ledger.default(read(acs(TREASURY, "PendingPayout"), sessionHeaders()), res);
    assert.equal(res.statusCode, 200);
    assert.equal(ledgerCalls(calls).length, 1);
  });

  it("fails closed on a body it cannot read or without the treasury's id", () => {
    assert.equal(inspectLedgerRead("not json", { headers: {} }).error, "relay_write_disabled");
    assert.equal(inspectLedgerRead("[]", { headers: {} }).error, "relay_write_disabled");
    delete process.env.VITE_ENTERPRISE_WALLET_PARTY_ID;
    const verdict = inspectLedgerRead(JSON.stringify(acs(USER, "UserWallet")), { headers: {} });
    assert.equal(verdict.allow, false);
    assert.match(verdict.message, /VITE_ENTERPRISE_WALLET_PARTY_ID is not set/);
  });
});

describe("review F0: the treasury wallet relay is gone", () => {
  it("serves no wallet function, rewrite or dev proxy, and its market guard is deleted", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    for (const file of ["../api/proxy/wallet.mjs", "../api/_lib/marketGuard.mjs"]) {
      assert.equal(existsSync(new URL(file, import.meta.url)), false, `${file}: a file under api/ is a public function even without a rewrite`);
    }
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    assert.deepEqual(config.rewrites.filter((r) => /wallet/i.test(`${r.source} ${r.destination}`)), []);
    const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    assert.doesNotMatch(vite, /__proxy\/wallet|proxy\/wallet\.mjs/);
    assert.doesNotMatch(readFileSync(new URL("../frontend/config.ts", import.meta.url), "utf8"), /VITE_ENTERPRISE_WALLET_PROXY_URL|VITE_ENTERPRISE_WALLET_APP_NAME/);
  });

  it("forwards no wallet path for anyone, an operator session included", () => {
    const headers = { host: "app.example.com", ...sessionHeaders() };
    for (const [method, path] of [["POST", "api/v1/external/submit"], ["POST", "api/v1/transfer"], ["GET", "api/v1/accounts"]]) {
      for (const h of [{}, headers]) {
        const gate = authorise({ req: { method, headers: h }, path, kind: "wallet", method });
        assert.deepEqual([gate.allow, gate.status, gate.error], [false, 403, "relay_write_disabled"], `${method} ${path}`);
      }
    }
  });

  it("drops the relay's market-choice check, its constants and every browser submit path", async () => {
    for (const name of ["MARKET_ADMIN_CHOICES", "MARKET_CLOCK_SKEW_SECONDS", "inspectMarketSubmit", "inspectWalletSubmit"]) {
      assert.equal(name in guard, false, name);
    }
    const ew = await import("../frontend/lib/enterpriseWalletSubmit.ts");
    assert.deepEqual(Object.keys(ew), ["enterpriseWalletPartyId"]);
    assert.equal(ew.enterpriseWalletPartyId(), TREASURY);
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const root = new URL("../frontend/", import.meta.url);
    const files = (dir) =>
      readdirSync(dir).flatMap((name) => {
        const url = new URL(name, dir);
        return statSync(url).isDirectory() ? files(new URL(`${name}/`, dir)) : /\.tsx?$/.test(name) ? [url] : [];
      });
    for (const url of files(root)) {
      const src = readFileSync(url, "utf8");
      assert.doesNotMatch(src, /__proxy\/wallet|ENTERPRISE_WALLET_PROXY_URL|submitViaEnterpriseWallet|submitAdminTransaction/, url.pathname);
    }
  });

  it("leaves no server-side wallet or ledger client (nothing imported them); upstream.mjs keeps only the treasury id", async () => {
    const { existsSync } = await import("node:fs");
    for (const file of ["../api/_lib/walletClient.mjs", "../api/_lib/ledgerClient.mjs", "./wallet-client.test.mjs", "./ledger-client.test.mjs"]) {
      assert.equal(existsSync(new URL(file, import.meta.url)), false, file);
    }
    const upstream = await import("../api/_lib/upstream.mjs");
    assert.deepEqual(Object.keys(upstream), ["adminPartyId"]);
    assert.equal(upstream.adminPartyId(), TREASURY);
  });
});

describe("the public interactive submission never acts as the treasury", () => {
  const prepareBody = (over = {}) => ({ commandId: "c1", synchronizerId: "sync::1220", commands: [], actAs: [USER], readAs: [], disclosedContracts: [], ...over });
  const executeBody = (over = {}) => ({ preparedTransaction: preparedTx([USER]), hashingSchemeVersion: "HASHING_SCHEME_VERSION_V2", partySignatures: { signatures: [] }, deduplicationPeriod: { Empty: {} }, submissionId: "s1", ...over });
  const prepare = (body) => guard.inspectSubmission("v2/interactive-submission/prepare", JSON.stringify(body));
  const execute = (body) => guard.inspectSubmission("v2/interactive-submission/execute", JSON.stringify(body));
  const refused = (verdict, pattern, label) => {
    assert.deepEqual([verdict.allow, verdict.status, verdict.error], [false, 403, "relay_write_disabled"], label);
    assert.match(verdict.message, pattern, label);
  };

  it("checks both bodies on the public paths", () => {
    for (const path of ["v2/interactive-submission/prepare", "v2/interactive-submission/execute"]) {
      const gate = authorise({ req: { method: "POST", headers: {} }, path, kind: "ledger", method: "POST" });
      assert.equal(gate.allow, true, path);
      assert.equal(typeof gate.inspect, "function", path);
    }
  });

  it("refuses a prepare acting or reading as the treasury, and forwards the user's as checked", () => {
    for (const [label, over] of [
      ["actAs", { actAs: [TREASURY] }],
      ["actAs with the user", { actAs: [USER, TREASURY] }],
      ["readAs", { readAs: [TREASURY] }],
      ["padded", { actAs: [` ${TREASURY} `] }],
      ["act_as", { act_as: [TREASURY] }],
      ["read_as", { read_as: [TREASURY] }],
    ]) {
      refused(prepare(prepareBody(over)), /does not prepare a transaction that acts or reads as the treasury/, label);
    }
    refused(prepare(prepareBody({ actAs: TREASURY })), /actAs must be a list of party ids/, "a bare string");
    refused(guard.inspectSubmission("v2/interactive-submission/prepare", "not json"), /forwards only a JSON prepare request/, "not json");
    const ok = prepare(prepareBody());
    assert.equal(ok.allow, true);
    assert.deepEqual(JSON.parse(ok.body), prepareBody());
  });

  it("refuses an execute whose prepared transaction acts as the treasury, or that carries its signature", () => {
    refused(execute(executeBody({ preparedTransaction: preparedTx([TREASURY]) })), /does not execute a transaction that acts or reads as the treasury/, "act_as");
    refused(execute(executeBody({ preparedTransaction: preparedTx([USER, TREASURY]) })), /acts or reads as the treasury/, "act_as with the user");
    refused(execute(executeBody({ partySignatures: { signatures: [{ party: TREASURY, signatures: [] }] } })), /acts or reads as the treasury/, "signature");
    // protobuf merges repeated metadata: a second one cannot hide the treasury behind the user's.
    const merged = Buffer.concat([Buffer.from(preparedTx([USER]), "base64"), metadata([TREASURY])]).toString("base64");
    refused(execute(executeBody({ preparedTransaction: merged })), /acts or reads as the treasury/, "a second metadata");
    assert.equal(execute(executeBody()).allow, true);
    assert.deepEqual(guard.preparedActAs(merged), [USER, TREASURY]);
  });

  it("refuses an execute it cannot read rather than guess whom it acts as", () => {
    const user = Buffer.from(preparedTx([USER]), "base64");
    const hex = (h) => Buffer.from(h, "hex");
    for (const [label, tx] of [
      ["missing", undefined],
      ["url-safe base64", preparedTx([USER]).replace(/\+/g, "-").replace(/\//g, "_") + "-_"],
      ["whitespace", ` ${preparedTx([USER])}`],
      ["truncated", user.subarray(0, user.length - 1).toString("base64")],
      // field 2 / wire 2 spelt as a 6-byte tag, and as a 5-byte one with bits past 32 (a 32-bit reader sees field 2)
      ["over-long tag", Buffer.concat([user, hex("928080808000"), Buffer.from([0])]).toString("base64")],
      ["tag past 32 bits", Buffer.concat([user, hex("9280808010"), Buffer.from([0])]).toString("base64")],
      ["a group", Buffer.concat([user, hex("2b2c")]).toString("base64")],
      ["no submitter", Buffer.from(pbField(1, pbText("tx"))).toString("base64")],
    ]) {
      refused(execute(executeBody({ preparedTransaction: tx })), /prepared transaction (cannot be read|names no submitting party)/, label);
    }
    refused(execute(executeBody({ prepared_transaction: preparedTx([TREASURY]) })), /not their snake_case spellings/, "snake_case");
    refused(execute(executeBody({ partySignatures: { signatures: [{ party: 7 }] } })), /partySignatures is unreadable/, "signatures");
  });

  it("refuses a prepare or execute that names whose ledger rights to use, in any spelling", async () => {
    for (const [key, field] of [
      ["userId", "userId"],
      ["user_id", "userId"],
      ["UserID", "userId"],
      ["applicationId", "applicationId"],
      ["application_id", "applicationId"],
    ]) {
      // The user's own submission with only the field added; an empty user id is refused too.
      for (const value of ["participant_admin", ""]) {
        const label = `${key}=${JSON.stringify(value)}`;
        refused(prepare(prepareBody({ [key]: value })), new RegExp(`does not prepare a request that names whose ledger rights to use \\(${field}\\)`), `prepare ${label}`);
        refused(execute(executeBody({ [key]: value })), new RegExp(`does not execute a request that names whose ledger rights to use \\(${field}\\)`), `execute ${label}`);
      }
    }
    // The caller's spelling is never echoed: a padded key would otherwise land in every log line.
    const padded = prepare(prepareBody({ [`user${"_".repeat(1000)}id`]: "x" }));
    assert.match(padded.message, /\(userId\)/);
    assert.ok(padded.message.length < 300, padded.message.length);
    // Only the request's own fields count: a choice argument's userId is the command's data.
    assert.equal(prepare(prepareBody({ commands: [{ ExerciseCommand: { choice: "X", choiceArgument: { userId: "u-1" } } }] })).allow, true);
    // Through the relay handler: refused with the sentence, and nothing reaches the ledger.
    const calls = stubUpstream();
    for (const [path, body] of [
      ["v2/interactive-submission/prepare", prepareBody({ userId: "participant_admin" })],
      ["v2/interactive-submission/execute", executeBody({ user_id: "participant_admin" })],
    ]) {
      const res = response();
      await ledger.default(request({ method: "POST", path, body: JSON.stringify(body) }), res);
      assert.equal(res.statusCode, 403, path);
      assert.equal(JSON.parse(res.body).error, "relay_write_disabled", path);
      assert.match(JSON.parse(res.body).message, /names whose ledger rights to use \(userId\): the relay's own token decides that/, path);
    }
    assert.equal(ledgerCalls(calls).length, 0);
  });

  it("checks the body before the relay mints its token: a refused one reaches neither Keycloak nor the ledger", async () => {
    // A client id no earlier test minted for, so the token cache cannot hide a Keycloak call.
    process.env.KEYCLOAK_CLIENT_ID = `relay-order-${process.hrtime.bigint()}`;
    const calls = stubUpstream();
    const keycloak = () => calls.filter((c) => c.url.startsWith("https://kc.example.test/"));
    const post = async (path, body) => {
      const res = response();
      await ledger.default(request({ method: "POST", path, body: JSON.stringify(body) }), res);
      return res;
    };
    // Bodies the relay refused before this change too: only the order of the check and the token is new.
    for (const [path, body, status] of [
      ["v2/interactive-submission/prepare", prepareBody({ actAs: [TREASURY] }), 403],
      ["v2/interactive-submission/execute", executeBody({ preparedTransaction: preparedTx([TREASURY]) }), 403],
      ["v2/state/active-contracts", { activeAtOffset: "7", eventFormat: { filtersForAnyParty: { cumulative: [] } } }, 401],
    ]) {
      const res = await post(path, body);
      assert.equal(res.statusCode, status, path);
      assert.ok(JSON.parse(res.body).message, `${path}: a sentence`);
    }
    assert.deepEqual([keycloak().length, ledgerCalls(calls).length], [0, 0], "nothing minted, nothing forwarded");

    // The user's own prepare: one token minted and sent as the bearer, the checked JSON sent as JSON.
    const ok = await post("v2/interactive-submission/prepare", prepareBody());
    assert.equal(ok.statusCode, 200);
    assert.equal(keycloak().length, 1);
    const [sent] = ledgerCalls(calls);
    assert.equal(sent.init.headers.authorization, "Bearer t");
    assert.equal(sent.init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(sent.init.body), prepareBody());
  });

  it("fails closed: without the treasury's id no prepare or execute goes through", () => {
    delete process.env.VITE_ENTERPRISE_WALLET_PARTY_ID;
    refused(prepare(prepareBody()), /VITE_ENTERPRISE_WALLET_PARTY_ID is not set on this deployment.*forwards none/, "prepare");
    refused(execute(executeBody()), /VITE_ENTERPRISE_WALLET_PARTY_ID is not set on this deployment.*forwards none/, "execute");
  });

  it("end to end: the browser's own submissions pass the relay; one as the treasury never reaches the ledger", async () => {
    const upstream = stubUpstream();
    const toUpstream = globalThis.fetch;
    const relayed = [];
    // The browser's participant client calls the real relay handler; the relay calls the stubbed ledger.
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (!href.startsWith("/__proxy/ledger/")) return toUpstream(url, init);
      const path = href.slice("/__proxy/ledger/".length);
      const res = response();
      await ledger.default(request({ method: init.method ?? "GET", path, headers: { ...(init.headers ?? {}) }, body: init.body }), res);
      relayed.push({ path, status: res.statusCode });
      return new Response(res.body, { status: res.statusCode, headers: { "content-type": "application/json" } });
    };
    const { createParticipantClient } = await import("../frontend/lib/cantonParticipant.ts");
    const client = createParticipantClient();
    // What CantonWalletContext submits with VITE_USE_PARTICIPANT_API: a trade, a withdrawal, a payout cancel.
    for (const params of [
      commands.buildBuyParams(USER, "00market", "Yes", 10, 9, null, "00wallet"),
      commands.buildWalletWithdrawParams(USER, "00wallet", 5),
      commands.buildCancelPayoutParams(USER, "00payout", "00wallet"),
    ]) {
      assert.deepEqual(await client.submitTransaction(params), { hash: "upd-1" });
    }
    assert.ok(relayed.every((r) => r.status === 200), JSON.stringify(relayed));
    const sent = ledgerCalls(upstream).filter((c) => c.url.endsWith("/prepare"));
    assert.deepEqual(sent.map((c) => JSON.parse(c.init.body).actAs), [[USER], [USER], [USER]]);

    const before = ledgerCalls(upstream).length;
    await assert.rejects(client.submitTransaction(commands.buildWalletWithdrawParams(TREASURY, "00wallet", 5)), /Prepare failed \(403\).*acts or reads as the treasury/);
    assert.equal(ledgerCalls(upstream).length, before, "nothing reached the ledger");
  });
});
