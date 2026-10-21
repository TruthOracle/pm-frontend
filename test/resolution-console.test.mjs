/**
 * The market page's resolution console on the backend's newer GET (lib/marketResolution.ts,
 * MarketOperatorResolution.tsx): `attestations` (usable ones preselected and untickable, unusable
 * ones listed with an operator sentence, never sent), `lastSubmission` (`submitted` = the wallet
 * accepted it and the index has not shown the result yet), the POST result's `status`, all read
 * leniently so a backend without them gets the console as it was; and the operator sentences for a
 * position in the market (409 approval_conflict, I8), an unreadable ledger (503) and the wallet's
 * own error (approval_failed, or a single-control request).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

// Imported inside each test: on the code before this change every test fails on its own.
const route = () => import("../frontend/lib/marketResolution.ts");
const errorsLib = () => import("../frontend/lib/rampAdminErrors.ts");
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

const EXPIRES = "2026-10-19T12:00:00.000Z";
const state = (over = {}) => ({
  market: { marketId: 12, ticker: "BTC-26OCT-100K", status: "Trading" },
  windows: { resolveT0From: EXPIRES, resolveT0To: "2026-10-21T12:00:00.000Z", resolveFrom: EXPIRES, voidFrom: "2026-10-21T12:00:01.000Z" },
  choicesAvailable: ["Resolve"],
  pending: null,
  asOf: "2026-10-20T09:00:00.000Z",
  ...over,
});
// The GET's attestations: two usable, one read after the window closed.
const ATT = [
  { cid: "00att-a", outcome: "Yes", sourceUri: "https://a.example/r", fetchedAt: "2026-10-19T12:30:00.000Z", usable: true, reason: null },
  { cid: "00att-b", outcome: "Yes", sourceUri: "https://b.example/r", fetchedAt: "2026-10-22T08:00:00.000Z", usable: false, reason: "attestation_window" },
  { cid: "00att-c", outcome: "VoidOutcome", sourceUri: "https://c.example/r", fetchedAt: "2026-10-19T13:00:05.000Z", usable: true, reason: null },
];
const LAST = { commandId: "market-resolve-12-6f1c", choice: "Resolve", at: "2026-10-20T08:59:30.000Z", status: "submitted", error: null };
const approval = (over = {}) => ({
  id: "6f1c2b9e-0000-4000-8000-0000000000a1",
  action: "market.resolve",
  subjectType: "market",
  subjectId: "12",
  params: { choice: "Resolve", attestationCids: ["00att-a"] },
  precondition: null,
  status: "pending",
  singleControl: false,
  requestedByPerson: "alice",
  requestedByParty: "op-a::1220aa",
  requestedAt: "2026-10-19T12:05:00.000Z",
  expiresAt: "2026-10-21T20:59:59.000Z",
  error: null,
  ...over,
});

describe("the resolution console on the backend's attestations and last submission", () => {
  it("reads the GET's attestations and last submission leniently, and an answer without them as before", async () => {
    const r = await route();
    const extra = [{ outcome: "No", usable: true }, { ...ATT[0], outcome: "No" }, { ...ATT[0], cid: "00att-d", usable: "yes" }];
    const now = r.readResolutionState(state({ attestations: [...ATT, ...extra], lastSubmission: LAST }));
    assert.deepEqual(
      now.attestations.map((a) => [a.cid, a.outcome, a.fetchedAt, a.usable, a.reason]),
      [
        ["00att-a", "Yes", "2026-10-19T12:30:00.000Z", true, null],
        ["00att-b", "Yes", "2026-10-22T08:00:00.000Z", false, "attestation_window"],
        ["00att-c", "VoidOutcome", "2026-10-19T13:00:05.000Z", true, null],
        ["00att-d", "Yes", "2026-10-19T12:30:00.000Z", false, null],
      ],
      "an entry without its cid is dropped, a repeated cid kept once, anything but usable: true is unusable",
    );
    assert.deepEqual(now.lastSubmission, LAST);
    // A backend before the change: neither field, so the console offers the public ledger read as it did.
    const before = r.readResolutionState(state());
    assert.deepEqual([before.attestations, before.lastSubmission], [null, null]);
    const odd = r.readResolutionState(state({ attestations: { "00att-a": true }, lastSubmission: { ...LAST, status: "queued", choice: "Burn", error: " wallet 503 " } }));
    assert.equal(odd.attestations, null, "not a list: read as absent");
    assert.deepEqual([odd.lastSubmission.status, odd.lastSubmission.choice, odd.lastSubmission.error], ["unknown", null, "wallet 503"]);
    assert.equal(r.readResolutionState(state({ lastSubmission: { ...LAST, commandId: "" } })).lastSubmission, null);
    assert.equal(r.readResolutionState(state({ lastSubmission: null })).lastSubmission, null);
  });

  it("preselects the usable attestations, lists the unusable ones with why, and never sends an unticked or unusable one", async () => {
    const r = await route();
    const calls = replies([200, state({ attestations: ATT })], [202, { approval: approval() }]);
    const s = await r.fetchMarketResolution(12);
    const rows = r.resolveAttestationRows(s.attestations, [], new Set(["00att-c"]));
    assert.deepEqual(rows.map((a) => [a.cid, a.outcome, a.usable, a.selected]), [
      ["00att-a", "Yes", true, true],
      ["00att-b", "Yes", false, false],
      ["00att-c", "Void", true, false],
    ]);
    assert.deepEqual([rows[0].why, rows[2].why], [null, null]);
    assert.equal(rows[1].why, "It was read outside the resolution window (from the expiry to the end of the grace period).");
    assert.equal(rows[0].fetchedAt, Date.parse("2026-10-19T12:30:00.000Z"));
    // Without an untick every usable one is in; an unusable one never is, whatever the ticks say.
    assert.deepEqual(r.resolveAttestationRows(s.attestations, []).filter((a) => a.selected).map((a) => a.cid), ["00att-a", "00att-c"]);
    assert.equal(r.resolveAttestationRows(s.attestations, [], new Set()).find((a) => a.cid === "00att-b").selected, false);
    const picked = rows.filter((a) => a.selected).map((a) => a.cid);
    await r.requestMarketResolution(12, { choice: "Resolve", attestationCids: picked }, "quorum met");
    assert.deepEqual(calls[1].body, { choice: "Resolve", attestationCids: ["00att-a"], reason: "quorum met" });
    assert.equal(r.resolvePickProblem(rows), null);
    assert.equal(r.resolvePickProblem(r.resolveAttestationRows(s.attestations, [], new Set(["00att-a", "00att-c"]))), "Tick at least one usable attestation.");
    assert.equal(r.resolvePickProblem(r.resolveAttestationRows([s.attestations[1]], [])), "No attestation can be used now; each one says why.");
    assert.equal(r.resolvePickProblem(r.resolveAttestationRows([], [])), "There is no attestation of this market to resolve from yet.");
  });

  it("offers the public ledger read, every one of it, while the backend sends no attestations (as before)", async () => {
    const r = await route();
    const ledger = [
      { contractId: "00led-1", outcome: "Yes", sourceUri: "https://a.example/r", fetchedAt: 1760877000, hasSourceSignature: true },
      { contractId: "00led-2", outcome: "VoidOutcome", sourceUri: "https://b.example/r", fetchedAt: 1760877060, hasSourceSignature: false },
    ];
    const rows = r.resolveAttestationRows(null, ledger, new Set(["00led-1"]));
    assert.deepEqual(
      rows.map((a) => [a.cid, a.outcome, a.signed, a.usable, a.selected, a.why]),
      [
        ["00led-1", "Yes", true, true, true, null],
        ["00led-2", "Void", false, true, true, null],
      ],
      "no picking without the backend's read: an untick is ignored",
    );
    assert.equal(rows[0].fetchedAt, 1760877000 * 1000);
  });

  it("words each reason an attestation is unusable for, with or without the attestation_ prefix", async () => {
    const r = await route();
    const cases = {
      unknown: /^The backend's ledger index does not hold it yet, so it cannot vouch for it\./,
      archived: /^It is no longer active on the ledger\.$/,
      other_market: /^It is about another market\.$/,
      source: /^Its source is not in this market's source allowlist\.$/,
      window: /^It was read outside the resolution window/,
      malformed: /not DER-encoded, so the ledger would refuse the whole request\.$/,
    };
    for (const [slug, sentence] of Object.entries(cases)) {
      assert.match(r.attestationReasonSentence(`attestation_${slug}`), sentence, slug);
      assert.equal(r.attestationReasonSentence(slug), r.attestationReasonSentence(`attestation_${slug}`), slug);
    }
    assert.equal(r.attestationReasonSentence("source_not_allowed"), r.attestationReasonSentence("attestation_source"));
    assert.equal(r.attestationReasonSentence("signature_stale"), "The backend will not use it (signature_stale).");
    assert.equal(r.attestationReasonSentence(null), "The backend will not use it and gave no reason.");
  });
});

describe("the resolution console: how a submission stands, and the operator sentences for its refusals", () => {
  it("shows the last submission; submitted means the wallet accepted it and the index has not shown the result yet", async () => {
    const r = await route();
    const s = (over) => r.lastSubmissionSentence({ ...LAST, ...over });
    const head = "Last submission: Resolve (command market-resolve-12-6f1c) at 2026-10-20 08:59:30 UTC";
    assert.equal(s({}), `${head}, submitted: the wallet accepted it and the backend's index has not shown the result yet. The market updates once it does; wait for that before requesting again.`);
    assert.equal(s({ status: "succeeded" }), `${head}, succeeded: the ledger applied it.`);
    assert.equal(
      s({ status: "failed", error: "CONTRACT_NOT_FOUND: the market contract was consumed." }),
      `${head}, failed: CONTRACT_NOT_FOUND: the market contract was consumed. The ledger did not apply it; request it again once the cause is fixed.`,
    );
    assert.equal(
      s({ status: "unknown", error: "wallet status 503", choice: null, at: null }),
      "Last submission: a resolution (command market-resolve-12-6f1c) at —: the backend cannot tell how it ended (wallet status 503). Reload in a minute before requesting it again.",
    );
  });

  it("says how the POST's submission stands when its result carries a status, and as before when it does not", async () => {
    const r = await route();
    const answer = (status) =>
      r.resolutionAnswerSentence({
        approval: approval({ status: "executed", singleControl: true, params: { choice: "VoidMarket" } }),
        result: { marketId: "12", choice: "VoidMarket", commandId: "cmd-77", ...(status ? { status } : {}) },
      });
    const head = "VoidMarket on market #12 was submitted by the backend as the treasury (command cmd-77), requested by alice at 2026-10-19 12:05:00 UTC, single control";
    assert.deepEqual(answer("submitted"), {
      title: "VoidMarket submitted",
      description: `${head}. The wallet accepted it and the backend's index has not shown the result yet; the market updates once it does.`,
      status: "success",
    });
    assert.deepEqual(answer("succeeded"), { title: "VoidMarket applied", description: `${head}, and the ledger applied it.`, status: "success" });
    assert.deepEqual([answer("failed").title, answer("failed").status], ["VoidMarket failed", "error"]);
    assert.equal(answer("failed").description, `${head}, and the ledger did not apply it. The last submission below says why; request it again once that is fixed.`);
    assert.deepEqual([answer("unknown").title, answer("unknown").status], ["VoidMarket submitted, outcome unknown", "warning"]);
    // A backend without the field, or a status the console does not know: the sentence it always gave.
    for (const status of [undefined, "queued"]) {
      assert.equal(
        answer(status).description,
        `${head}. The market updates once the ledger shows it; if it still shows open a minute later, the ledger refused the submission (the market moved meanwhile): request it again.`,
      );
    }
  });

  it("has operator sentences for a position in the market, an unreadable ledger and the wallet's error", async () => {
    const r = await route();
    const { rampAdminErrorMessage, hasRampAdminSentence } = await errorsLib();
    const err = (status, code, message, details) => new BackendError(status, code, message, details);
    const position =
      "alice holds a position in this market (directly or through a linked account), and a person who gains or loses by its outcome may neither request nor approve its resolution. Another person must.";
    // The conflict of interest: the new 409 and the backend's existing I8 code read the same on the market page.
    const conflict = err(409, "approval_conflict", "alice holds a position in market #12", { reason: "position_in_market", person: "alice" });
    assert.equal(rampAdminErrorMessage(conflict), position, "the approvals console too");
    assert.equal(r.resolutionErrorMessage(conflict), position);
    assert.equal(r.resolutionErrorMessage(err(403, "approval_linked_person", "alice is linked to the subject's account; another person must act", { person: "alice" })), position);
    assert.equal(rampAdminErrorMessage(err(403, "approval_linked_person", "x", { person: "alice", reason: "position_in_market" })), position);
    assert.match(rampAdminErrorMessage(err(403, "approval_linked_person", "x", { person: "alice" })), /linked to the account this concerns/, "a ramp subject keeps its sentence");
    assert.match(rampAdminErrorMessage(err(409, "approval_conflict", "x", { reason: "position_in_market" })), /^You or the requester hold a position in this market/);
    assert.equal(rampAdminErrorMessage(err(409, "approval_conflict", "bob approved its funding", { reason: "funded_market" })), "A conflict of interest refuses this: bob approved its funding. Another person must act.");
    assert.equal(hasRampAdminSentence("approval_conflict"), true);
    // A 503 for an unreadable ledger: the backend's ledger_stale with no lag, or a ledger code the table does not know.
    const unreadable =
      "The backend cannot read the ledger right now: participant unreachable. It decides nothing until it can: try again in a minute, and if it keeps failing, its ledger connection needs looking at.";
    assert.equal(r.resolutionErrorMessage(err(503, "ledger_stale", "participant unreachable")), unreadable);
    assert.equal(r.resolutionErrorMessage(err(503, "ledger_unavailable", "participant unreachable")), unreadable);
    assert.equal(r.resolutionErrorMessage(err(503, "not_ready", "the Enterprise Wallet is not configured")), "The backend is not ready for this: the Enterprise Wallet is not configured.");
    // The wallet's own error: on an approval that failed at it, and on a request that ran at once (single control).
    const refusal = (e) => `The treasury wallet did not accept the command: ${e}. The request is closed as failed; reload, and request it again if nothing changed.`;
    const failedAt = "wallet external submit failed (500): COMMAND_REJECTED: contract not active";
    assert.equal(r.resolutionErrorMessage(err(409, "approval_failed", `the approved action failed: ${failedAt}`, { approvalId: "a", cause: "upstream_failed" })), refusal(failedAt));
    assert.equal(
      rampAdminErrorMessage(err(409, "approval_failed", "the approved action failed: x", { cause: "upstream_failed", walletError: "LOCAL_VERDICT_TIMEOUT: no confirmation in time" })),
      refusal("LOCAL_VERDICT_TIMEOUT: no confirmation in time"),
    );
    assert.match(rampAdminErrorMessage(err(409, "approval_failed", "the approved action failed: the order changed meanwhile", { cause: "ramp_order_state" })), /^The approved action ran and failed: the order changed meanwhile\./);
    assert.equal(r.resolutionErrorMessage(err(502, "upstream_failed", "wallet external submit failed (500)", { upstreamStatus: 500 })), refusal("wallet external submit failed (500)"));
  });

  it("the console (TSX, pinned): the backend's attestations ticked, the unusable ones with why, the last submission, the market's sentences", () => {
    const console = readFileSync(new URL("../frontend/components/market/MarketOperatorResolution.tsx", import.meta.url), "utf8");
    assert.match(console, /const rows = resolveAttestationRows\(state\?\.attestations \?\? null, attestations, unticked\);/);
    assert.match(console, /const resolveInput: MarketResolutionInput = \{ choice: "Resolve", attestationCids: picked\.map\(\(a\) => a\.cid\) \};/);
    assert.match(console, /\{pickable && <input type="checkbox" checked=\{a\.selected\} disabled=\{!a\.usable \|\| busy !== null \|\| signing !== null\} onChange=\{\(\) => toggle\(a\.cid\)\} \/>\}/);
    assert.match(console, /\{a\.why && <p className="text-\[11px\] text-oracle-no">\{a\.why\}<\/p>\}/);
    assert.match(console, /\{lastSubmissionSentence\(state\.lastSubmission\)\}/);
    assert.equal(console.match(/resolutionErrorMessage\(e\)/g)?.length, 2, "the load and the request");
    assert.doesNotMatch(console, /rampAdminErrorMessage|attestations\.map\(\(a\) => a\.contractId\)/);
  });
});
