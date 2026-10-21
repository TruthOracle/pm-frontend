/**
 * The operator console against the backend after review wave 9: signed single-control decisions
 * (C23), the AML `return` decision and `returned` alerts (C25), consent declarations (C13), the
 * four-eyes KYC override (C22), the webhook events console (C31), screening match tiers (C12,
 * C13, C44), and the new operator sentences. Pure layer only: lib/rampAdmin.ts,
 * lib/rampAdminErrors.ts and the clients in lib/backendAdmin.ts.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const admin = await import("../frontend/lib/rampAdmin.ts");
const { rampAdminErrorMessage, RampAdminError } = await import("../frontend/lib/rampAdminErrors.ts");
const clients = await import("../frontend/lib/backendAdmin.ts");
const { BackendError } = await import("../frontend/lib/backend.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fetch stub answering each call with the next [status, body] and recording every call. */
function replies(...answers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    const [status, body] = answers.length > 1 ? answers.shift() : answers[0];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return calls;
}

const ALERT_ID = "7a1b2c3d-0000-4000-8000-000000000001";
const HIT_ID = "5e6f7a8b-0000-4000-8000-000000000002";
const approval = (over = {}) => ({
  id: "6f1c2b9e-0000-4000-8000-000000000001",
  action: "compliance.alert.decide",
  subjectType: "compliance_alert",
  subjectId: ALERT_ID,
  params: {},
  paramsHash: "ab".repeat(32),
  reason: "r",
  status: "executed",
  singleControl: true,
  requestedByUserId: "u-a",
  requestedByParty: "op-a::1220aa",
  requestedByPerson: "alice",
  requestedAt: "2026-10-19T10:00:00Z",
  expiresAt: "2026-10-21T20:59:59Z",
  ...over,
});

// The backend's own construction (admin-approval.logic.ts paramsHashOf, admin-approval.service.ts requestMessage).
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const canonical = (v) =>
  JSON.stringify(
    (function norm(x) {
      if (Array.isArray(x)) return x.map(norm);
      if (x && typeof x === "object")
        return Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, norm(x[k])]));
      return x;
    })(v),
  );
function backendRequestMessage({ action, subjectType, subjectId, params }, snapshot) {
  const paramsHash = sha(canonical({ action, subjectType, subjectId, params }));
  return `truthoracle-approval:request:${action}:${subjectId}:${paramsHash}:${sha(canonical(snapshot))}`;
}
const ALERT_SNAPSHOT = { status: "open", severity: "review", decidedAt: null, orderId: "o-1" };
const signatureRequired = (message) => [
  400,
  { error: "approval_signature_required", message: "this decision must carry the operator wallet's signature", details: { message } },
];

