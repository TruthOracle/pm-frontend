/**
 * Market resolution through the accounts backend (review F0, lib/marketResolution.ts): the route's
 * GET and POST, its 202 / 200 answers and the C23 signature step; the market page's console that
 * offers only what the backend accepts; the approvals console's `market.resolve` figures and its
 * Approve gate; and the env names the deleted wallet relay and server clients leave behind.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

// Imported inside each test: on the code before this change every test fails on its own.
const route = () => import("../frontend/lib/marketResolution.ts");
const figuresLib = () => import("../frontend/lib/rampApprovalFigures.ts");
const admin = await import("../frontend/lib/rampAdmin.ts");
const { RampAdminError } = await import("../frontend/lib/rampAdminErrors.ts");
const { BackendError } = await import("../frontend/lib/backend.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch stub answering each call with the next [status, body] and recording every call. */
function replies(...answers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined });
    const [status, body] = answers.length > 1 ? answers.shift() : answers[0];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return calls;
}

// The backend's own construction (admin-approval.logic.ts paramsHashOf, admin-approval.service.ts requestMessage).
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const canonical = (v) =>
  JSON.stringify(
    (function norm(x) {
      if (Array.isArray(x)) return x.map(norm);
      if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, norm(x[k])]));
      return x;
    })(v),
  );

const URL_12 = "/__backend/api/v1/admin/markets/12/resolution";
const EXPIRES = "2026-10-19T12:00:00.000Z";
// The backend's snapshot (ApiMarketResolutionSnapshot): the decision fields, never the contract id.
const SNAPSHOT = {
  marketId: "12",
  ticker: "BTC-26OCT-100K",
  question: "Will BTC close above 100k?",
  status: "Trading",
  expiresAt: EXPIRES,
  gracePeriodSecs: 172800,
  collateral: { admin: "cantor8::1220ee", id: "cBYN" },
  operatorResolution: true,
  sources: ["https://src.example/result"],
  outcome: null,
};
const approval = (over = {}) => ({
  id: "6f1c2b9e-0000-4000-8000-0000000000a1",
  action: "market.resolve",
  subjectType: "market",
  subjectId: "12",
  params: { choice: "ResolveT0", outcome: "Yes", sourceUri: "https://src.example/result" },
  paramsHash: "ab".repeat(32),
  precondition: SNAPSHOT,
  description: "ResolveT0 market #12 (BTC-26OCT-100K) -> Yes from https://src.example/result",
  reason: "source published",
  status: "pending",
  singleControl: false,
  requestedByUserId: "u-a",
  requestedByParty: "op-a::1220aa",
  requestedByPerson: "alice",
  requestedAt: "2026-10-19T12:05:00.000Z",
  decidedByUserId: null,
  decidedByParty: null,
  decidedByPerson: null,
  decidedAt: null,
  decisionReason: null,
  executedAt: null,
  result: null,
  error: null,
  expiresAt: "2026-10-21T20:59:59.000Z",
  ...over,
});
const state = (over = {}) => ({
  market: { marketId: 12, ticker: SNAPSHOT.ticker, status: "Trading" },
  windows: { resolveT0From: EXPIRES, resolveT0To: "2026-10-21T12:00:00.000Z", resolveFrom: EXPIRES, voidFrom: "2026-10-21T12:00:01.000Z" },
  choicesAvailable: ["ResolveT0", "Resolve"],
  pending: null,
  asOf: "2026-10-19T12:10:00.000Z",
  ...over,
});
const invalid = (e) => e instanceof BackendError && e.code === "invalid_response";

