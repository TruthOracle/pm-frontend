/**
 * The ramp operator console's pure layer: frontend/lib/rampAdmin.ts (approval message and decision
 * rules, §4.2 actions, exact money, file and range helpers), lib/rampAdminErrors.ts (operator
 * sentences), the admin clients in lib/backendAdmin.ts (paths, bodies, approval outcomes) and
 * backendDownload() in lib/backend.ts.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const admin = await import("../frontend/lib/rampAdmin.ts");
const { rampAdminErrorMessage, RampAdminError, hasRampAdminSentence } = await import("../frontend/lib/rampAdminErrors.ts");
const clients = await import("../frontend/lib/backendAdmin.ts");
const { BackendError, backendDownload, filenameFromDisposition } = await import("../frontend/lib/backend.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ME = { party: "op-a::1220aa", personId: "alice", roles: ["ops", "approver"] };
const approval = (over = {}) => ({
  id: "6f1c2b9e-0000-4000-8000-000000000001",
  action: "ramp.order.refund",
  subjectType: "ramp_order",
  subjectId: "00000000-0000-4000-8000-0000000000aa",
  params: {},
  paramsHash: "9f86d081884c7d659a2feaa0c55ad015",
  reason: "card refund after review",
  status: "pending",
  requestedByUserId: "u-bob",
  requestedByParty: "op-b::1220bb",
  requestedByPerson: "bob",
  requestedAt: "2026-10-19T10:00:00Z",
  expiresAt: "2026-10-21T20:59:59Z",
  ...over,
});
const NOW = Date.parse("2026-10-19T12:00:00Z");

describe("approvals: the signed message and who may decide", () => {
  it("signs exactly truthoracle-approval:<id>:<params_hash>:<approve|reject>", () => {
    const a = approval();
    assert.equal(admin.approvalMessage(a, "approve"), `truthoracle-approval:${a.id}:${a.paramsHash}:approve`);
    assert.equal(admin.approvalMessage(a, "reject"), `truthoracle-approval:${a.id}:${a.paramsHash}:reject`);
  });

  it("disables Approve for the requester (by person, else by party) and offers to withdraw instead", () => {
    const mine = approval({ requestedByPerson: "alice", requestedByParty: "op-a::1220aa" });
    assert.equal(admin.isOwnRequest(mine, ME, ME.party), true);
    assert.match(admin.approveBlocker(mine, ME, ME.party, NOW), /second person/);
    assert.equal(admin.rejectLabel(mine, ME, ME.party), "Withdraw request");
    // Same person on another party is still the same person.
    assert.equal(admin.isOwnRequest(approval({ requestedByPerson: "alice", requestedByParty: "op-z::1220zz" }), ME, ME.party), true);
    // No person ids (older backend): the party decides.
    assert.equal(admin.isOwnRequest(approval({ requestedByPerson: null, requestedByParty: "op-a::1220aa" }), null, "op-a::1220aa"), true);
    const theirs = approval();
    assert.equal(admin.approveBlocker(theirs, ME, ME.party, NOW), null);
    assert.equal(admin.rejectLabel(theirs, ME, ME.party), "Reject");
  });

  it("needs the approver role, a pending status and an unexpired request", () => {
    assert.match(admin.approveBlocker(approval(), { ...ME, roles: ["ops"] }, ME.party, NOW), /approver role/);
    assert.match(admin.approveBlocker(approval({ status: "executed" }), ME, ME.party, NOW), /executed/);
    assert.match(admin.approveBlocker(approval({ expiresAt: "2026-10-19T11:59:00Z" }), ME, ME.party, NOW), /expired/);
    // Compliance decisions and freeze lifts are approved by an approver (the aml officer requests them);
    // only the single-control hit decision is aml's own.
    assert.match(admin.approveBlocker(approval({ action: "compliance.alert.decide" }), { ...ME, roles: ["aml"] }, ME.party, NOW), /Needs the approver role/);
    assert.equal(admin.approveBlocker(approval({ action: "compliance.freeze.lift" }), { ...ME, roles: ["approver"] }, ME.party, NOW), null);
    assert.equal(admin.approveBlocker(approval({ action: "compliance.hit.decide" }), { ...ME, roles: ["aml"] }, ME.party, NOW), null);
    // Roles unknown (no GET /admin/session yet): show the control, the backend decides.
    assert.equal(admin.hasRole(null, "export"), true);
    assert.equal(admin.roleHint({ ...ME, roles: [] }, "export"), "Needs the export role.");
  });

  it("words what an approval-backed route answered", () => {
    assert.match(admin.outcomeSentence("Refund", { approval: approval() }), /^Refund: approval 6f1c2b9e requested\. A second person/);
    assert.match(admin.outcomeSentence("Halt resume", { approval: approval({ status: "executed" }) }), /done/);
    assert.match(admin.outcomeSentence("Void", { approval: approval({ status: "failed", error: "statement coverage" }) }), /failed: statement coverage/);
  });
});

describe("order actions (§4.2)", () => {
  const names = (o) => admin.rampOrderActions(o).map((a) => a.action);
  it("offers the on-ramp exits from needs_review (bank_unpaid for a bank refund in payout review)", () => {
    assert.deepEqual(names({ direction: "onramp", status: "needs_review", reviewStep: "payment", rail: null }), ["retry", "refund", "refund_bank", "fail"]);
    assert.deepEqual(names({ direction: "onramp", status: "needs_review", reviewStep: "payout", rail: null }), [
      "retry",
      "refund",
      "refund_bank",
      "bank_unpaid",
      "fail",
    ]);
  });
  it("offers the off-ramp exits by step and rail", () => {
    assert.deepEqual(names({ direction: "offramp", status: "needs_review", reviewStep: "burn", rail: "card" }), ["retry", "reverse", "credit_back", "fail"]);
    assert.deepEqual(names({ direction: "offramp", status: "needs_review", reviewStep: "payout", rail: "card" }), [
      "retry",
      "reverse",
      "reverse_remainder",
      "fail",
    ]);
    assert.deepEqual(names({ direction: "offramp", status: "needs_review", reviewStep: "payout", rail: "bank" }), ["retry", "reverse", "bank_unpaid", "fail"]);
  });
  it("offers burn_uncredited on a chargeback; bank_unpaid waits for payout review (aging moves a sent payout there)", () => {
    assert.deepEqual(names({ direction: "onramp", status: "chargeback", reviewStep: null, rail: null }), ["burn_uncredited"]);
    for (const status of ["completed", "minting", "awaiting_payment", "payout_queued", "payout_sent"]) {
      assert.deepEqual(names({ direction: "offramp", status, reviewStep: null, rail: "bank" }), [], status);
    }
    assert.equal(admin.RAMP_ACTIONS.refund_bank.params, "bankAccount");
    assert.equal(admin.RAMP_ACTIONS.bank_unpaid.params, "then");
  });
});

describe("exact money", () => {
  it("prints the wire decimal exactly, grouped, never dropping a digit", () => {
    assert.equal(admin.fiatLabel("1234.5000000000"), "1,234.50 BYN");
    assert.equal(admin.fiatLabel("0.0000000000"), "0.00 BYN");
    assert.equal(admin.fiatLabel("-12.3400000000"), "-12.34 BYN");
    assert.equal(admin.fiatLabel("1234567.8900000000"), "1,234,567.89 BYN");
    assert.equal(admin.exactMoney("0.1234567000", 2, "cBYN"), "0.1234567 cBYN");
    assert.equal(admin.exactMoney("98.0000000000", 6), "98.000000");
    assert.equal(admin.exactMoney("-0.0000000000", 2), "0.00");
    assert.equal(admin.exactMoney("", 2, "BYN"), "— BYN");
    assert.equal(admin.exactMoney("12abc", 2), "—");
  });
});

describe("file imports and export ranges", () => {
  it("encodes a file's exact bytes as base64 (large files in chunks)", async () => {
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7919) % 256;
    assert.equal(admin.bytesToBase64(bytes), Buffer.from(bytes).toString("base64"));
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0xc0, 0xff])]);
    assert.equal(await admin.fileToBase64(blob), Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0xc0, 0xff]).toString("base64"));
  });

  it("refuses empty and oversized files and picks the statement format from the name", () => {
    assert.equal(admin.importFileProblem({ size: 10, name: "s.csv" }), null);
    assert.match(admin.importFileProblem({ size: 0, name: "s.csv" }), /empty/);
    assert.match(admin.importFileProblem({ size: admin.MAX_IMPORT_FILE_BYTES + 1, name: "s.xml" }), /larger than 5 MB/);
    assert.match(admin.importFileProblem(null), /Choose a file/);
    assert.equal(admin.statementFormatFor("camt053-2026-10.XML"), "camt053");
    assert.equal(admin.statementFormatFor("statement.csv"), "csv");
  });

  it("turns whole UTC days into an export range of at most 31 days", () => {
    assert.deepEqual(admin.exportRange("2026-10-01", "2026-10-31"), { from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T23:59:59.999Z" });
    assert.match(admin.exportRange("2026-10-01", "2026-11-01").problem, /31 days/);
    assert.match(admin.exportRange("2026-10-05", "2026-10-04").problem, /before/);
    assert.match(admin.exportRange("2026-02-30", "2026-03-01").problem, /Pick both/);
  });
});

describe("compliance alerts and reconciliation", () => {
  const alert = (over) => ({ dueAt: null, status: "open", createdAt: "2026-10-01T00:00:00Z", ...over });
  it("flags overdue and due-within-2h undecided alerts", () => {
    assert.equal(admin.alertDueState(alert({ dueAt: "2026-10-19T11:00:00Z" }), NOW), "overdue");
    assert.equal(admin.alertDueState(alert({ dueAt: "2026-10-19T13:30:00Z" }), NOW), "soon");
    assert.equal(admin.alertDueState(alert({ dueAt: "2026-10-20T13:30:00Z" }), NOW), "ok");
    assert.equal(admin.alertDueState(alert({ dueAt: "2026-10-19T11:00:00Z", status: "cleared" }), NOW), "none");
  });

  it("sorts undecided alerts by due date (none last), decided ones after, newest first", () => {
    const sorted = admin.sortAlertsByDue([
      alert({ id: "cleared-old", status: "cleared", createdAt: "2026-09-01T00:00:00Z" }),
      alert({ id: "no-due" }),
      alert({ id: "late", dueAt: "2026-10-25T00:00:00Z" }),
      alert({ id: "cleared-new", status: "reported", createdAt: "2026-10-10T00:00:00Z" }),
      alert({ id: "first", dueAt: "2026-10-19T20:59:59Z", status: "escalated" }),
    ]);
    assert.deepEqual(sorted.map((a) => a.id), ["first", "late", "no-due", "cleared-new", "cleared-old"]);
  });

  it("labels known reserve figures first and keeps unknown ones", () => {
    const rows = admin.reserveRows({ extra: "1", liabilities: "5.0000000000", assets: "7.0000000000", statementPeriodTo: null });
    assert.deepEqual(rows.map((r) => r.key), ["assets", "liabilities", "statementPeriodTo", "extra"]);
    assert.equal(rows[2].value, "—");
    assert.equal(admin.reconTone("red"), "bad");
    assert.equal(admin.reconTone(undefined), "pending");
  });

  it("offers batch buttons by status", () => {
    assert.deepEqual(admin.batchActions("draft"), { approve: true, export: false, submitted: false, cancel: true, void: false });
    assert.deepEqual(admin.batchActions("exported"), { approve: false, export: true, submitted: true, cancel: false, void: true });
    assert.deepEqual(admin.batchActions("submitted"), { approve: false, export: false, submitted: false, cancel: false, void: false });
  });
});

describe("operator error sentences", () => {
  it("words the console's codes, with details where they help", () => {
    assert.match(rampAdminErrorMessage(new BackendError(409, "approval_pending", "x", { approvalId: "abcdef0123456789" })), /pending \(abcdef01\)/);
    assert.match(rampAdminErrorMessage(new BackendError(409, "statement_mismatch", "x")), /does not parse to the same statement/);
    assert.match(rampAdminErrorMessage(new BackendError(409, "reserve_gate:statement_stale", "x")), /reserve gate is closed/);
    assert.match(rampAdminErrorMessage(new BackendError(403, "relay_write_disabled", "x")), /no longer signs treasury money moves/);
    assert.match(rampAdminErrorMessage(new BackendError(403, "role_required", "x", { role: "aml" })), /needs the aml operator role/);
  });

  it("keeps an unknown code's server message verbatim, even one that says cancelled", () => {
    // authErrorMessage would rewrite "cancel…" into the wallet-declined sentence; backend errors bypass it.
    assert.equal(rampAdminErrorMessage(new BackendError(409, "something_new", "batch was cancelled meanwhile")), "batch was cancelled meanwhile");
    assert.equal(rampAdminErrorMessage(new RampAdminError("Connect the operator wallet first.")), "Connect the operator wallet first.");
    // Base sentences still apply to the shared codes.
    assert.match(rampAdminErrorMessage(new BackendError(503, "backend_unreachable", "x")), /Could not reach/);
  });
});

/** A fetch stub answering `status` + JSON (or raw text) and recording every call. */
function stub(status, payload, headers = { "content-type": "application/json" }) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    return new Response(body, { status, headers });
  };
  return calls;
}