describe("C23: a releasing single-control decision is signed over the backend's request message", () => {
  it("hashes params exactly like the backend (sorted keys, undefined dropped, null kept)", () => {
    assert.equal(admin.canonicalJson({ b: 1, a: { d: undefined, c: null } }), '{"a":{"c":null},"b":1}');
    const req = clients.alertDecisionRequest(ALERT_ID, "return");
    assert.deepEqual(req, { action: "compliance.alert.decide", subjectType: "compliance_alert", subjectId: ALERT_ID, params: { decision: "return", reportRef: null } });
    assert.deepEqual(clients.alertDecisionRequest(ALERT_ID, "report", " F-12 ").params, { decision: "report", reportRef: "F-12" });
    assert.deepEqual(clients.hitDecisionRequest(HIT_ID, "clear"), { action: "compliance.hit.decide", subjectType: "screening_hit", subjectId: HIT_ID, params: { decision: "clear" } });
  });

  it("accepts only this request's message: same action, subject and decision", async () => {
    const req = clients.alertDecisionRequest(ALERT_ID, "clear");
    assert.equal(await admin.requestMessageProblem(backendRequestMessage(req, ALERT_SNAPSHOT), req), null);
    const otherDecision = backendRequestMessage(clients.alertDecisionRequest(ALERT_ID, "return"), ALERT_SNAPSHOT);
    assert.match(await admin.requestMessageProblem(otherDecision, req), /does not commit to the decision you chose/);
    const otherSubject = backendRequestMessage(clients.alertDecisionRequest("7a1b2c3d-0000-4000-8000-0000000000ff", "clear"), ALERT_SNAPSHOT);
    assert.match(await admin.requestMessageProblem(otherSubject, req), /not this decision/);
    for (const bad of ["truthoracle-admin-sign-in:nonce-123", `truthoracle-approval:${approval().id}:${"ab".repeat(32)}:approve`, `${backendRequestMessage(req, ALERT_SNAPSHOT)}:extra`])
      assert.match(await admin.requestMessageProblem(bad, req), /not this decision/, bad);
  });

  it("step 1 sends the decision unsigned; with signatures off that is the answer", async () => {
    const calls = replies([200, { approval: approval(), result: { alert: { id: ALERT_ID } } }]);
    const req = clients.alertDecisionRequest(ALERT_ID, "clear");
    const out = await admin.sendDecisionUnsigned((signature) => clients.decideComplianceAlert(ALERT_ID, { decision: "clear", reason: "false positive", ...(signature ? { signature } : {}) }), req);
    assert.equal(out.approval.status, "executed");
    assert.equal(admin.isSignatureStep(out), false);
    assert.equal(calls[0].url, `/__backend/api/v1/admin/compliance/alerts/${ALERT_ID}/decide`);
    assert.deepEqual(calls[0].body, { decision: "clear", reason: "false positive" }, "no signature key at all (the DTO refuses an empty one)");
  });

  it("step 1 turns the 400 into a signature step, then step 2 signs FIRST and resends the same body signed", async () => {
    const req = clients.alertDecisionRequest(ALERT_ID, "return");
    const message = backendRequestMessage(req, ALERT_SNAPSHOT);
    const order = [];
    const calls = replies(signatureRequired(message), [200, { approval: approval(), result: { alert: { id: ALERT_ID, status: "returned" } } }]);
    const send = (signature) => {
      order.push(`fetch${signature ? " signed" : ""}`);
      return clients.decideComplianceAlert(ALERT_ID, { decision: "return", reason: "payer is a third party", ...(signature ? { signature } : {}) });
    };
    const step = await admin.sendDecisionUnsigned(send, req);
    assert.deepEqual(step, { signatureMessage: message });
    assert.equal(admin.isSignatureStep(step), true);
    const sign = admin.makeMessageSigner({
      walletParty: "op-a::1220aa",
      operatorParty: "op-a::1220aa",
      walletName: "Cantor8",
      signMessage: async (m, party) => {
        order.push(`sign ${party}`);
        assert.equal(m, message, "the wallet signs the backend's exact message");
        return "c2ln";
      },
    });
    const done = await admin.sendDecisionSigned(send, step.signatureMessage, sign);
    assert.equal(done.approval.status, "executed");
    assert.deepEqual(order, ["fetch", "sign op-a::1220aa", "fetch signed"], "the wallet popup is the second click's first await");
    assert.deepEqual(calls[1].body, { decision: "return", reason: "payer is a third party", signature: "c2ln" });
  });

  it("never signs a message that is not this request's, and rethrows every other refusal", async () => {
    const req = clients.hitDecisionRequest(HIT_ID, "clear");
    replies(signatureRequired("truthoracle-admin-sign-in:nonce-123"));
    const send = (signature) => clients.decideScreeningHit(HIT_ID, { decision: "clear", reason: "different birth date", ...(signature ? { signature } : {}) });
    await assert.rejects(admin.sendDecisionUnsigned(send, req), (e) => e instanceof RampAdminError && /nothing was signed/.test(e.message));
    replies([409, { error: "screening_hit_state", message: "the hit is decided" }]);
    await assert.rejects(admin.sendDecisionUnsigned(send, req), (e) => e instanceof BackendError && e.code === "screening_hit_state");
    // A 400 without the message (an approval decision's own) is not a request step either.
    replies([400, { error: "approval_signature_required", message: "x" }]);
    await assert.rejects(admin.sendDecisionUnsigned(send, req), (e) => e instanceof BackendError && e.status === 400);
  });

  it("the hit clear goes through the same two steps against its own route", async () => {
    const req = clients.hitDecisionRequest(HIT_ID, "clear");
    const message = backendRequestMessage(req, { id: HIT_ID, userId: "u-1", status: "open", list: "by_terror" });
    const calls = replies(signatureRequired(message), [200, { approval: approval({ action: "compliance.hit.decide", subjectType: "screening_hit" }) }]);
    const send = (signature) => clients.decideScreeningHit(HIT_ID, { decision: "clear", reason: "other person", ...(signature ? { signature } : {}) });
    const step = await admin.sendDecisionUnsigned(send, req);
    await admin.sendDecisionSigned(send, step.signatureMessage, async () => "c2ln");
    assert.equal(calls[0].url, `/__backend/api/v1/admin/compliance/screening-hits/${HIT_ID}/decide`);
    assert.deepEqual(calls.map((c) => c.body), [
      { decision: "clear", reason: "other person" },
      { decision: "clear", reason: "other person", signature: "c2ln" },
    ]);
  });

  it("refuses before any popup without a wallet or with another party's; explains a 401", async () => {
    let popups = 0;
    const signer = (over) =>
      admin.makeMessageSigner({ walletParty: "op-a::1220aa", operatorParty: "op-a::1220aa", walletName: "Cantor8", signMessage: async () => (popups++, "s"), ...over });
    await assert.rejects(signer({ walletParty: null })("m"), /Connect your Cantor8 wallet/);
    await assert.rejects(signer({ walletParty: "op-z::1220zz" })("m"), /not the party signed in/);
    await assert.rejects(signer({ signMessage: async () => "" })("m"), /empty signature/);
    assert.equal(popups, 0);
    const invalid = (message) => rampAdminErrorMessage(new BackendError(401, "approval_signature_invalid", message));
    assert.match(invalid("the decision signature did not verify"), /another wallet signed, or the subject changed/);
    assert.match(invalid("no verified key is known for this operator"), /sign in again with your wallet/);
  });
});