describe("the route: GET and POST /api/v1/admin/markets/:marketId/resolution", () => {
  it("reads the state strictly and offers only what the backend accepts, nothing while a request is pending", async () => {
    const r = await route();
    const calls = replies([200, state({ choicesAvailable: ["ResolveT0", "Resolve", "Burn"] })], [200, state({ pending: approval() })], [200, { market: {}, choicesAvailable: [] }], [200, state({ pending: {} })]);
    const open = await r.fetchMarketResolution(12);
    assert.deepEqual([calls[0].url, calls[0].method], [URL_12, "GET"]);
    assert.deepEqual(open.choicesAvailable, ["ResolveT0", "Resolve"]);
    assert.deepEqual(r.offeredChoices(open), ["ResolveT0", "Resolve"]);
    assert.equal(open.windows.voidFrom, "2026-10-21T12:00:01.000Z");
    assert.equal(open.asOf, "2026-10-19T12:10:00.000Z");
    const waiting = await r.fetchMarketResolution(12);
    assert.equal(waiting.pending.id, approval().id);
    assert.deepEqual(r.offeredChoices(waiting), [], "a pending request is shown instead of a second one");
    await assert.rejects(r.fetchMarketResolution(12), invalid, "no windows");
    await assert.rejects(r.fetchMarketResolution(12), invalid, "a pending request it cannot read");
    assert.deepEqual(r.offeredChoices(null), []);
  });

  it("posts the contract's body, the console's VoidOutcome as Void, and reads 202 and 200", async () => {
    const r = await route();
    const executed = approval({ status: "executed", singleControl: true, params: { choice: "VoidMarket" } });
    const calls = replies(
      [202, { approval: approval() }],
      [202, { approval: approval({ params: { choice: "Resolve", attestationCids: ["00att-1", "00att-2"] } }) }],
      [200, { approval: executed, result: { marketId: 12, choice: "VoidMarket", commandId: "cmd-77" } }],
      [200, { result: {} }],
    );
    assert.equal(r.wireOutcome("VoidOutcome"), "Void");
    const pending = await r.requestMarketResolution(12, { choice: "ResolveT0", outcome: r.wireOutcome("VoidOutcome"), sourceUri: " https://src.example/result " }, "source published");
    assert.deepEqual([calls[0].url, calls[0].method], [URL_12, "POST"]);
    assert.deepEqual(calls[0].body, { choice: "ResolveT0", outcome: "Void", sourceUri: "https://src.example/result", reason: "source published" });
    assert.equal(pending.approval.status, "pending");
    await r.requestMarketResolution(12, { choice: "Resolve", attestationCids: ["00att-1", "00att-2"], outcome: "Yes" }, "quorum");
    assert.deepEqual(calls[1].body, { choice: "Resolve", attestationCids: ["00att-1", "00att-2"], reason: "quorum" }, "only the fields the choice takes");
    const done = await r.requestMarketResolution(12, { choice: "VoidMarket", sourceUri: "x" }, "grace over");
    assert.deepEqual(calls[2].body, { choice: "VoidMarket", reason: "grace over" });
    assert.deepEqual(done.result, { marketId: 12, choice: "VoidMarket", commandId: "cmd-77" });
    await assert.rejects(r.requestMarketResolution(12, { choice: "VoidMarket" }, "x"), invalid, "an answer without the approval");
    assert.equal(r.MARKET_RESOLVE_ACTION, "market.resolve");
    assert.equal(r.MARKET_SUBJECT_TYPE, "market");
  });

  it("says who asked and when (UTC) while waiting, and what was submitted once executed", async () => {
    const r = await route();
    const waiting = r.resolutionAnswerSentence({ approval: approval() });
    assert.equal(waiting.title, "Waiting for a second person to approve");
    assert.equal(waiting.status, "info");
    assert.match(waiting.description, /^ResolveT0 → Yes from https:\/\/src\.example\/result is waiting for a second person to approve: requested by alice at 2026-10-19 12:05:00 UTC, expires 2026-10-21 20:59:59 UTC \(approval 6f1c2b9e\)\. A person with the approver role approves it/);
    assert.equal(r.pendingResolutionSentence(approval({ requestedByPerson: null })).includes("requested by op-a::1220aa…"), true);
    const done = r.resolutionAnswerSentence({
      approval: approval({ status: "executed", singleControl: true }),
      result: { marketId: 12, choice: "ResolveT0", commandId: "cmd-77" },
    });
    assert.deepEqual([done.title, done.status], ["ResolveT0 submitted", "success"]);
    assert.match(done.description, /market #12 was submitted by the backend as the treasury \(command cmd-77\), requested by alice at 2026-10-19 12:05:00 UTC, single control/);
    const failed = r.resolutionAnswerSentence({ approval: approval({ status: "failed", error: "market not yet expired" }) });
    assert.deepEqual([failed.status, failed.description.endsWith("is failed: market not yet expired")], ["warning", true]);
    assert.equal(r.resolutionAnswerSentence({ approval: approval({ status: "approved" }) }).status, "info");
  });

  it("C23: a single-control request is signed over exactly its params, then goes out with the signature", async () => {
    const r = await route();
    const input = { choice: "VoidMarket" };
    const hash = sha(canonical({ action: "market.resolve", subjectType: "market", subjectId: "12", params: { choice: "VoidMarket" } }));
    const message = `truthoracle-approval:request:market.resolve:12:${hash}:${"cd".repeat(32)}`;
    const calls = replies(
      [400, { error: "approval_signature_required", message: "sign it", details: { message } }],
      [200, { approval: approval({ status: "executed", singleControl: true, params: input }), result: { marketId: 12, choice: "VoidMarket", commandId: "cmd-9" } }],
    );
    const send = (signature) => r.requestMarketResolution(12, input, "grace over", signature);
    const step = await admin.sendDecisionUnsigned(send, r.resolutionSignedRequest(12, input));
    assert.equal(admin.isSignatureStep(step), true);
    assert.equal(step.signatureMessage, message);
    assert.equal(calls[0].body.signature, undefined);
    const answer = await admin.sendDecisionSigned(send, step.signatureMessage, async (m) => `sig:${m.slice(-8)}`);
    assert.deepEqual(calls[1].body, { choice: "VoidMarket", reason: "grace over", signature: `sig:${message.slice(-8)}` });
    assert.equal(answer.result.commandId, "cmd-9");
    // A message that commits to another decision is never signed.
    replies([400, { error: "approval_signature_required", message: "sign it", details: { message } }]);
    const other = { choice: "ResolveT0", outcome: "Yes", sourceUri: "https://src.example/result" };
    await assert.rejects(admin.sendDecisionUnsigned(send, r.resolutionSignedRequest(12, other)), (e) => e instanceof RampAdminError);
  });
});

describe("the approvals console: market.resolve figures, and Approve only once all of them are on screen", () => {
  const byLabel = (figs) => Object.fromEntries(figs.map((f) => [f.label, f.value]));
  // The backend's snapshot shape (ApiMarketResolutionSnapshot.attestations): `cid`, ISO time, no attester.
  const ATT = [
    { cid: "00att-1", outcome: "Yes", sourceUri: "https://a.example/r", fetchedAt: "2026-10-19T12:30:00.000Z" },
    { cid: "00att-2", outcome: "Yes", sourceUri: "https://b.example/r", fetchedAt: "2026-10-19T12:45:07.000Z" },
  ];
  const resolve = (atts = ATT, cids = ["00att-2", "00att-1"]) =>
    approval({ params: { choice: "Resolve", attestationCids: cids }, precondition: { ...SNAPSHOT, attestations: atts } });

  it("ResolveT0: the choice, the market, the outcome, the source, the collateral and the windows (UTC)", async () => {
    const f = await figuresLib();
    const figs = f.approvalFigures(approval());
    assert.deepEqual(figs[0], { label: "Resolves", value: "Market #12 (BTC-26OCT-100K) resolves Yes (T0 operator, source https://src.example/result)", strong: true });
    assert.deepEqual(byLabel(figs.slice(1)), {
      Choice: "ResolveT0 (T0 operator resolution)",
      Market: "#12 · BTC-26OCT-100K · Will BTC close above 100k?",
      Outcome: "Yes",
      Source: "https://src.example/result",
      Collateral: "cBYN · registry cantor8::1220ee…",
      Expiry: "2026-10-19 12:00:00 UTC",
      Grace: "48 h: T0 2026-10-19 12:00:00 UTC – 2026-10-21 12:00:00 UTC; attestations from 2026-10-19 12:00:00 UTC; void from 2026-10-21 12:00:01 UTC",
      "Source allowlist": "https://src.example/result",
      "At request": "Trading",
    });
    assert.equal(f.marketResolveProblem(approval()), null);
    const voided = f.approvalFigures(approval({ params: { choice: "ResolveT0", outcome: "Void", sourceUri: "https://src.example/result" } }));
    assert.match(voided[0].value, /^Market #12 \(BTC-26OCT-100K\) is voided by the operator \(T0, source https:\/\/src\.example\/result\): traders redeem their cost basis$/);
  });

  it("Resolve: each attestation's outcome, source and fetch time (UTC), in the request's order", async () => {
    const f = await figuresLib();
    const figs = byLabel(f.approvalFigures(resolve()));
    assert.equal(figs.Resolves, "Market #12 (BTC-26OCT-100K) resolves Yes from 2 attestations");
    assert.equal(figs["Attestation 1"], "Yes · https://b.example/r · fetched 2026-10-19 12:45:07 UTC · 00att-2…");
    assert.equal(figs["Attestation 2"], "Yes · https://a.example/r · fetched 2026-10-19 12:30:00 UTC · 00att-1…");
    assert.equal(f.marketResolveProblem(resolve()), null);
    const split = byLabel(f.approvalFigures(resolve([ATT[0], { ...ATT[1], outcome: "No" }])));
    assert.equal(split.Resolves, "Market #12 (BTC-26OCT-100K) from 2 attestations that disagree (No / Yes): the ledger refuses it");
  });

  it("VoidMarket: the void window from the snapshot's expiry and grace, as the backend computes it", async () => {
    const f = await figuresLib();
    const figs = byLabel(f.approvalFigures(approval({ params: { choice: "VoidMarket" } })));
    assert.equal(figs.Resolves, "Market #12 (BTC-26OCT-100K) is voided (no tier resolved it in the grace period): traders redeem their cost basis");
    assert.equal(figs.Expiry, "2026-10-19 12:00:00 UTC");
    assert.match(figs.Grace, /void from 2026-10-21 12:00:01 UTC$/);
    // The snapshot records no windows: they are the backend's resolutionWindows of the expiry and grace.
    const recorded = { ...SNAPSHOT, windows: { voidFrom: "2026-10-21T12:00:05Z" } };
    assert.match(byLabel(f.approvalFigures(approval({ params: { choice: "VoidMarket" }, precondition: recorded }))).Grace, /void from 2026-10-21 12:00:01 UTC$/);
  });

  it("keeps Approve disabled while a figure is missing, or when the snapshot is of another market", async () => {
    const f = await figuresLib();
    const { ticker, question, ...anonymous } = SNAPSHOT;
    assert.ok(ticker && question);
    assert.match(f.marketResolveProblem(approval({ precondition: anonymous })), /does not show the ticker, the question, so it cannot be approved/);
    assert.match(f.marketResolveProblem(approval({ params: { choice: "ResolveT0", outcome: "Yes" } })), /does not show the source/);
    assert.match(f.marketResolveProblem(resolve([ATT[0], { ...ATT[1], fetchedAt: null }])), /attestation 1's outcome, source and fetch time/);
    assert.match(f.marketResolveProblem(resolve([], [])), /does not show the attestations/);
    assert.match(f.marketResolveProblem(approval({ params: { choice: "Burn" } })), /does not show a known choice/);
    const { expiresAt, gracePeriodSecs, collateral, ...timeless } = SNAPSHOT;
    assert.ok(expiresAt && gracePeriodSecs && collateral);
    assert.match(f.marketResolveProblem(approval({ precondition: timeless })), /the collateral, the expiry, the grace period/);
    assert.match(f.marketResolveProblem(approval({ precondition: { ...SNAPSHOT, marketId: "13" } })), /snapshot is of market #13, the request of #12/);
    assert.equal(f.marketResolveProblem(approval({ precondition: { ...SNAPSHOT, marketId: 12 } })), null, "a numeric id is the same market");
  });

  it("never shows a market resolution as the generic parameter dump", async () => {
    const f = await figuresLib();
    const labels = f.approvalFigures(approval()).map((x) => x.label);
    assert.equal(labels.some((l) => /\(at request\)$|^choice$|^source uri$/.test(l)), false, labels.join(", "));
  });
});

describe("wiring the node tests cannot render (TSX): pinned in the source", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (path) => readFileSync(new URL(`../frontend/${path}`, import.meta.url), "utf8");

  it("the approvals panel blocks Approve, Sign next and approve-many on a market resolution's missing figures", () => {
    const panel = src("components/Admin/RampApprovalsPanel.tsx");
    assert.match(panel, /if \(a\.action === MARKET_RESOLVE_ACTION\) return marketResolveProblem\(a\);/);
    assert.match(panel, /disabled=\{busy !== null \|\| blocker !== null \|\| figuresBlocker\(a\) !== null \|\| !reasonOk\}/);
    assert.match(panel, /const manyBlocked = chosen\.some\(\(a\) => figuresBlocker\(a\) !== null\);/);
    // The row says why, not only the disabled button's tooltip.
    assert.match(panel, /const marketProblem = market && open \? marketResolveProblem\(a\) : null;/);
    assert.match(panel, /\{marketProblem && <p className="mt-1 text-\[11px\] text-amber-700">\{marketProblem\}<\/p>\}/);
  });

  it("the market page requests resolution from the backend and signs nothing as the treasury", () => {
    const view = src("components/market/MarketView.tsx");
    assert.doesNotMatch(view, /submitAdminTransaction|buildResolveT0Params|buildResolveParams|buildVoidMarketParams|handleResolveT0|handleVoidMarket/);
    assert.match(view, /const operator = auth\.sessionKind === "admin";/);
    assert.match(src("components/market/MarketResolutionPanel.tsx"), /<MarketOperatorResolution key=\{market\.marketId\} market=\{market\} attestations=\{attestations\} onSubmitted=\{onResolutionSubmitted\} \/>/);
    const console = src("components/market/MarketOperatorResolution.tsx");
    assert.match(console, /requestMarketResolution\(marketId, input, why, signature\)/);
    assert.match(console, /const offered = offeredChoices\(state, session\);/);
    assert.match(console, /pendingResolutionSentence\(state\.pending\)/);
    assert.doesNotMatch(console, /signAndSubmitTransaction|enterpriseWalletSubmit|external\/submit/);
  });
});

describe(".env.example after the wallet relay and the server-side wallet and ledger clients", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const active = new Set([...read(".env.example").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const files = (dir) =>
    readdirSync(new URL(`../${dir}`, import.meta.url)).flatMap((name) => {
      const path = `${dir}/${name}`;
      return statSync(new URL(`../${path}`, import.meta.url)).isDirectory() ? files(path) : /\.(mjs|tsx?)$/.test(name) ? [path] : [];
    });
  const server = files("api").map(read).join("\n");
  const sources = [server, ...files("frontend").map(read), read("vite.config.ts"), read("capacitor.config.ts")].join("\n");

  it("drops the names nothing reads any more, the Enterprise Wallet's included", () => {
    const wallet = ["ENTERPRISE_WALLET_PROXY_TARGET_URL", "VITE_ENTERPRISE_WALLET_URL", ...["URL", "REALM", "CLIENT_ID", "CLIENT_SECRET"].map((s) => `WALLET_KEYCLOAK_${s}`)];
    for (const name of ["VITE_ENTERPRISE_WALLET_PROXY_URL", "VITE_ENTERPRISE_WALLET_APP_NAME", "RAMP_INSTRUMENT", ...wallet]) {
      assert.equal(active.has(name), false, `${name} is still an entry`);
      assert.equal(sources.includes(name), false, `${name} is still read`);
    }
    // keycloakBearer composes `${prefix}_${suffix}`: no list passes the wallet's prefix any more.
    assert.equal(sources.includes('"WALLET_KEYCLOAK"'), false);
    assert.doesNotMatch(read(".env.example"), /walletClient|ledgerClient|ENTERPRISE_WALLET_(PROXY_TARGET_)?URL|WALLET_KEYCLOAK/);
  });

  it("keeps every name the code still reads, those composed from a prefix or picked from a list included", () => {
    const direct = new Set([...sources.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)|import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)].map((m) => m[1] ?? m[2]));
    for (const name of ["NODE_ENV", "VERCEL", "VITE_X"]) direct.delete(name); // the platform's own, and a comment's placeholder
    assert.deepEqual([...direct].filter((n) => !active.has(n)), []);
    // The ledger relay's lists: target URLs read by name, Keycloak prefixes composed with each
    // suffix (never CLIENT_ID / CLIENT_SECRET under a VITE_ prefix).
    const targets = [...server.matchAll(/"([A-Z][A-Z0-9_]*_URL)"/g)].map((m) => m[1]);
    const prefixes = [...server.matchAll(/"((?:[A-Z][A-Z0-9]*_)*KEYCLOAK)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(prefixes)].sort(), ["KEYCLOAK", "LEDGER_KEYCLOAK", "VITE_KEYCLOAK", "ZKPC_KEYCLOAK"]);
    const composed = prefixes.flatMap((p) => ["URL", "REALM", ...(p.startsWith("VITE_") ? [] : ["CLIENT_ID", "CLIENT_SECRET"])].map((s) => `${p}_${s}`));
    assert.deepEqual([...targets, ...composed].filter((n) => !active.has(n)), []);
    assert.equal(active.has("VITE_ENTERPRISE_WALLET_PARTY_ID"), true, "the relay's policy and the browser read the treasury id");
  });
});