describe("admin clients", () => {
  it("posts an order action to its own route with the reason and params", async () => {
    const calls = stub(202, { approval: approval({ action: "ramp.order.refund_bank" }) });
    const out = await clients.requestRampOrderAction("ord-1", "refund_bank", { reason: "no card refund", bankAccountId: "ba-1" });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/ramp/orders/ord-1/refund_bank");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { reason: "no card refund", bankAccountId: "ba-1" });
    assert.equal(out.approval.status, "pending");
  });

  it("sends a decision with its signature, and approve-many with one signature per id", async () => {
    let calls = stub(200, { approval: approval({ status: "executed" }), result: { ok: true } });
    await clients.approveApproval("ap/1", { reason: "checked", signature: "c2ln" });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/approvals/ap%2F1/approve");
    assert.deepEqual(JSON.parse(calls[0].init.body), { reason: "checked", signature: "c2ln" });
    calls = stub(200, { results: [] });
    await clients.approveManyApprovals({ ids: ["a", "b"], reason: "batch", signatures: { a: "s1", b: "s2" } });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/approvals/approve-many");
    assert.deepEqual(JSON.parse(calls[0].init.body).signatures, { a: "s1", b: "s2" });
  });

  it("builds list queries from the filters that are set", async () => {
    const calls = stub(200, { items: [] });
    await clients.fetchApprovals({ status: "pending", action: "", subjectId: "x y" });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/approvals?status=pending&subjectId=x+y");
    await clients.fetchAdminRampOrders({});
    assert.equal(calls[1].url, "/__backend/api/v1/admin/ramp/orders");
  });

  it("reads roles from GET /admin/session, and treats a backend without it as roles unknown", async () => {
    stub(200, { party: "p", personId: "alice", roles: ["aml"] });
    assert.deepEqual((await clients.fetchAdminSessionInfo()).roles, ["aml"]);
    stub(404, { error: "not_found", message: "Cannot GET /api/v1/admin/session" });
    assert.equal(await clients.fetchAdminSessionInfo(), null);
    stub(401, { error: "unauthenticated", message: "x" });
    await assert.rejects(clients.fetchAdminSessionInfo(), (e) => e instanceof BackendError && e.status === 401);
  });

  it("moves PayoutQueue's Mark paid to the backend's approval-backed route", async () => {
    const calls = stub(202, { approval: approval({ action: "payout.mark_paid" }) });
    await clients.requestPayoutMarkPaid("00cid", { txHash: "0xabc", reason: "paid by bank transfer" });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/payouts/00cid/mark-paid");
    assert.deepEqual(JSON.parse(calls[0].init.body), { txHash: "0xabc", reason: "paid by bank transfer" });
  });
});

