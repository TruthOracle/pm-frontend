/**
 * What an operator's wallet signs, and the sentences for what the backend answers:
 *  - R3-06: the decision signature commits to the approval's `paramsHash`; the list's hashes are
 *    recomputed from the params shown (the backend's paramsHashOf), and one that does not match is
 *    refused before any popup (lib/rampAdmin.ts checkApprovalHashes, fetchApprovals);
 *  - R3-05: while the market console waits for a C23 signature, the outcome, source, reason and
 *    attestation picks stay as asked and the box names what is signed (MarketOperatorResolution.tsx);
 *  - the backend's market.resolve failures (this wave): only the wallet's or the ledger's refusal of
 *    a submitted command reads as the wallet's; any other `upstream_failed` (the ledger read before
 *    submitting, the acquirer, the token-app) says nothing was submitted, or the generic sentence;
 *    `ledger_ambiguous` (several active contracts for the market) is no reload matter.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);
globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const admin = await import("../frontend/lib/rampAdmin.ts");
const backendAdmin = await import("../frontend/lib/backendAdmin.ts");
const errors = await import("../frontend/lib/rampAdminErrors.ts");
const { BackendError } = await import("../frontend/lib/backend.ts");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// The backend's paramsHashOf, by hand: sha256 over {action, subjectType, subjectId, params} with keys sorted at every level.
const CANONICAL =
  '{"action":"ramp.order.refund_bank","params":{"bankAccountId":"ba-1","note":{"a":1,"b":[2,{"c":3,"d":4}]}},"subjectId":"ord-1","subjectType":"ramp_order"}';
const HASH = createHash("sha256").update(CANONICAL, "utf8").digest("hex");
const approval = (over = {}) => ({
  id: "ap-good",
  action: "ramp.order.refund_bank",
  subjectType: "ramp_order",
  subjectId: "ord-1",
  params: { note: { b: [2, { d: 4, c: 3 }], a: 1 }, bankAccountId: "ba-1" },
  paramsHash: HASH,
  precondition: null,
  description: null,
  reason: "customer asked",
  status: "pending",
  singleControl: false,
  requestedByPerson: "alice",
  requestedByParty: "op-a::1220aa",
  requestedAt: "2026-10-20T08:00:00.000Z",
  expiresAt: "2026-10-22T20:59:59.000Z",
  error: null,
  ...over,
});

function signerWith(required = true) {
  const calls = [];
  const sign = admin.makeDecisionSigner({
    required,
    walletParty: "op-b::1220bb",
    operatorParty: "op-b::1220bb",
    walletName: "Cantor8",
    signMessage: async (message) => (calls.push(message), "c2ln"),
  });
  return { sign, calls };
}

describe("R3-06: a decision signs only a hash its params give", () => {
  it("refuses, before any popup, an approval whose hash does not commit to the params shown", async () => {
    // Same hash, other params (a backend bug or a tampered answer): the figures shown are not what is committed to.
    const tampered = approval({ id: "ap-tampered", params: { note: { a: 1, b: [2, { c: 3, d: 4 }] }, bankAccountId: "ba-EVIL" } });
    globalThis.fetch = async () => json({ items: [approval(), tampered] });
    const { items } = await backendAdmin.fetchApprovals({ status: "pending" });
    assert.equal(items.length, 2, "both are still listed");
    const { sign, calls } = signerWith();
    assert.equal(await sign(items[0], "approve"), "c2ln");
    assert.deepEqual(calls, [`truthoracle-approval:ap-good:${HASH}:approve`]);
    await assert.rejects(sign(items[1], "approve"), (e) => e instanceof errors.RampAdminError && /does not commit to the parameters shown/.test(e.message));
    await assert.rejects(signerWith(false).sign(items[1], "reject"), errors.RampAdminError, "nor decided unsigned");
    assert.equal(calls.length, 1, "no popup for it");
  });

  it("a hash that matches again (a corrected answer) is signed again", async () => {
    globalThis.fetch = async () => json({ items: [approval({ id: "ap-2", params: { bankAccountId: "x" } })] });
    await backendAdmin.fetchApprovals();
    const { sign } = signerWith();
    await assert.rejects(sign(approval({ id: "ap-2" }), "approve"), errors.RampAdminError);
    globalThis.fetch = async () => json({ items: [approval({ id: "ap-2" })] });
    await backendAdmin.fetchApprovals();
    assert.equal(await sign(approval({ id: "ap-2" }), "approve"), "c2ln");
  });
});

describe("R3-05: the market console's C23 signature signs what it shows", () => {
  it("keeps the outcome, source, reason and picks as asked while it waits, and names what is signed (TSX, pinned)", async () => {
    const tsx = readFileSync(new URL("../frontend/components/market/MarketOperatorResolution.tsx", import.meta.url), "utf8");
    assert.match(tsx, /value=\{reason\} disabled=\{signing !== null\}/, "the reason");
    assert.match(tsx, /type="button"\s+disabled=\{signing !== null\}\s+onClick=\{\(\) => setOutcome\(r\)\}/, "the T0 outcome buttons");
    assert.match(tsx, /<select value=\{sourceUri\} disabled=\{signing !== null\}/, "the source list");
    assert.match(tsx, /value=\{source\} disabled=\{signing !== null\}/, "the free source");
    assert.match(tsx, /disabled=\{!a\.usable \|\| busy !== null \|\| signing !== null\}/, "the attestation picks");
    assert.match(tsx, /You sign: \{resolutionWhat\(signing\.input\)\} on market #\{marketId\}/);
    const { resolutionWhat } = await import("../frontend/lib/marketResolution.ts");
    assert.equal(resolutionWhat({ choice: "ResolveT0", outcome: "Yes", sourceUri: "https://a.example/r" }), "ResolveT0 → Yes from https://a.example/r");
  });
});

describe("market.resolve failures: the wallet's refusal, and everything that is not", () => {
  const err = (status, code, message, details) => new BackendError(status, code, message, details);
  const refusal = (e) => `The treasury wallet did not accept the command: ${e}. The request is closed as failed; reload, and request it again if nothing changed.`;

  it("a single-control request: the ledger's rejection is the wallet's, an unreadable contract says nothing was submitted", async () => {
    const { resolutionErrorMessage } = await import("../frontend/lib/marketResolution.ts");
    const rejected = "the ledger rejected ResolveT0 of market #12: CONTRACT_NOT_ACTIVE";
    assert.equal(resolutionErrorMessage(err(502, "upstream_failed", rejected, { marketId: "12", choice: "ResolveT0", commandId: "c", reason: "CONTRACT_NOT_ACTIVE" })), refusal(rejected));
    assert.equal(
      resolutionErrorMessage(err(502, "upstream_failed", "the ledger could not be read for market #12's contract: fetch failed")),
      "Nothing was submitted: the ledger could not be read for market #12's contract: fetch failed. Try again in a minute; if it keeps failing, the backend's ledger or wallet connection needs looking at.",
    );
    assert.match(resolutionErrorMessage(err(502, "upstream_failed", "Keycloak (wallet) returned no access_token")), /^Nothing was submitted: Keycloak \(wallet\) returned no access_token\./);
    assert.equal(resolutionErrorMessage(err(502, "upstream_failed", "wallet external submit failed (500)")), refusal("wallet external submit failed (500)"));
  });

  it("execution's new refusals: several contracts on the ledger is no reload matter, none is", async () => {
    const { resolutionErrorMessage } = await import("../frontend/lib/marketResolution.ts");
    assert.equal(
      resolutionErrorMessage(err(409, "market_not_resolvable", "market #12 has 2 active contracts on the ledger", { reason: "ledger_ambiguous", contractIds: ["00a", "00b"] })),
      "The market cannot be resolved that way now: market #12 has 2 active contracts on the ledger. The backend will not choose between them, and a reload changes nothing: have an engineer look at the ledger first.",
    );
    assert.match(resolutionErrorMessage(err(409, "market_not_resolvable", "market #12 has no active contract on the ledger", { reason: "not_on_ledger" })), /on the ledger\. Reload the market\.$/);
  });

  it("an approved request that failed: only the wallet's or the ledger's refusal is the wallet's sentence", () => {
    const failed = (rest) => err(409, "approval_failed", `the approved action failed: ${rest}`, { approvalId: "a", cause: "upstream_failed" });
    for (const rest of ["the ledger could not be read for market #12's contract: fetch failed", "the acquirer could not open the payment", "token-app holdings: no holdings list / total"])
      assert.equal(errors.rampAdminErrorMessage(failed(rest)), `The approved action ran and failed: ${rest}. Nothing was half-applied; the approval shows the error.`, rest);
    assert.equal(errors.rampAdminErrorMessage(failed("the ledger rejected Resolve of market #12: CONTRACT_NOT_ACTIVE")), refusal("the ledger rejected Resolve of market #12: CONTRACT_NOT_ACTIVE"));
    assert.equal(errors.isWalletRefusal("the ledger rejected Resolve of market #12: x"), true);
  });
});
