/**
 * The frontend review of Ramp v2 (fe-findings): the figures an operator confirms and an approver
 * signs, the cash-out signature step's guards, the wallet's words for a withdrawal a cash-out
 * consumed, and the webhook console against the final backend routes. Pure layer only:
 * lib/rampAdmin.ts, lib/rampApprovalFigures.ts, lib/ramp.ts, lib/inAppWallet.ts and the clients in
 * lib/backendAdmin.ts.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const admin = await import("../frontend/lib/rampAdmin.ts");
const ramp = await import("../frontend/lib/ramp.ts");
const { BackendError } = await import("../frontend/lib/backend.ts");
const wallet = await import("../frontend/lib/inAppWallet.ts");
const figures = await import("../frontend/lib/rampApprovalFigures.ts");
const clients = await import("../frontend/lib/backendAdmin.ts");
const types = await import("../frontend/lib/rampAdminTypes.ts");
const { rampAdminErrorMessage } = await import("../frontend/lib/rampAdminErrors.ts");

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

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const cbyn = { admin: "cantor8::1220aa", id: "cBYN", symbol: "cBYN", name: "cBYN", decimals: 2 };
const adminOrder = (over = {}) => ({
  id: "0a0b0c0d-0000-4000-8000-000000000001",
  direction: "onramp",
  status: "needs_review",
  reviewStep: "refund",
  method: "erip",
  rail: null,
  fiatAmount: "100.0000000000",
  fiatCurrency: "BYN",
  feeAmount: "0.0000000000",
  tokenAmount: "100.0000000000",
  instrument: cbyn,
  capturedAmount: "150.0000000000",
  refundedAmount: "0.0000000000",
  details: {},
  userId: "u-1",
  partyId: "user::1220bb",
  ...over,
});

describe("F10: an order action's confirm carries the amount the backend moves", () => {
  it("refunds captured − refunded, not the quote", () => {
    assert.match(admin.rampActionFigure("refund", adminOrder()), /^150\.00 BYN \(the whole capture\) goes back to the payer/);
    const partial = admin.rampActionFigure("refund", adminOrder({ refundedAmount: "40.5000000000" }));
    assert.match(partial, /^109\.50 BYN \(150\.00 BYN captured − 40\.50 BYN refunded\)/);
    assert.match(admin.rampActionFigure("refund", adminOrder({ refundedAmount: "150" })), /Nothing is left to refund/);
    assert.match(admin.rampActionFigure("refund", adminOrder({ capturedAmount: null })), /No capture is recorded.*read at execution/);
  });

  it("queues the capture for a bank refund, and the capture or the fiat for a bank payout", () => {
    assert.match(admin.rampActionFigure("refund_bank", adminOrder(), { bankAccountId: " acc-1 " }), /^150\.00 BYN \(the capture\) is queued .* account acc-1\.$/);
    assert.match(admin.rampActionFigure("refund_bank", adminOrder({ capturedAmount: null })), /refuses a refund by bank/);
    assert.match(admin.rampActionFigure("bank_unpaid", adminOrder(), { then: "requeue" }), /^The 150\.00 BYN bank payout .* re-queued/);
    const cashOut = adminOrder({ direction: "offramp", rail: "bank", capturedAmount: null, fiatAmount: "99.0000000000" });
    assert.match(admin.rampActionFigure("bank_unpaid", cashOut, { then: "reverse" }), /^The 99\.00 BYN bank payout .* reversed/);
    assert.match(admin.rampActionFigure("credit_back", cashOut), /^100\.00 cBYN is deposited back/);
  });
});

const cashOut = (over = {}) => ({
  id: "0a0b0c0d-0000-4000-8000-0000000000c1",
  direction: "offramp",
  status: "awaiting_withdrawal",
  rail: "card",
  method: null,
  instrument: cbyn,
  tokenAmount: "100.0000000000",
  fiatAmount: "100.0000000000",
  fiatCurrency: "BYN",
  withdraw: { walletContractId: "00wallet", amount: "100.0000000000" },
  createdAt: "2026-10-20T12:00:00Z",
  expiresAt: "2026-10-20T12:15:00Z",
  card: null,
  ...over,
});

describe("F6: a signed withdrawal the backend matched is never offered for signing again", () => {
  it("lets a withdrawal go only on 409 ramp_order_state; a 200 with bindPending means matched, not bound yet", () => {
    assert.equal(ramp.attachOutcome({ bindPending: true }), "pending");
    assert.equal(ramp.attachOutcome({ bindPending: false }), "bound");
    assert.equal(ramp.attachOutcome({ error: new BackendError(409, "ramp_order_state", "the signed withdrawal does not match this cash-out") }), "not_this_order");
    for (const error of [new BackendError(409, "payout_blocked", "in flight"), new BackendError(503, "upstream_failed", "x"), new Error("offline")]) {
      assert.equal(ramp.attachOutcome({ error }), "retry", error.message);
    }
  });

  it("attaches a matched withdrawal again with backoff: 10 s, 20 s, 40 s, then every 60 s", () => {
    assert.deepEqual([1, 2, 3, 4, 9].map((n) => ramp.attachRetryDelayMs(n)), [10_000, 20_000, 40_000, 60_000, 60_000]);
  });
});

describe("F5: no signature is offered past the point it could reach the cash-out", () => {
  it("stops offering the popup the popup's own wait before the deadline (a third of a short window)", () => {
    assert.equal(ramp.rampSignBy(cashOut()), Date.parse("2026-10-20T12:10:00Z"));
    assert.equal(ramp.rampSignBy(cashOut({ expiresAt: "2026-10-20T12:03:00Z" })), Date.parse("2026-10-20T12:02:00Z"));
    assert.equal(ramp.rampSignBy(cashOut({ expiresAt: null })), null);
  });

  it("refuses inside the margin before the wallet is called, so nothing left the balance", async () => {
    let walletCalled = false;
    const late = cashOut({ createdAt: new Date(Date.now() - 14 * 60_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await assert.rejects(
      ramp.signRampWithdrawal({
        order: late,
        userParty: "user::1220bb",
        primaryParty: "user::1220bb",
        context: null,
        signAndSubmitTransaction: async () => {
          walletCalled = true;
          return { hash: "x" };
        },
      }),
      (e) => e instanceof ramp.RampNotSignedError && /too close to its deadline/.test(e.message),
    );
    assert.equal(walletCalled, false);
  });

  it("offers Cancel on a cash-out only while no signature of this tab is on its way", () => {
    const now = Date.parse("2026-10-20T12:05:00Z");
    assert.equal(ramp.rampCancelOffered(cashOut(), { now }), true);
    assert.equal(ramp.rampCancelOffered(cashOut(), { busy: true, now }), false, "popup open or linking");
    assert.equal(ramp.rampCancelOffered(cashOut(), { signedAt: now - 30_000, now }), false, "signed 30 s ago");
    assert.equal(ramp.rampCancelOffered(cashOut(), { signedAt: now - ramp.SIGNED_GRACE_MS, now }), true);
    assert.equal(ramp.rampCancelOffered({ direction: "onramp", status: "awaiting_payment" }, { busy: true, now }), true);
    assert.equal(ramp.rampCancelOffered(cashOut({ status: "withdrawing" }), { now }), false);
  });

  it("never says nothing left the balance after this tab saw a signature", () => {
    for (const status of ["expired", "cancelled"]) {
      const signed = ramp.rampStatusSentence(cashOut({ status }), { signedAt: Date.now() });
      assert.match(signed, /nothing goes to your card/);
      assert.match(signed, /sent to your .* wallet as a normal withdrawal instead; Pending payouts/);
    }
    const unsigned = ramp.rampStatusSentence(cashOut({ status: "expired" }));
    assert.equal(unsigned, "This cash-out expired before it was signed. Nothing was paid out.");
    assert.doesNotMatch(unsigned, /Nothing left your balance/);
  });

  it("remembers this tab's signature in sessionStorage, and survives storage being off", () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const store = new Map();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    });
    try {
      assert.equal(ramp.readRampSignedAt("o-1"), null);
      ramp.rememberRampSigned("o-1", 1_760_000_000_000);
      assert.equal(ramp.readRampSignedAt("o-1"), 1_760_000_000_000);
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        get() {
          throw new Error("SecurityError");
        },
      });
      assert.equal(ramp.readRampSignedAt("o-1"), null);
      assert.doesNotThrow(() => ramp.rememberRampSigned("o-1", 1));
    } finally {
      if (saved) Object.defineProperty(globalThis, "sessionStorage", saved);
      else delete globalThis.sessionStorage;
    }
  });
});

describe("F7: a withdrawal an open cash-out consumes is never announced as sent to the wallet", () => {
  const open = cashOut({ destination: { kind: "card", paymentMethodId: "pm-1", brand: "Visa", last4: "4242" } });

  it("finds the open cash-out of exactly the typed amount, before the popup", () => {
    assert.equal(ramp.openCashOutFor([open], cbyn, 100), open);
    assert.equal(ramp.openCashOutFor([open], cbyn, 100.01), null);
    assert.equal(ramp.openCashOutFor([open], { ...cbyn, id: "TRO" }, 100), null);
    assert.equal(ramp.openCashOutFor([cashOut({ status: "withdrawing" })], cbyn, 100), null);
    assert.equal(ramp.openCashOutFor([{ ...open, direction: "onramp" }], cbyn, 100), null);
    assert.equal(ramp.openCashOutFor(null, cbyn, 100), null);
    assert.match(ramp.cashOutMatchSentence(open), /used for that cash-out and the money goes to your card Visa •••• 4242, not to your .* wallet/);
  });

  it("words mode offramp as used for the cash-out, never as sent", () => {
    const used = wallet.withdrawSettledMessage({ mode: "offramp" }, "100.00 cBYN");
    assert.equal(used.title, "Withdrawal used for your cash-out");
    assert.doesNotMatch(used.description, /sent to your/);
    assert.match(wallet.withdrawSettledMessage({ mode: "external" }, "1 CC").description, /^1 CC sent to your /);
    assert.equal(wallet.withdrawSettledMessage({ mode: "in_app" }, "1 CC").title, "Withdrawal credited in-app");
  });

  it("carries the cash-out from the settle answer, and parks a ramp_exposure hold in wallet words", async () => {
    const answers = [
      [200, { payout: { status: "settled_external", offrampOrderId: open.id }, mode: "offramp" }],
      [409, { error: "ramp_exposure", message: "value bought by card is inside the card dispute window" }],
    ];
    globalThis.fetch = async () => {
      const [status, body] = answers.shift();
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    };
    assert.deepEqual(await wallet.settlePayoutWithBackend("00p1"), { settled: true, mode: "offramp", status: "settled_external", offrampOrderId: open.id });
    const held = await wallet.settlePayoutWithBackend("00p2");
    assert.equal(held.settled, false);
    assert.equal(held.blocked, "blocked_ramp_exposure");
    assert.match(held.detail, /card dispute window/);
    assert.doesNotMatch(held.detail, /bank account/);
    assert.doesNotMatch(wallet.moneyErrorMessage(new BackendError(409, "ramp_exposure", "x")), /bank account/);
  });
});

describe("F12: cancelling a cash-out's withdrawal says it cancels the cash-out", () => {
  it("names the cash-out when the payout is bound to one", () => {
    const bound = wallet.payoutCancelDescription("100.00 cBYN", "0a0b0c0d-0000-4000-8000-0000000000c1");
    assert.match(bound, /^This withdrawal belongs to your cash-out \(order 0a0b0c0d\)\. Cancelling it cancels that cash-out: nothing is paid/);
    assert.match(bound, /100\.00 cBYN goes back into your in-app balance/);
    assert.doesNotMatch(bound, /external wallet/);
    assert.match(wallet.payoutCancelDescription("5 CC", null), /^5 CC goes back into your in-app balance instead of being sent to your external wallet/);
  });
});

describe("F2 / F8: the approver sees the figures of the decision, not only the requester's words", () => {
  const approval = (over = {}) => ({
    id: "6f1c2b9e-0000-4000-8000-0000000000a1",
    action: "ramp.order.refund",
    subjectType: "ramp_order",
    subjectId: adminOrder().id,
    params: {},
    paramsHash: "ab".repeat(32),
    precondition: { id: adminOrder().id, version: 4, status: "needs_review", reviewStep: "refund", capturedAmount: "150.0000000000", refundedAmount: "0.0000000000" },
    description: "refund order 0a0b0c0d (needs_review, review refund)",
    reason: "duplicate, 19.00 BYN, checked",
    status: "pending",
    singleControl: false,
    requestedByUserId: "u-a",
    requestedByParty: "op-a::1220aa",
    requestedByPerson: "alice",
    requestedAt: "2026-10-20T10:00:00Z",
    expiresAt: "2026-10-22T20:59:59Z",
    ...over,
  });
  const order = (over = {}) => ({ ...adminOrder(), version: 4, card: { brand: "Visa", last4: "4242" }, destination: null, ...over });
  const byLabel = (list) => Object.fromEntries(list.map((f) => [f.label, f.value]));

  it("names what a ramp order action moves, the order, the user and where the money goes", () => {
    const list = figures.approvalFigures(approval(), order());
    assert.equal(list[0].label, "Moves");
    assert.equal(list[0].strong, true);
    const f = byLabel(list);
    assert.match(f.Moves, /^150\.00 BYN \(the whole capture\) goes back to the payer/);
    assert.equal(f.Order, "buy · 100.00 BYN · 100.00 cBYN");
    assert.equal(f.User, "u-1 · user::1220bb");
    assert.equal(f["Paid with"], "card Visa •••• 4242");
    assert.equal(f["Requested at"], "needs_review, review refund");
    assert.equal(f["Captured / refunded then"], "150.00 BYN / 0.00 BYN");
    assert.ok(list.every((x) => !x.value.includes("19.00 BYN")), "the requester's free text is never a figure");
  });

  it("reads the precondition's captured / refunded (what executes), and says when the order moved on", () => {
    const pre = { ...approval().precondition, version: 3, refundedAmount: "40.0000000000" };
    const f = byLabel(figures.approvalFigures(approval({ precondition: pre }), order({ refundedAmount: "0.0000000000" })));
    assert.match(f.Moves, /^110\.00 BYN \(150\.00 BYN captured − 40\.00 BYN refunded\)/);
    assert.match(f["Changed since the request"], /^v3 → v4: approving fails/);
    assert.equal(byLabel(figures.approvalFigures(approval(), null)).Moves, "Reading the order's figures…");
  });

  it("shows a bank refund's account and a bank payout's follow-up", () => {
    const bank = byLabel(figures.approvalFigures(approval({ action: "ramp.order.refund_bank", params: { bankAccountId: "acc-9" } }), order()));
    assert.match(bank.Moves, /^150\.00 BYN \(the capture\) is queued as a bank transfer to the user's proved account acc-9\.$/);
    assert.equal(bank["To bank account"], "acc-9");
    const cash = order({ direction: "offramp", rail: "bank", card: null, destination: { kind: "bank", bankAccountId: "b-1", bankName: "Belarusbank", ibanMasked: "BY•• 1234" } });
    const unpaid = byLabel(figures.approvalFigures(approval({ action: "ramp.order.bank_unpaid", params: { then: "reverse" }, precondition: { status: "needs_review" } }), cash));
    assert.match(unpaid.Moves, /^The 100\.00 BYN bank payout is recorded as unpaid, then reversed/);
    assert.equal(unpaid["Pays to"], "bank account Belarusbank BY•• 1234");
    assert.equal(unpaid.Then, "reverse (re-mint, credit back)");
  });

  it("labels every parameter and snapshot field of any other action, amounts first-class", () => {
    const markPaid = approval({
      action: "payout.mark_paid",
      subjectType: "payout",
      params: { txHash: "bank-ref-77" },
      precondition: { cid: "00p", live: true, status: "queued", attempts: 0, amount: "250.5000000000", payee: "user::1220bb", reason: "withdraw", userId: "u-1" },
    });
    const list = figures.approvalFigures(markPaid);
    const f = byLabel(list);
    assert.equal(f["tx hash"], "bank-ref-77");
    assert.equal(f["amount (at request)"], "250.50");
    assert.equal(list.find((x) => x.label === "amount (at request)").strong, true);
    assert.equal(f["payee (at request)"], "user::1220bb");
    const confirm = approval({
      action: "ramp.statement.confirm",
      params: { classifications: [{ lineId: "1a2b3c4d-0000-4000-8000-000000000001", matchKind: "payout_return", orderId: "5e6f7a8b-0000-4000-8000-000000000002" }] },
      precondition: { periodFrom: "2026-10-19", closing: "1000.0000000000", lineCount: 3 },
    });
    assert.equal(byLabel(figures.approvalFigures(confirm)).Books, "line 1a2b3c4d → payout_return (order 5e6f7a8b)");
  });

  it("totals approve-many per unit, and says how many had no exact figure", () => {
    const refund = (captured, refunded = "0") => figures.approvalAmount(approval({ precondition: { capturedAmount: captured, refundedAmount: refunded } }), order());
    const back = figures.approvalAmount(approval({ action: "ramp.order.credit_back" }), order({ direction: "offramp" }));
    assert.equal(figures.approvalsTotal([refund("150.0000000000"), refund("80.0000000000", "30.0000000000")]), "200.00 BYN");
    assert.equal(figures.approvalsTotal([refund("150.0000000000"), back]), "150.00 BYN + 100.00 cBYN");
    assert.equal(figures.approvalsTotal([refund("150.0000000000"), null]), "150.00 BYN (+ 1 without an exact figure)");
    assert.equal(figures.approvalsTotal([figures.approvalAmount(approval({ action: "ramp.order.retry" }), order())]), "no exact figure");
  });
});

describe("F3 / F9: the statement-confirm approver sees what the request books", () => {
  const line = (id, amount, over = {}) => ({
    id,
    statementId: "st-1",
    lineRef: `L-${id.slice(0, 1)}`,
    bookingDate: "2026-10-19T00:00:00Z",
    amount,
    currency: "BYN",
    status: "unmatched",
    flags: [],
    ...over,
  });
  const lines = [line("1a2b3c4d-0000-4000-8000-000000000001", "-1500.0000000000"), line("2b3c4d5e-0000-4000-8000-000000000002", "75.5000000000")];
  const pending = {
    params: {
      classifications: [
        { lineId: "1A2B3C4D-0000-4000-8000-000000000001", matchKind: "operator_sweep" },
        { lineId: "2b3c4d5e-0000-4000-8000-000000000002", matchKind: "payout_return", orderId: "5e6f7a8b-0000-4000-8000-000000000009" },
        { lineId: "9f9f9f9f-0000-4000-8000-000000000003", matchKind: "operator_topup" },
      ],
    },
  };

  it("joins the request's classifications to the statement's lines, by id", () => {
    const booked = figures.statementBookings(pending, lines);
    assert.deepEqual([...booked.keys()], ["1a2b3c4d-0000-4000-8000-000000000001", "2b3c4d5e-0000-4000-8000-000000000002", "9f9f9f9f-0000-4000-8000-000000000003"]);
    assert.equal(figures.bookingSentence(booked.get("1a2b3c4d-0000-4000-8000-000000000001")), "-1,500.00 BYN (L-1, 2026-10-19) as operator_sweep");
    assert.equal(figures.bookingSentence(booked.get("2b3c4d5e-0000-4000-8000-000000000002")), "75.50 BYN (L-2, 2026-10-19) as payout_return, order 5e6f7a8b");
    assert.equal(figures.bookingSentence(booked.get("9f9f9f9f-0000-4000-8000-000000000003")), "line 9f9f9f9f (not in this statement) as operator_topup");
    assert.equal(figures.statementBookings(null, lines).size, 0);
    assert.equal(figures.statementBookings({ params: {} }, lines).size, 0);
  });
});

describe("(c) the webhook console against the final backend routes", () => {
  // The backend's ApiRampEventRow (truthoracle-backend-ramp eventRowToApi): every field, always present.
  const row = (over = {}) => ({
    id: "e1e2e3e4-0000-4000-8000-000000000005",
    provider: "mock",
    type: "payment.chargeback",
    kind: "chargeback",
    objectId: "pay_123",
    orderId: null,
    sandbox: false,
    occurredAt: "2026-10-16T09:59:00Z",
    receivedAt: "2026-10-16T10:00:00Z",
    processedAt: null,
    attempts: 41,
    lastAttemptAt: "2026-10-19T09:00:00Z",
    nextAttemptAt: null,
    deadAt: "2026-10-19T10:00:00Z",
    error: "provider timeout",
    replayedAt: null,
    closedAt: null,
    closeReason: null,
    ...over,
  });

  it("reads the replay's {event} strictly", async () => {
    const calls = replies([200, { event: row({ deadAt: null, replayedAt: "2026-10-20T10:00:00Z" }) }], [200, {}]);
    const answer = await clients.replayRampEvent(row().id, { reason: "PSP fixed" });
    assert.equal(calls[0].url, `/__backend/api/v1/admin/ramp/events/${row().id}/replay`);
    assert.deepEqual(calls[0].body, { reason: "PSP fixed" });
    assert.equal(answer.event.replayedAt, "2026-10-20T10:00:00Z");
    await assert.rejects(clients.replayRampEvent(row().id, { reason: "x" }), (e) => e instanceof BackendError && e.code === "invalid_response");
  });

  it("closes through the four-eyes ramp.event.close and finds the pending ones by event", async () => {
    assert.equal(types.RAMP_EVENT_CLOSE_ACTION, "ramp.event.close");
    const pending = { id: "6f1c2b9e-0000-4000-8000-0000000000e1", action: "ramp.event.close", subjectType: "ramp_event", subjectId: row().id, status: "pending" };
    const calls = replies([202, { approval: pending }], [200, { items: [pending] }]);
    const out = await clients.requestRampEventClose(row().id, { reason: "applied by hand" });
    assert.equal(calls[0].url, `/__backend/api/v1/admin/ramp/events/${row().id}/close`);
    assert.equal(out.approval.action, "ramp.event.close");
    const closes = await clients.fetchPendingEventCloses();
    assert.equal(calls[1].url, "/__backend/api/v1/admin/approvals?status=pending&action=ramp.event.close");
    assert.equal(closes.get(row().id).id, pending.id);
  });

  it("words 409 ramp_event_state for the operator", () => {
    const sentence = rampAdminErrorMessage(new BackendError(409, "ramp_event_state", "the event was closed"));
    assert.equal(sentence, "The event is no longer open: the event was closed. Reload the list: an applied or closed event needs nothing more.");
  });
});

describe("wiring the node tests cannot render (TSX): pinned in the source", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (path) => readFileSync(new URL(`../frontend/${path}`, import.meta.url), "utf8");

  it("F11: another order never shows the previous one's state or figures", () => {
    assert.match(src("components/Admin/RampOrdersPanel.tsx"), /<RampOrderDetail key=\{selected\} orderId=\{selected\}/);
    assert.match(src("components/Admin/RampAdminUi.tsx"), /data: loaded !== null && loaded\.load === load \? loaded\.data : null/);
  });

  it("F5 / F6: Cancel and Sign follow the lib's rules", () => {
    assert.match(src("components/ramp/RampOrderPage.tsx"), /rampCancelOffered\(order, \{ busy: withdrawBusy, signedAt, now \}\)/);
    assert.match(src("components/ramp/RampOrderLine.tsx"), /rampCancelOffered\(order, \{ signedAt: readRampSignedAt\(order\.id\), now: Date\.now\(\) \}\)/);
    const step = src("components/ramp/RampWithdrawStep.tsx");
    assert.match(step, /disabled=\{phase === "signing" \|\| !ready \|\| tooLate\}/);
    assert.match(step, /attachOutcome\(\{ error: e \}\) === "not_this_order"\) rejected\.current\.add/);
    assert.doesNotMatch(step, /status === "awaiting_withdrawal"\) rejected/);
  });

  it("F2 / F8 / F3 / F9 / F1: approvals wait for figures, statements show the pending bookings, the console reads as the operator", () => {
    assert.match(src("components/Admin/RampApprovalsPanel.tsx"), /disabled=\{busy !== null \|\| blocker !== null \|\| figuresBlocker\(a\) !== null \|\| !reasonOk\}/);
    assert.match(src("components/Admin/RampStatementsPanel.tsx"), /booked=\{statement\.status === "draft" && pending \? pendingBookings : undefined\}/);
    assert.match(src("lib/cantonParticipant.ts"), /"Content-Type": "application\/json", \.\.\.adminInstanceHeaders\(\)/);
  });
});