describe("backendDownload", () => {
  it("POSTs, returns the bytes and the server's file name", async () => {
    const calls = stub(200, "batch_id,document_no\n1,2\n", {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="payout-batch-7.csv"',
    });
    const file = await clients.exportPayoutBatch("7");
    assert.equal(calls[0].url, "/__backend/api/v1/admin/ramp/payout-batches/7/export");
    assert.deepEqual(JSON.parse(calls[0].init.body), {});
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["x-requested-with"], "truthoracle");
    assert.equal(calls[0].init.credentials, "include");
    assert.equal(file.filename, "payout-batch-7.csv");
    assert.equal(await file.blob.text(), "batch_id,document_no\n1,2\n");
  });

  it("throws the JSON envelope as BackendError", async () => {
    stub(409, { error: "batch_held", message: "an item is held", details: { orderId: "o1" } });
    await assert.rejects(backendDownload("/api/v1/x"), (e) => e instanceof BackendError && e.code === "batch_held" && e.details.orderId === "o1");
    stub(502, "<html>bad gateway</html>", { "content-type": "text/html" });
    await assert.rejects(backendDownload("/api/v1/x"), (e) => e.code === "http_502" && e.message === "Backend request failed (502).");
  });

  it("reads Content-Disposition safely", () => {
    assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''ops%202026-10.csv; filename=x.csv", "f"), "ops 2026-10.csv");
    assert.equal(filenameFromDisposition("attachment; filename=plain.csv", "f"), "plain.csv");
    assert.equal(filenameFromDisposition('attachment; filename="../../etc/passwd"', "f"), "passwd");
    assert.equal(filenameFromDisposition("attachment", "fallback.csv"), "fallback.csv");
    assert.equal(filenameFromDisposition("attachment; filename=\"..\"", "fallback.csv"), "fallback.csv");
    assert.equal(filenameFromDisposition(null, "fallback.csv"), "fallback.csv");
  });
});

