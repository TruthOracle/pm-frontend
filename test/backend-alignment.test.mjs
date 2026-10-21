/**
 * The frontend against the backend as the wave's backend agents built it:
 *  (a) the market resolution route (admin-market-resolution.controller.ts, market-resolution.dto.ts,
 *      market-resolution.service.ts / .logic.ts): the GET's market, the canonical market id, the
 *      DTO's limits, the request roles, the snapshot's own shapes, the new error codes;
 *  (b) the approvals console on B1's figures: a ramp order approval's snapshot (RampOrderFigures)
 *      read first and checked against the order read, the retry target and `refund_cancel` as the
 *      backend describes them, and a statement confirm's bookings from its `classified` lines;
 *  (c) the cash-out's attach answer: `bindPending` / `bindReason` (F6), read explicitly.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

// Imported inside each test: on the code before this change every test fails on its own.
const route = () => import("../frontend/lib/marketResolution.ts");
const figuresLib = () => import("../frontend/lib/rampApprovalFigures.ts");
const adminLib = () => import("../frontend/lib/rampAdmin.ts");
const errorsLib = () => import("../frontend/lib/rampAdminErrors.ts");
const rampLib = () => import("../frontend/lib/ramp.ts");
const clientsLib = () => import("../frontend/lib/backendAdmin.ts");
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

const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const canonical = (v) =>
  JSON.stringify(
    (function norm(x) {
      if (Array.isArray(x)) return x.map(norm);
      if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, norm(x[k])]));
      return x;
    })(v),
  );
const byLabel = (figs) => Object.fromEntries(figs.map((f) => [f.label, f.value]));
const invalid = (e) => e instanceof BackendError && e.code === "invalid_response";
const src = (path) => readFileSync(new URL(`../frontend/${path}`, import.meta.url), "utf8");

const EXPIRES = "2026-10-19T12:00:00.000Z";
// ApiMarketResolution's market (the GET): collateral is an InstrumentRef there, {admin, id} in the snapshot.
const GET_MARKET = {
  marketId: "12",
  ticker: "BTC-26OCT-100K",
  question: "Will BTC close above 100k?",
  status: "Trading",
  expiresAt: EXPIRES,
  gracePeriodSecs: 172800,
  collateral: { admin: "cantor8::1220ee", id: "cBYN", symbol: "cBYN", name: "Belarusian ruble", decimals: 10 },
  operatorResolution: true,
  sources: ["https://src.example/result"],
  outcome: null,
};
const WINDOWS = { resolveT0From: EXPIRES, resolveT0To: "2026-10-21T12:00:00.000Z", resolveFrom: EXPIRES, voidFrom: "2026-10-21T12:00:01.000Z" };
const stateBody = (over = {}) => ({ market: GET_MARKET, windows: WINDOWS, choicesAvailable: ["ResolveT0", "Resolve"], pending: null, asOf: "2026-10-19T12:10:00.000Z", ...over });
// ApiMarketResolutionSnapshot, as the approval stores it.
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
  description: "ResolveT0 market #12 (BTC-26OCT-100K) → Yes from https://src.example/result",
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

describe("(a) the market resolution route as the backend built it", () => {
  it("reads the GET's market: its decimal id, collateral, allowlist and policy; a market without its id is no answer", async () => {
    const r = await route();
    replies([200, stateBody()], [200, stateBody({ market: { ticker: "BTC-26OCT-100K", status: "Trading" } })]);
    const s = await r.fetchMarketResolution(12);
    assert.equal(s.market.marketId, "12");
    assert.deepEqual(s.market.collateral, { admin: "cantor8::1220ee", id: "cBYN", symbol: "cBYN" });
    assert.deepEqual(s.market.sources, ["https://src.example/result"]);
    assert.equal(s.market.operatorResolution, true);
    assert.equal(s.market.gracePeriodSecs, 172800);
    await assert.rejects(r.fetchMarketResolution(12), invalid);
  });

  it("names the market by the backend's canonical id in the route and in the C23 subject", async () => {
    const r = await route();
    const input = { choice: "VoidMarket" };
    const hash = sha(canonical({ action: "market.resolve", subjectType: "market", subjectId: "12", params: input }));
    const message = `truthoracle-approval:request:market.resolve:12:${hash}:${"cd".repeat(32)}`;
    const calls = replies([400, { error: "approval_signature_required", message: "sign it", details: { message } }], [202, { approval: approval() }]);
    const admin = await adminLib();
    const send = (signature) => r.requestMarketResolution("012", input, "grace over", signature);
    const step = await admin.sendDecisionUnsigned(send, r.resolutionSignedRequest("012", input));
    assert.equal(step.signatureMessage, message, "the console signs the backend's message for market 12");
    assert.equal(calls[0].url, "/__backend/api/v1/admin/markets/12/resolution");
    await r.requestMarketResolution(7, input, "grace over");
    assert.equal(calls[1].url, "/__backend/api/v1/admin/markets/7/resolution");
    assert.equal(r.canonicalMarketId("007"), "7");
  });

  it("checks the body as the DTO does before sending it: source, outcome, attestations, reason", async () => {
    const r = await route();
    const t0 = (sourceUri, outcome = "Yes") => r.resolutionInputProblem({ choice: "ResolveT0", outcome, sourceUri }, "checked");
    const resolve = (attestationCids) => r.resolutionInputProblem({ choice: "Resolve", attestationCids }, "checked");
    assert.equal(t0(" https://src.example/result "), null);
    assert.match(t0("ftp://src.example/result"), /must be an http\(s\) URL/);
    assert.match(t0(`https://src.example/${"a".repeat(2040)}`), /at most 2048 characters \(2060 now\)/);
    assert.match(t0("https://src.example/result", "Maybe"), /Choose the outcome/);
    assert.equal(resolve(["00a1", "00a2"]), null);
    assert.match(resolve([]), /no attestation/);
    // The operator picks the attestations, so the count is the request's, not the market's.
    assert.match(resolve(Array.from({ length: 51 }, (_, i) => `00a${i}`)), /at most 50 attestations; this one names 51\.$/);
    assert.match(resolve(["00a1", "00a1"]), /listed twice/);
    assert.match(resolve(["00 a1"]), /not a contract id/);
    assert.equal(r.resolutionInputProblem({ choice: "VoidMarket" }, "x".repeat(500)), null);
    assert.match(r.resolutionInputProblem({ choice: "VoidMarket" }, "x".repeat(501)), /at most 500 characters \(501 now\)/);
  });

  it("offers requests only to an ops session; an approver reads the state and is told where to decide", async () => {
    const r = await route();
    const open = r.readResolutionState(stateBody());
    assert.deepEqual(r.offeredChoices(open, { roles: ["ops"] }), ["ResolveT0", "Resolve"]);
    assert.deepEqual(r.offeredChoices(open, { roles: ["approver"] }), []);
    assert.deepEqual(r.offeredChoices(open, null), ["ResolveT0", "Resolve"], "roles unknown: offered, the backend enforces them");
    assert.equal(r.resolutionRoleProblem({ roles: ["ops", "approver"] }), null);
    assert.match(r.resolutionRoleProblem({ roles: ["approver"] }), /needs the ops role\. As an approver you decide the requests under Operator console → Approvals\.$/);
  });

  it("reads the snapshot as the backend stores it: the ledger's VoidOutcome is Void, the allowlist is a figure", async () => {
    const r = await route();
    const f = await figuresLib();
    const attestation = { cid: "00att-1", outcome: "VoidOutcome", sourceUri: "https://src.example/result", fetchedAt: "2026-10-19T12:30:00.000Z" };
    const a = approval({ params: { choice: "Resolve", attestationCids: ["00att-1"] }, precondition: { ...SNAPSHOT, outcome: "VoidOutcome", attestations: [attestation] } });
    const v = r.marketResolveView(a);
    assert.deepEqual([v.attestations[0].outcome, v.currentOutcome], ["Void", "Void"]);
    const figs = byLabel(f.approvalFigures(a));
    assert.equal(figs.Resolves, "Market #12 (BTC-26OCT-100K) resolves Void from 1 attestation");
    assert.equal(figs["Attestation 1"], "Void · https://src.example/result · fetched 2026-10-19 12:30:00 UTC · 00att-1…");
    assert.equal(figs["Source allowlist"], "https://src.example/result");
    assert.equal(figs["At request"], "Trading, outcome Void");
    assert.match(f.marketResolveProblem(approval({ precondition: { ...SNAPSHOT, sources: undefined } })), /the source allowlist/);
  });

  it("tells the operator an executed request may still be refused by the ledger, and what to do", async () => {
    const r = await route();
    const done = r.resolutionAnswerSentence({
      approval: approval({ status: "executed", singleControl: true }),
      result: { marketId: "12", choice: "ResolveT0", commandId: "market-resolve-12-6f1c" },
    });
    assert.match(done.description, /\(command market-resolve-12-6f1c\)/);
    assert.match(done.description, /if it still shows open a minute later, the ledger refused the submission \(the market moved meanwhile\): request it again\.$/);
  });

  it("has operator sentences for the route's refusals: market_not_resolvable, roles, ledger_stale, not_ready", async () => {
    const { rampAdminErrorMessage, hasRampAdminSentence } = await errorsLib();
    const msg = (status, code, message, details) => rampAdminErrorMessage(new BackendError(status, code, message, details));
    assert.equal(msg(403, "role_required", "this needs the ops or approver role", { roles: ["ops", "approver"] }), "This needs the ops or approver operator role.");
    assert.equal(
      msg(409, "market_not_resolvable", "market #12 expires at 2026-10-19T12:00:00.000Z; ResolveT0 opens then", { reason: "not_expired", opensAt: EXPIRES }),
      "The market cannot be resolved that way now: market #12 expires at 2026-10-19T12:00:00.000Z; ResolveT0 opens then. Request it once that time has passed.",
    );
    const source = msg(409, "market_not_resolvable", "https://x.example is not in the source allowlist of market #12", { reason: "source_not_allowed", sources: ["https://a.example", "https://b.example"] });
    assert.match(source, /Name one of the market's sources: https:\/\/a\.example, https:\/\/b\.example\.$/);
    assert.match(msg(409, "market_not_resolvable", "attestation 00a is no longer active", { reason: "attestation_archived", cid: "00a" }), /no longer active\. Reload the market and request again/);
    assert.match(msg(409, "market_not_resolvable", "T0 operator resolution is not enabled for market #12", { reason: "operator_resolution_off" }), /Resolve it from attestations, or void it once the grace period is over\.$/);
    // Unreadable (no lag to report) and behind (details.lag) are two different things to the operator.
    assert.equal(
      msg(503, "ledger_stale", "the ledger end could not be read: timeout"),
      "The backend cannot read the ledger right now: the ledger end could not be read: timeout. It decides nothing until it can: try again in a minute, and if it keeps failing, its ledger connection needs looking at.",
    );
    assert.equal(
      msg(503, "ledger_stale", "the ledger index is 40 offsets behind the ledger end (allowed 20); retry shortly", { offset: 100, ledgerEnd: 140, lag: 40, maxLag: 20 }),
      "The backend's ledger index is behind the ledger, so it decides nothing now: the ledger index is 40 offsets behind the ledger end (allowed 20); retry shortly. Try again in a moment.",
    );
    assert.equal(msg(503, "not_ready", "the Enterprise Wallet is not configured"), "The backend is not ready for this: the Enterprise Wallet is not configured.");
    for (const code of ["market_not_resolvable", "ledger_stale", "not_ready"]) assert.equal(hasRampAdminSentence(code), true, code);
  });

  it("the market page's console reads the roles, the backend's allowlist and the DTO checks (TSX, pinned)", () => {
    const console = src("components/market/MarketOperatorResolution.tsx");
    assert.match(console, /fetchAdminSessionInfo\(\)/);
    assert.match(console, /const offered = offeredChoices\(state, session\);/);
    assert.match(console, /const sources = state\?\.market\.sources \?\? market\.policy\.sources;/);
    assert.match(console, /disabled=\{blocked \|\| !sourceUri \|\| t0Problem !== null\}/);
    assert.match(console, /disabled=\{blocked \|\| picked\.length === 0 \|\| resolveProblem !== null\}/);
  });
});

// ── (b) B1's figures in the approvals console ──

const ORDER_ID = "0a0b0c0d-0000-4000-8000-000000000001";
const cbyn = { admin: "cantor8::1220ee", id: "cBYN", symbol: "cBYN", name: "cBYN", decimals: 2 };
/** The admin order read (ApiAdminRampOrder): a bank cash-out in payout review. */
const adminOrder = (over = {}) => ({
  id: ORDER_ID,
  direction: "offramp",
  status: "needs_review",
  reviewStep: "payout",
  rail: "bank",
  fiatAmount: "100.0000000000",
  fiatCurrency: "BYN",
  tokenAmount: "100.0000000000",
  instrument: cbyn,
  capturedAmount: null,
  refundedAmount: "0.0000000000",
  details: {},
  userId: "u-1",
  partyId: "user::1220bb",
  paymentMethodId: null,
  bankAccountId: "b-1",
  destination: { kind: "bank", bankAccountId: "b-1", bankName: "Belarusbank", ibanMasked: "BY•• 1234" },
  card: null,
  version: 4,
  ...over,
});
/** RampOrderSnapshot: RampOrderFigures plus the order's state, as every ramp.order.* approval stores it. */
const snapshot = (over = {}) => ({
  direction: "offramp",
  userId: "u-1",
  partyId: "user::1220bb",
  fiatAmount: "100.0000000000",
  fiatCurrency: "BYN",
  tokenAmount: "100.0000000000",
  instrument: { admin: "cantor8::1220ee", id: "cBYN" },
  destination: { kind: "bank", bankAccountId: "b-1" },
  id: ORDER_ID,
  version: 4,
  status: "needs_review",
  reviewStep: "payout",
  reviewFrom: "payout_sent",
  mintCommandId: null,
  burnCommandId: "ramp-burn-1",
  remintCommandId: null,
  providerPaymentId: null,
  providerPayoutId: null,
  providerRefundId: null,
  pendingPayoutCid: null,
  capturedAmount: null,
  refundedAmount: "0.0000000000",
  ...over,
});
const orderApproval = (action, over = {}) =>
  approval({ action: `ramp.order.${action}`, subjectType: "ramp_order", subjectId: ORDER_ID, params: {}, precondition: snapshot(), description: `${action} offramp ${ORDER_ID}`, ...over });