describe("C25: the AML `return` decision and `returned` alerts", () => {
  const alert = (over = {}) => ({ status: "open", orderId: "o-1", severity: "review", ...over });

  it("offers return wherever the backend's table allows it, on an alert that holds an order", () => {
    assert.deepEqual(admin.alertDecisions(alert()), ["clear", "escalate", "report", "return"]);
    assert.deepEqual(admin.alertDecisions(alert({ status: "escalated" })), ["clear", "report", "return"]);
    assert.deepEqual(admin.alertDecisions(alert({ status: "reported", severity: "block" })), ["clear", "return"]);
    assert.deepEqual(admin.alertDecisions(alert({ status: "returned" })), [], "returned is final");
    assert.deepEqual(admin.alertDecisions(alert({ status: "cleared" })), []);
    assert.deepEqual(admin.alertDecisions(alert({ orderId: null })), ["clear", "escalate", "report"], "an account-level alert holds no payment");
    assert.deepEqual(admin.alertDecisions(alert({ severity: "info" })), ["clear", "escalate", "report"], "info never holds");
  });

  it("says why a decision is not offered, and which decisions are signed", () => {
    assert.equal(admin.alertDecisionBlocker(alert(), "return"), null);
    assert.match(admin.alertDecisionBlocker(alert({ orderId: null }), "return"), /holds an order's payment/);
    assert.match(admin.alertDecisionBlocker(alert({ status: "returned" }), "clear"), /returned: that decision is final/);
    assert.match(admin.alertDecisionBlocker(alert({ status: "reported" }), "escalate"), /A reported alert can only be: clear, return\./);
    assert.deepEqual(["clear", "escalate", "report", "return"].filter(admin.alertDecisionReleases), ["clear", "return"]);
    assert.equal(admin.alertStatusTone("returned"), "neutral");
    assert.equal(admin.alertStatusTone("escalated"), "pending");
    assert.equal(admin.alertStatusTone("reported"), "warn");
  });

  it("sorts a returned alert with the decided ones and never flags it due", () => {
    const rows = admin.sortAlertsByDue([
      { id: "r", status: "returned", dueAt: "2026-10-19T09:00:00Z", createdAt: "2026-10-19T08:00:00Z" },
      { id: "o", status: "open", dueAt: "2026-10-20T09:00:00Z", createdAt: "2026-10-18T08:00:00Z" },
    ]);
    assert.deepEqual(rows.map((r) => r.id), ["o", "r"]);
    assert.equal(admin.alertDueState({ status: "returned", dueAt: "2026-10-19T09:00:00Z" }, Date.parse("2026-10-19T12:00:00Z")), "none");
  });

  it("posts return like any decision, and words a refused one with the new table", async () => {
    const calls = replies([200, { approval: approval() }]);
    await clients.decideComplianceAlert(ALERT_ID, { decision: "return", reason: "unverified payer" });
    assert.deepEqual(calls[0].body, { decision: "return", reason: "unverified payer" });
    const m = rampAdminErrorMessage(new BackendError(409, "compliance_alert_state", "only an alert that holds an order's payment can return it", { status: "open" }));
    assert.match(m, /^The alert cannot take this decision: only an alert that holds an order's payment can return it\./);
    assert.match(m, /cleared and returned are final/);
  });
});

describe("C13: the consent declaration an AML officer opens", () => {
  it("reads it from its own route, on TM-PRINCIPAL and TM-PEP alerts only", async () => {
    const declaration = {
      alertId: ALERT_ID,
      rule: "TM-PRINCIPAL",
      consentId: "c0ffee00-0000-4000-8000-000000000003",
      termsVersion: "2026-10",
      acceptedAt: "2026-10-19T08:30:00.000Z",
      actsForSelf: false,
      pepDeclared: false,
      principal: "OOO Example, UNP 190000000",
    };
    const calls = replies([200, { declaration }]);
    assert.deepEqual(await clients.fetchAlertDeclaration("a/1"), declaration);
    assert.equal(calls[0].url, "/__backend/api/v1/admin/compliance/alerts/a%2F1/declaration");
    assert.equal(calls[0].init.method ?? "GET", "GET");
    assert.deepEqual(admin.declarationLines(declaration), [
      "Terms 2026-10, accepted Oct 19, 2026, 08:30 UTC (consent c0ffee00)",
      "Acts for: OOO Example, UNP 190000000",
    ]);
    assert.deepEqual(admin.declarationLines({ ...declaration, rule: "TM-PEP", principal: undefined, pepDeclared: true, pepDetail: "deputy minister" }).slice(1), [
      "Declared a PEP: deputy minister",
    ]);
    assert.equal(admin.alertHasDeclaration({ rule: "TM-PEP" }), true);
    assert.equal(admin.alertHasDeclaration({ rule: "TM-STRUCT" }), false);
  });
});

describe("C22: the KYC override answers an approval for `approved`", () => {
  const verification = { id: "9d8c7b6a-0000-4000-8000-000000000004", provider: "admin", levelName: "basic", attemptNo: 2, status: "approved", rejectLabels: [], moderationComment: null, reviewedAt: null, createdAt: "2026-10-19T10:00:00Z" };

  it("posts {status, reason} and reads 202 {approval}, 200 {verification, approval} and 200 {verification}", async () => {
    let calls = replies([202, { approval: approval({ action: "kyc.override", subjectType: "user", status: "pending", singleControl: false }) }]);
    const pending = await clients.overrideKyc("u/1", { status: "approved", reason: "passport checked by hand" });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/users/u%2F1/kyc/override");
    assert.deepEqual(calls[0].body, { status: "approved", reason: "passport checked by hand" });
    assert.match(admin.kycOverrideSentence(pending), /^KYC approval: approval 6f1c2b9e requested\. A second person with the approver role/);
    calls = replies([200, { verification, approval: approval({ action: "kyc.override", status: "executed" }) }]);
    assert.match(admin.kycOverrideSentence(await clients.overrideKyc("u-1", { status: "approved", reason: "x" })), /^KYC set to approved by hand \(verification 9d8c7b6a\)\.$/);
    replies([200, { verification: { ...verification, status: "rejected_final" } }]);
    assert.match(admin.kycOverrideSentence(await clients.overrideKyc("u-1", { status: "rejected_final", reason: "forged" })), /rejected_final/);
    replies([200, {}]);
    await assert.rejects(clients.overrideKyc("u-1", { status: "expired", reason: "x" }), (e) => e instanceof BackendError && e.code === "invalid_response");
  });

  it("words the override's refusals for an operator", () => {
    assert.match(rampAdminErrorMessage(new BackendError(409, "user_suspended", "the account is closed")), /^The account is suspended or closed: the account is closed\.$/);
    assert.match(rampAdminErrorMessage(new BackendError(409, "kyc_duplicate_identity", "x")), /Another account already holds this verified identity/);
    assert.match(
      rampAdminErrorMessage(new BackendError(409, "bad_request", "this account has no applicant with the configured provider; the user must start a verification session first")),
      /^The backend refused this: this account has no applicant/,
    );
    assert.match(rampAdminErrorMessage(new BackendError(403, "approval_linked_person", "x")), /linked to the account/);
  });
});

describe("C31: the webhook events console", () => {
  const event = (over = {}) => ({
    id: "e1e2e3e4-0000-4000-8000-000000000005",
    type: "payment.chargeback",
    kind: "payment",
    objectId: "pay_123",
    sandbox: false,
    receivedAt: "2026-10-16T10:00:00Z",
    processedAt: null,
    attempts: 41,
    nextAttemptAt: null,
    deadAt: "2026-10-19T10:00:00Z",
    error: "provider timeout",
    ...over,
  });

  it("lists dead or unapplied events by keyset page", async () => {
    const calls = replies([200, { items: [event()], nextCursor: "c-2" }], [200, { items: [], nextCursor: null }]);
    const page = await clients.fetchRampEvents({ status: "dead" });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/ramp/events?status=dead");
    assert.equal(page.nextCursor, "c-2");
    const last = await clients.fetchRampEvents({ status: "unprocessed", cursor: "c-2" });
    assert.equal(calls[1].url, "/__backend/api/v1/admin/ramp/events?status=unprocessed&cursor=c-2");
    assert.deepEqual(last, { items: [], nextCursor: null });
    // Another envelope is refused, never half-rendered.
    replies([200, { events: [event()] }]);
    await assert.rejects(clients.fetchRampEvents({ status: "dead" }), (e) => e instanceof BackendError && e.code === "invalid_response");
  });

  it("replays with the reason (single control) and requests a close as an approval", async () => {
    let calls = replies([200, { event: event({ deadAt: null }) }]);
    await clients.replayRampEvent("e/1", { reason: "PSP fixed" });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/ramp/events/e%2F1/replay");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(calls[0].body, { reason: "PSP fixed" });
    calls = replies([202, { approval: approval({ action: "ramp.event.close", status: "pending", singleControl: false }) }]);
    const out = await clients.requestRampEventClose("e-1", { reason: "chargeback applied by hand" });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/ramp/events/e-1/close");
    assert.deepEqual(calls[0].body, { reason: "chargeback applied by hand" });
    assert.match(admin.outcomeSentence("Event close", out), /requested\. A second person with the approver role/);
  });

  it("tells dead from retrying from applied, and offers actions only on unapplied events", () => {
    assert.equal(admin.rampEventState(event()), "dead");
    assert.equal(admin.rampEventTone("dead"), "bad");
    assert.equal(admin.rampEventState(event({ deadAt: null, nextAttemptAt: "2026-10-19T10:05:00Z" })), "retrying");
    assert.equal(admin.rampEventState(event({ processedAt: "2026-10-19T11:00:00Z" })), "processed");
    assert.deepEqual(admin.rampEventActions(event()), { replay: true, close: true });
    assert.deepEqual(admin.rampEventActions(event({ processedAt: "2026-10-19T11:00:00Z" })), { replay: false, close: false });
  });
});

describe("C12 / C13: screening matches", () => {
  const nameHit = (over = {}) => ({
    match: { basis: "name", entryName: "IVANOV Ivan", entryBirthDate: "1980-01-02", entryIds: ["BY-17"], script: "lat", birthDate: "exact", ...over },
  });

  it("names how the forms met: exact keys, a bridged form, or surname and birth date only", () => {
    assert.equal(admin.screeningMatchLine(nameHit()), '"IVANOV Ivan", born 1980-01-02 · matched the lat name form by the exact name form · birth date exact · ids BY-17');
    assert.match(admin.screeningMatchLine(nameHit({ via: "bridge", script: "ru" })), /ru name form by a be \/ ru \/ Latin bridged form \(check the spelling\)/);
    assert.match(admin.screeningMatchLine(nameHit({ via: "surname_dob" })), /surname and exact birth date only \(a candidate: compare the given names\)/);
  });

  it("shows a declared principal's hit and a party hit without inventing account fields", () => {
    const line = admin.screeningMatchLine({ match: { basis: "principal", consentId: "c0ffee00-0000", entryName: "OOO Listed", entryBirthDate: null, entryIds: [] } });
    assert.equal(line, '"OOO Listed" · matched the principal the account declares it acts for (consent c0ffee00)');
    assert.doesNotMatch(line, /undefined/);
    assert.equal(admin.screeningMatchLine({ match: { basis: "party", party: "p::1220", listed: "p::1220" } }), "party p::1220 listed as p::1220");
  });
});

describe("wave 9 operator sentences and reconciliation names", () => {
  const msg = (status, code, message = "x", details) => rampAdminErrorMessage(new BackendError(status, code, message, details));

  it("says why a payout cannot be marked paid: a compliance hold, a settlement in flight, a contract gone", () => {
    assert.match(msg(409, "payout_blocked", "this payout is held for compliance", { reason: "compliance_hold" }), /frozen, or a compliance review holds this payout/);
    assert.match(msg(409, "payout_blocked", "x", { status: "settling", reason: "in_flight" }), /in flight right now/);
    assert.match(msg(409, "payout_blocked", "x", { reason: "settlement_in_progress" }), /in flight right now/);
    assert.match(msg(409, "payout_blocked", "the PendingPayout is no longer live", { cid: "00ab" }), /no longer live on the ledger/);
  });

  it("tells a copy of another format from a different statement, and an export's missing identity from an unreachable one", () => {
    assert.equal(
      msg(409, "statement_mismatch", "your copy must be the same kind of file as the uploaded one (camt053)"),
      "Your copy must be the same kind of file as the uploaded statement (camt053). Download that format from the bank and confirm with it.",
    );
    assert.match(msg(409, "statement_mismatch", "your copy of the statement does not match the uploaded one (account, period, balances or a line differ)"), /does not parse to the same statement/);
    assert.match(msg(409, "statement_mismatch", "confirm with your own copy of the statement (POST …)"), /Confirm with your own copy/);
    assert.match(
      msg(409, "kyc_identity_unavailable", "account u has no stored verified identity: the register would be incomplete", { userId: "4c3b2a19-0000", orderId: "0d0e0f10-0000" }),
      /^Account 4c3b2a19 has no stored verified identity \(order 0d0e0f10\), so the register would be incomplete: nothing was exported\./,
    );
    assert.match(msg(409, "kyc_identity_unavailable", "the verified identity cannot be read right now", { userId: "4c3b2a19-0000" }), /could not be read from the KYC provider right now \(account 4c3b2a19\)/);
  });

  it("explains the new reconciliation check and reserve figure", () => {
    assert.match(admin.RECON_CHECKS.token_sync_other_instruments, /never halts or pages/);
    const rows = admin.reserveRows({ safeguardBank: "10", unbookedDebits: "-1.5" });
    assert.deepEqual(rows.map((r) => r.label), ["Safeguard bank (journal)", "Unbooked bank debits (already taken off assets)"]);
  });
});