describe("signed decisions: the wallet popup comes first", () => {
  const signerWith = (over = {}) => {
    const calls = [];
    const sign = admin.makeDecisionSigner({
      required: true,
      walletParty: "op-a::1220aa",
      operatorParty: "op-a::1220aa",
      walletName: "Cantor8",
      signMessage: async (message, partyId) => {
        calls.push({ message, partyId });
        return "c2ln";
      },
      ...over,
    });
    return { sign, calls };
  };

  it("signs the exact decision message with the session's party", async () => {
    const { sign, calls } = signerWith();
    const a = approval();
    assert.equal(await sign(a, "reject"), "c2ln");
    assert.deepEqual(calls, [{ message: `truthoracle-approval:${a.id}:${a.paramsHash}:reject`, partyId: "op-a::1220aa" }]);
  });

  it("refuses before any popup without a wallet, or with another party's wallet; skips signing when signatures are off", async () => {
    let s = signerWith({ walletParty: null });
    await assert.rejects(s.sign(approval(), "approve"), /Connect your Cantor8 wallet/);
    assert.equal(s.calls.length, 0);
    s = signerWith({ walletParty: "op-z::1220zz" });
    await assert.rejects(s.sign(approval(), "approve"), (e) => e instanceof RampAdminError && /not the party signed in/.test(e.message));
    assert.equal(s.calls.length, 0);
    s = signerWith({ required: false });
    assert.equal(await s.sign(approval(), "approve"), undefined);
    assert.equal(s.calls.length, 0);
  });

  it("decideApproval: sign, then post the decision with the signature", async () => {
    const order = [];
    globalThis.fetch = async (url, init) => {
      order.push(`fetch ${String(url)}`);
      order.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ approval: approval({ status: "executed" }) }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const sign = async (a, decision) => {
      order.push(`sign ${a.id.slice(0, 8)} ${decision}`);
      return "c2ln";
    };
    const out = await clients.decideApproval(approval(), "approve", "checked the ledger", sign);
    assert.deepEqual(order, [
      "sign 6f1c2b9e approve",
      "fetch /__backend/api/v1/admin/approvals/6f1c2b9e-0000-4000-8000-000000000001/approve",
      { reason: "checked the ledger", signature: "c2ln" },
    ]);
    assert.equal(out.approval.status, "executed");
    // Signatures off: no signature field (the backend's DTO refuses unknown or empty ones).
    order.length = 0;
    await clients.decideApproval(approval(), "reject", "wrong subject", async () => undefined);
    assert.deepEqual(order.slice(1), [{ reason: "wrong subject" }]);
  });

  it("approveStatementConfirmSigned: sign, then post only the copy's file fields with the decision", async () => {
    const order = [];
    globalThis.fetch = async (url, init) => {
      order.push(`fetch ${String(url)}`);
      order.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ approval: approval({ action: "ramp.statement.confirm", status: "executed" }) }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const sign = async () => {
      order.push("sign");
      return "c2ln";
    };
    await clients.approveStatementConfirmSigned("st-1", approval(), { format: "csv", content: "IyxhY2NvdW50", charset: "windows-1251" }, "own copy matches", sign);
    assert.deepEqual(order, [
      "sign",
      "fetch /__backend/api/v1/admin/ramp/bank-statements/st-1/confirm/approve",
      { format: "csv", content: "IyxhY2NvdW50", charset: "windows-1251", reason: "own copy matches", signature: "c2ln" },
    ]);
  });
});