const card = { kind: "card", paymentMethodId: "pm-1", brand: "Visa", last4: "4242" };

describe("(b) the approvals console reads a ramp order approval's figures from its snapshot", () => {
  it("shows what executes from the snapshot, the order read only as context (bank name, masked IBAN)", async () => {
    const f = await figuresLib();
    const a = orderApproval("bank_unpaid", { params: { then: "reverse" } });
    const figs = byLabel(f.approvalFigures(a, adminOrder({ fiatAmount: "999.0000000000" })));
    assert.match(figs.Moves, /^The 100\.00 BYN bank payout is recorded as unpaid, then reversed/);
    assert.equal(figs.Order, "cash-out · 100.00 BYN · 100.00 cBYN");
    assert.equal(figs.User, "u-1 · user::1220bb");
    assert.equal(figs["Pays to"], "bank account Belarusbank BY•• 1234");
    // Before the order is read, the snapshot's figures already show (Approve still waits for the read).
    const unread = byLabel(f.approvalFigures(a, null));
    assert.equal(unread.Order, "cash-out · 100.00 BYN · 100.00 cBYN");
    assert.equal(unread["Pays to"], "bank account b-1");
    const refund = byLabel(f.approvalFigures(orderApproval("refund", { precondition: snapshot({ direction: "onramp", destination: card, capturedAmount: "150.0000000000" }) }), null));
    assert.match(refund.Moves, /^150\.00 BYN \(the whole capture\) goes back to the payer/);
    assert.equal(refund["Paid with"], "card Visa •••• 4242");
  });

  it("blocks Approve when the figures disagree with the order read, name another order, or are missing", async () => {
    const f = await figuresLib();
    const a = orderApproval("bank_unpaid", { params: { then: "requeue" } });
    assert.equal(f.orderApprovalProblem(a, adminOrder()), null);
    assert.match(f.orderApprovalProblem(a, adminOrder({ fiatAmount: "99.0000000000" })), /^The request's figures disagree with the order: fiat 100\.00 BYN requested, 99\.00 BYN on the order\. Do not approve it/);
    assert.match(f.orderApprovalProblem(a, adminOrder({ tokenAmount: "90.0000000000" })), /tokens 100\.00 cBYN requested, 90\.00 cBYN on the order/);
    assert.match(f.orderApprovalProblem(a, adminOrder({ userId: "u-2", partyId: "other::1220cc" })), /user u-1 requested, u-2 on the order; wallet user::1220bb requested, other::1220cc on the order/);
    assert.match(f.orderApprovalProblem(a, adminOrder({ instrument: { ...cbyn, admin: "agent::1220dd" } })), /instrument cBYN of cantor8::1220ee requested, cBYN of agent::1220dd on the order/);
    assert.match(f.orderApprovalProblem(a, adminOrder({ bankAccountId: "b-2" })), /destination bank account b-1 requested, bank account b-2 on the order/);
    assert.match(f.orderApprovalProblem(a, adminOrder({ direction: "onramp" })), /direction offramp requested, onramp on the order/);
    // An on-ramp's destination is its bank refund account, else its card (the backend's orderFigures).
    const onramp = orderApproval("refund", { precondition: snapshot({ direction: "onramp", destination: card }) });
    const buy = (over) => adminOrder({ direction: "onramp", rail: null, paymentMethodId: "pm-1", bankAccountId: null, destination: null, ...over });
    assert.equal(f.orderApprovalProblem(onramp, buy({})), null);
    assert.match(f.orderApprovalProblem(onramp, buy({ bankAccountId: "b-9" })), /destination card pm-1 requested, bank account b-9 on the order/);
    // Stored before the backend recorded the figures: the backend compares the whole snapshot and would fail it.
    const legacy = orderApproval("refund", { precondition: { id: ORDER_ID, version: 4, status: "needs_review", capturedAmount: "150.0000000000", refundedAmount: "0.0000000000" } });
    assert.match(f.orderApprovalProblem(legacy, adminOrder()), /does not carry the order's figures \(amounts, user, wallet, destination\)/);
    const other = orderApproval("refund", { precondition: snapshot({ id: "ffffffff-0000-4000-8000-000000000009" }) });
    assert.match(f.orderApprovalProblem(other, adminOrder()), /snapshot is of order ffffffff, the request of 0a0b0c0d/);
  });

  it("totals approve-many from the snapshot's figures", async () => {
    const f = await figuresLib();
    assert.deepEqual(f.approvalAmount(orderApproval("credit_back"), null), { amount: "100.0000000000", unit: "cBYN" });
    assert.deepEqual(f.approvalAmount(orderApproval("bank_unpaid", { params: { then: "requeue" } }), null), { amount: "100.0000000000", unit: "BYN" });
    assert.equal(f.approvalsTotal([f.approvalAmount(orderApproval("reverse"), adminOrder())]), "100.00 cBYN");
  });

  it("the panel waits for the order read and refuses a disagreement, on the row too (TSX, pinned)", () => {
    const panel = src("components/Admin/RampApprovalsPanel.tsx");
    assert.match(panel, /Refresh before deciding\.` : orderApprovalProblem\(a, o\);/);
    assert.match(panel, /const orderProblem = read \? orderApprovalProblem\(a, read\) : null;/);
    assert.match(panel, /\{orderProblem && <p className="mt-1 text-\[11px\] text-amber-700">\{orderProblem\}<\/p>\}/);
  });

  it("a retry resumes where the backend's description says: a capture under review re-reads at paid", async () => {
    const admin = await adminLib();
    const f = await figuresLib();
    assert.equal(admin.rampActionFigure("retry", adminOrder({ direction: "onramp", reviewStep: "compliance", details: { reviewFrom: "expired" } })), "The order resumes at paid.");
    assert.equal(admin.rampActionFigure("retry", adminOrder({ direction: "onramp", reviewStep: "payment", details: { reviewFrom: "minting" } })), "The order resumes at paid.");
    assert.equal(admin.rampActionFigure("retry", adminOrder({ reviewStep: "compliance", details: { reviewFrom: "awaiting_withdrawal" } })), "The order resumes at awaiting_withdrawal.");
    assert.equal(admin.rampActionFigure("retry", adminOrder({ reviewStep: "burn", details: {} })), "The order resumes at burning.");
    const retry = orderApproval("retry", { precondition: snapshot({ direction: "onramp", destination: card, reviewStep: "payment", reviewFrom: "awaiting_payment" }) });
    assert.equal(byLabel(f.approvalFigures(retry, null)).Moves, "The order resumes at paid.");
  });

  it("refund_cancel (C19): offered on a charged-back on-ramp in review, requested on its route, shown with its figures", async () => {
    const admin = await adminLib();
    const f = await figuresLib();
    const clients = await clientsLib();
    const names = (o) => admin.rampOrderActions(o).map((x) => x.action);
    const review = { direction: "onramp", status: "needs_review", reviewStep: "refund", rail: null };
    assert.deepEqual(names({ ...review, details: { chargeback: { state: "charged_back" } } }), ["retry", "refund", "refund_bank", "refund_cancel", "fail"]);
    assert.equal(names({ ...review, details: { chargeback: { state: "disputed" } } }).includes("refund_cancel"), false);
    assert.equal(names(review).includes("refund_cancel"), false);
    assert.equal(admin.RAMP_ACTIONS.refund_cancel.destructive, true);
    const a = orderApproval("refund_cancel", { precondition: snapshot({ direction: "onramp", capturedAmount: "150.0000000000" }) });
    assert.equal(f.orderActionOf(a), "refund_cancel");
    const figs = byLabel(f.approvalFigures(a, null));
    assert.match(figs.Moves, /^The 150\.00 BYN bank refund the order owes is cancelled \(a chargeback already returned the payment\)/);
    assert.equal(figs["Refunds to"], "bank account b-1");
    const calls = replies([202, { approval: a }]);
    await clients.requestRampOrderAction(ORDER_ID, "refund_cancel", { reason: "charged back, bank never got it" });
    assert.deepEqual([calls[0].method, calls[0].url, calls[0].body], ["POST", `/__backend/api/v1/admin/ramp/orders/${ORDER_ID}/refund_cancel`, { reason: "charged back, bank never got it" }]);
  });
});

describe("(b) a statement confirm's bookings, worded as the backend's description", () => {
  const L1 = "1a2b3c4d-0000-4000-8000-000000000001";
  const L2 = "5e6f7a8b-0000-4000-8000-000000000002";
  const L3 = "99999999-0000-4000-8000-000000000003";
  const confirm = approval({
    action: "ramp.statement.confirm",
    subjectType: "ramp_bank_statement",
    subjectId: "st-1",
    params: {
      classifications: [
        { lineId: L1, matchKind: "operator_sweep" },
        { lineId: L2, matchKind: "payout_return", orderId: ORDER_ID },
        { lineId: L3, matchKind: "bank_fee" },
      ],
    },
    // The snapshot fixes the first 50 classified lines from the file (F3 / F9 `classified`).
    precondition: {
      id: "st-1",
      status: "draft",
      fileSha256: "ab".repeat(32),
      periodFrom: "2026-10-01",
      periodTo: "2026-10-19",
      opening: "1000.0000000000",
      closing: "2500.0000000000",
      lineCount: 42,
      classified: [
        { lineId: L1, lineRef: "L-7", bookingDate: "2026-10-19", amount: "-1500.0000000000", currency: "BYN" },
        { lineId: L2, lineRef: "L-9", bookingDate: "2026-10-18", amount: "20.0000000000", currency: "BYN" },
      ],
    },
    description: "confirm the statement 2026-10-01 … 2026-10-19 (42 lines, closing 2500.0000000000); book …",
  });

  it("each booking with its line's ref, date and amount and what it books; a line past the snapshot by its id", async () => {
    const f = await figuresLib();
    const list = f.approvalFigures(confirm);
    const figs = byLabel(list);
    assert.equal(
      figs.Books,
      "line L-7 of 2026-10-19 (-1,500.00 BYN) as operator_sweep → operator.sweep; " +
        "line L-9 of 2026-10-18 (20.00 BYN) as payout_return of order 0a0b0c0d → offramp.returned_bank (re-mint and credit back); " +
        "line 99999999 → bank_fee",
    );
    assert.equal(list[0].label, "Books");
    assert.equal(list[0].strong, true);
    assert.equal(figs.Statement, "2026-10-01 … 2026-10-19 · 42 lines · opening 1,000.00 · closing 2,500.00");
    assert.equal(figs["File sha-256"], "abababababababab…");
    assert.equal(list.some((x) => x.label.endsWith("(at request)")), false, "never the generic dump");
  });
});

// ── (c) the attach answer (F6) ──

const cashOut = (over = {}) => ({
  id: ORDER_ID,
  direction: "offramp",
  status: "awaiting_withdrawal",
  instrument: cbyn,
  withdraw: { walletContractId: "00wallet", amount: "100.0000000000" },
  ...over,
});

describe("(c) the cash-out reads the attach answer's bindPending and bindReason", () => {
  it("returns the order with bindPending and bindReason; an answer without bindPending is invalid", async () => {
    const ramp = await rampLib();
    const calls = replies(
      [200, { order: cashOut(), bindPending: true, bindReason: "settlement_in_progress" }],
      [200, { order: cashOut({ status: "withdrawing", withdraw: null }), bindPending: false, bindReason: null }],
      [200, { order: cashOut() }],
    );
    const waiting = await ramp.attachWithdrawal(ORDER_ID, "00cid");
    assert.deepEqual([calls[0].method, calls[0].url, calls[0].body], ["POST", `/__backend/api/v1/ramp/orders/${ORDER_ID}/attach`, { pendingPayoutCid: "00cid" }]);
    assert.deepEqual([waiting.bindPending, waiting.bindReason, waiting.order.status], [true, "settlement_in_progress", "awaiting_withdrawal"]);
    assert.equal(ramp.attachOutcome(waiting), "pending");
    const bound = await ramp.attachWithdrawal(ORDER_ID, "00cid");
    assert.deepEqual([bound.bindPending, bound.bindReason], [false, null]);
    assert.equal(ramp.attachOutcome(bound), "bound");
    await assert.rejects(ramp.attachWithdrawal(ORDER_ID, "00cid"), invalid);
  });

  it("trusts the explicit field over the order's status", async () => {
    const ramp = await rampLib();
    assert.equal(ramp.attachOutcome({ bindPending: false, order: { status: "awaiting_withdrawal" } }), "bound");
    assert.equal(ramp.attachOutcome({ bindPending: true, order: { status: "withdrawing" } }), "pending");
  });

  it("says why in the payee's words, and every other hold reads the same (C11: no tipping-off)", async () => {
    const ramp = await rampLib();
    assert.match(ramp.attachWaitSentence("settlement_in_progress"), /^Your withdrawal is signed and matched to this cash-out; its settlement is already running\./);
    assert.match(ramp.attachWaitSentence("in_flight"), /settlement is already running/);
    assert.match(ramp.attachWaitSentence("blocked_kyc"), /continues once your identity is verified/);
    assert.match(ramp.attachWaitSentence("blocked_ramp_exposure"), /card dispute window/);
    assert.match(ramp.attachWaitSentence("blocked_unknown_reason"), /needs an operator to look at it/);
    for (const reason of ["processing", "blocked_compliance", "blocked_payout_gate", "not_bound", "payout_blocked", null]) {
      const s = ramp.attachWaitSentence(reason);
      assert.equal(s, "Your withdrawal is signed and matched to this cash-out and is being processed. This page updates by itself.", String(reason));
      assert.doesNotMatch(s, /compliance|gate|review|AML/i);
    }
  });

  it("the cash-out step shows the reason while the withdrawal waits to be bound (TSX, pinned)", () => {
    const step = src("components/ramp/RampWithdrawStep.tsx");
    assert.match(step, /setBindWait\(attachOutcome\(r\) === "pending" \? \{ reason: r\.bindReason \} : null\);/);
    assert.match(step, /setBindWait\(attachOutcome\(res\) === "pending" \? \{ reason: res\.bindReason \} : null\);/);
    assert.match(step, /\{bindWait \? attachWaitSentence\(bindWait\.reason\) : "Your withdrawal is signed\. Linking it to this cash-out/);
    assert.match(step, /attachOutcome\(\{ error: e \}\) === "not_this_order"\) rejected\.current\.add/);
  });
});

describe("(b) B1's refusals the console words", () => {
  it("C25: a retry AML refused names the exit that gives the money back (details.use)", async () => {
    const { rampAdminErrorMessage } = await errorsLib();
    const returned = new BackendError(409, "ramp_order_state", "AML decided to return this order's money; it is never minted or paid out", { use: "refund" });
    assert.equal(rampAdminErrorMessage(returned), "Not possible now: AML decided to return this order's money; it is never minted or paid out. Use the order's refund exit instead.");
    const other = new BackendError(409, "ramp_order_state", "the order is completed, not needs_review");
    assert.equal(rampAdminErrorMessage(other), "Not possible now: the order is completed, not needs_review. Reload and check the current state.");
  });
});