describe("F3 alignment: the final backend's operator rules", () => {
  it("offers only the alert decisions the backend accepts from each status", () => {
    // An account-level alert (no order): wave 9's `return` needs a held order (test/ramp-admin-w9.test.mjs).
    const alert = (status) => ({ status, orderId: null, severity: "review" });
    assert.deepEqual(admin.alertDecisions(alert("open")), ["clear", "escalate", "report"]);
    assert.deepEqual(admin.alertDecisions(alert("escalated")), ["clear", "report"]);
    assert.deepEqual(admin.alertDecisions(alert("reported")), ["clear"], "a reported alert still holds until it is cleared");
    assert.deepEqual(admin.alertDecisions(alert("cleared")), [], "cleared is final");
  });

  it("decides open hits either way, and may still clear a confirmed foreign-list hit", () => {
    assert.deepEqual(admin.screeningHitDecisions({ status: "open", list: "by_terror" }), ["confirm", "clear"]);
    assert.deepEqual(admin.screeningHitDecisions({ status: "confirmed", list: "foreign" }), ["clear"]);
    assert.deepEqual(admin.screeningHitDecisions({ status: "confirmed", list: "un" }), [], "a domestic freeze ends with the four-eyes lift");
    assert.deepEqual(admin.screeningHitDecisions({ status: "cleared", list: "foreign" }), []);
  });

  it("checks a Mark-paid reference like the backend: never ramp:, printable reference characters only", () => {
    assert.equal(admin.markPaidReferenceProblem("SEPA/2026-10-19.0042"), null);
    assert.equal(admin.markPaidReferenceProblem("0xabc:12"), null);
    assert.match(admin.markPaidReferenceProblem(""), /Enter the transfer reference/);
    assert.match(admin.markPaidReferenceProblem("ramp:6f1c2b9e"), /ramp: reference/);
    assert.match(admin.markPaidReferenceProblem("RAMP:x"), /ramp: reference/);
    assert.match(admin.markPaidReferenceProblem("-starts-with-dash"), /letters, digits/);
    assert.match(admin.markPaidReferenceProblem("has space"), /letters, digits/);
    assert.match(admin.markPaidReferenceProblem("a".repeat(257)), /letters, digits/);
  });

  it("words an executed request as single control only when it was, and names the approving role", () => {
    assert.match(admin.outcomeSentence("Retry", { approval: approval({ status: "executed", singleControl: true }) }), /single control/);
    assert.doesNotMatch(admin.outcomeSentence("Refund", { approval: approval({ status: "executed", singleControl: false }) }), /single control/);
    assert.match(admin.outcomeSentence("Lift", { approval: approval({ action: "compliance.freeze.lift" }) }), /approver role/);
    assert.equal(admin.approveRoleFor("compliance.hit.decide"), "aml");
    assert.equal(admin.approveRoleFor("ramp.batch.approve"), "approver");
  });

  it("explains every reconciliation check the backend registers", () => {
    const backendChecks = [
      "journal_balanced",
      "issuance_matches_liability",
      "reserve_covers_liabilities",
      "treasury_covers_in_app",
      "provider_clearing_aging",
      "operator_money_unswept",
      "events_dead",
      "no_stuck_orders",
      "token_records_known",
      "token_commands_consistent",
      "token_commands_confirmed",
      "supply_matches_issuance",
      "bank_statement_matches_journal",
      "bank_payout_duplicate",
      "bank_iban_mismatch",
      "compliance_alerts_overdue",
      "compliance_bv_table",
      "screening_stale",
    ];
    for (const name of backendChecks) assert.ok(admin.RECON_CHECKS[name], name);
    const rows = admin.reserveRows({ recordedSupply: "1", statementFresh: true, unresolvedNonRampMints: "0" });
    assert.deepEqual(rows.map((r) => r.label), ["Recorded net issuance (ramp token)", "Unresolved non-ramp mints", "Latest confirmed statement is fresh"]);
  });
});

describe("F3 alignment: operator sentences for the final error codes", () => {
  const msg = (status, code, message = "x", details) => rampAdminErrorMessage(new BackendError(status, code, message, details));

  it("has an operator sentence for every code the controls, bank, compliance and screening stages added", () => {
    const codes = [
      "reserve_gate",
      "payout_gate",
      "role_required",
      "approval_pending",
      "approval_not_pending",
      "approval_expired",
      "approval_self",
      "approval_same_person",
      "approval_linked_person",
      "approval_role_required",
      "approval_signature_required",
      "approval_signature_invalid",
      "approval_precondition_changed",
      "approval_failed",
      "ramp_card_state",
      "bank_account_invalid",
      "kyc_identity_unavailable",
      "batch_state",
      "batch_held",
      "batch_export_mismatch",
      "statement_invalid",
      "statement_account",
      "statement_duplicate",
      "statement_continuity",
      "statement_mismatch",
      "bank_line_state",
      "compliance_alert_state",
      "export_range",
      "screening_list_invalid",
      "screening_list_exists",
      "screening_hit_state",
      "screening_hits_open",
      "rescreen_running",
      "freeze_active",
      "freeze_state",
      "token_app_cap",
      "token_app_invalid_request",
      "token_command_state",
      "payout_blocked",
    ];
    for (const code of codes) assert.equal(hasRampAdminSentence(code), true, code);
    assert.equal(hasRampAdminSentence("frozen"), false, "not a backend code");
  });

  it("quotes the backend's reason where it names the failed condition", () => {
    assert.equal(
      msg(409, "approval_failed", "the approved action failed: the order changed meanwhile; reload it", { approvalId: "a", cause: "ramp_order_state" }),
      "The approved action ran and failed: the order changed meanwhile; reload it. Nothing was half-applied; the approval shows the error.",
    );
    assert.match(msg(409, "approval_precondition_changed", "the request no longer applies: the mint is recorded"), /closed as failed: the mint is recorded\./);
    assert.match(msg(409, "ramp_order_state", "nothing is halted"), /^Not possible now: nothing is halted\./);
    assert.match(msg(409, "bank_line_state", "the line is matched"), /the line is matched/);
    assert.match(msg(409, "compliance_alert_state", "a reported alert cannot take the decision escalate"), /reported alert cannot/);
    assert.match(msg(409, "approval_not_pending", "x", { approvalId: "a", status: "executed" }), /^This approval is executed, no longer pending/);
    assert.match(msg(400, "validation_failed", "then must be requeue or reverse"), /then must be requeue or reverse/);
  });

  it("names the gate's reason, the held orders, the open hits and the existing freeze", () => {
    assert.match(msg(409, "payout_gate", "payout_gate:recon_stale: …", { reason: "recon_stale" }), /payout gate is closed \(recon_stale\)/);
    assert.match(msg(409, "reserve_gate", "reserve_gate:daily_cap: …", { reason: "daily_cap" }), /reserve gate is closed \(daily_cap\)/);
    assert.match(
      msg(409, "batch_held", "x", { held: [{ orderId: "0f6b2c1a-0000-4000-8000-000000000001", reason: "frozen" }] }),
      /on hold \(a freeze, a compliance decision or a chargeback\): 0f6b2c1a\./,
    );
    assert.match(msg(409, "screening_hits_open", "x", { userId: "u", openHits: 2 }), /Open list hits still hold this account \(2\)/);
    assert.match(msg(409, "freeze_active", "x", { freezeId: "9e8d7c6b-0000" }), /active freeze \(9e8d7c6b\)/);
    assert.match(msg(409, "batch_state", "no payout is ready to batch", { skipped: [{ orderId: "o", reason: "held" }] }), /1 queued order\(s\) were left out/);
    assert.match(msg(409, "kyc_identity_unavailable", "x", { userId: "4c3b2a19-0000" }), /account 4c3b2a19/);
  });

  it("says why a payout cannot be marked paid by hand", () => {
    assert.match(msg(409, "payout_blocked", "x", { reason: "ramp_bound" }), /belongs to a ramp cash-out/);
    assert.match(msg(409, "payout_blocked", "x", { reason: "ramp_bindable", orderId: "5a4b3c2d-0000" }), /waiting for its withdrawal \(5a4b3c2d\)/);
    assert.match(msg(409, "payout_blocked", "x", { reason: "settlement_recorded" }), /settlement was already recorded/);
    assert.match(msg(409, "payout_blocked", "x", { status: "settled_external" }), /already settled_external/);
    assert.match(msg(409, "payout_blocked", "the PendingPayout is no longer live", { cid: "c" }), /no longer live/);
  });
});

describe("F3 alignment: admin clients against the final routes", () => {
  it("reads a draft's skipped orders, posts submitted with its optional note, and names the batch file", async () => {
    let calls = stub(200, { batch: { id: "b1", itemCount: 1 }, items: [], skipped: [{ orderId: "o1", reason: "held" }] });
    const draft = await clients.createPayoutBatch({ reason: "weekly" });
    assert.deepEqual(draft.skipped, [{ orderId: "o1", reason: "held" }]);
    calls = stub(200, { batch: { id: "b1" } });
    await clients.markBatchSubmitted("b1", { bankReference: "PKT-42", reason: "sent at 10:00" });
    assert.deepEqual(JSON.parse(calls[0].init.body), { bankReference: "PKT-42", reason: "sent at 10:00" });
    stub(200, "a,b\n", { "content-type": "text/csv" });
    assert.equal((await clients.exportPayoutBatch("b1")).filename, "ramp-payout-batch-b1.csv", "the backend's own name when the header is not exposed");
  });

  it("queries alerts by order and due, hits by status, and posts re-screens and identity reads to their routes", async () => {
    const calls = stub(200, { items: [], nextCursor: null });
    await clients.fetchComplianceAlerts({ orderId: "o-1", due: "overdue", status: "" });
    assert.equal(calls[0].url, "/__backend/api/v1/admin/compliance/alerts?orderId=o-1&due=overdue");
    await clients.fetchScreeningHits({ status: "confirmed", list: "foreign" });
    assert.equal(calls[1].url, "/__backend/api/v1/admin/compliance/screening-hits?status=confirmed&list=foreign");
    await clients.fetchScreeningHit("h/1");
    assert.equal(calls[2].url, "/__backend/api/v1/admin/compliance/screening-hits/h%2F1");
    await clients.requestRescreen({ reason: "list refresh" });
    assert.equal(calls[3].url, "/__backend/api/v1/admin/compliance/screening-runs");
    assert.equal(calls[3].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[3].init.body), { reason: "list refresh" });
    await clients.fetchTokenCommands({ status: "", source: "ramp" });
    assert.equal(calls[4].url, "/__backend/api/v1/admin/tokens/commands?source=ramp");
  });

  it("reads an import whose re-screen was deferred, and tells a token approval from a token result", async () => {
    stub(200, { list: { list: "un", version: "v1", entryCount: 3 }, hits: null, run: null });
    const imported = await clients.importScreeningList({ list: "un", version: "v1", deliveredAt: "2026-10-19T00:00:00.000Z", content: "eA==" });
    assert.equal(imported.hits, null);
    assert.equal(imported.run, null);
    assert.equal(clients.isApprovalOutcome({ approval: approval({ action: "token.admin_mint" }) }), true);
    assert.equal(clients.isApprovalOutcome({ commandId: "c", status: "submitted" }), false);
  });
});
