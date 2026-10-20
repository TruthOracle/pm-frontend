/**
 * Pure helpers of the ramp operator console (components/Admin/Ramp*.tsx, Compliance*.tsx): the
 * signed approval message and who may decide an approval, the signed single-control requests
 * (C23), the §4.2 actions an order offers, exact money labels, file encoding for the imports,
 * export ranges, alert due states and decisions, screening matches, consent declarations, the KYC
 * override and the webhook events console. No React, so test/ramp-admin*.test.mjs cover it
 * directly. The backend decides everything for real; these only keep the console from offering
 * what it would refuse.
 */
import type { Money } from "@/auth/types";
import { BackendError } from "@/lib/backend";
import { RampAdminError } from "@/lib/rampAdminErrors";
import { fromUnits, toUnits } from "@/lib/rampLogic";
import { formatDateTimeUTC } from "@/lib/time";
import type {
  AdminRole,
  AlertDecision,
  AlertStatus,
  ApiAdminRampOrder,
  ApiAdminSession,
  ApiApproval,
  ApiApprovalOutcome,
  ApiComplianceAlert,
  ApiConsentDeclaration,
  ApiKycOverrideAnswer,
  ApiRampEvent,
  ApiScreeningHit,
  ApprovalDecision,
  ApprovalStatus,
  BatchStatus,
  RampDirection,
  RampOrderAction,
  ReconStatus,
} from "@/lib/rampAdminTypes";

/** The console's pill tones (components/Account/accountUi.tsx `PillTone`). */
export type Tone = "neutral" | "pending" | "ok" | "warn" | "bad" | "info";

// ── approvals (§6.5) ──

/** What the operator's wallet signs for a decision; the backend verifies it like the admin sign-in. */
export function approvalMessage(approval: Pick<ApiApproval, "id" | "paramsHash">, decision: ApprovalDecision): string {
  return `truthoracle-approval:${approval.id}:${approval.paramsHash}:${decision}`;
}

/** Signs a decision; undefined when the backend runs without decision signatures (dev). */
export type DecisionSigner = (
  approval: Pick<ApiApproval, "id" | "paramsHash">,
  decision: ApprovalDecision,
) => Promise<string | undefined>;

/** `<id>:<paramsHash>` of each listed approval whose hash is not the one its params give (R3-06). */
const PARAMS_HASH_MISMATCHES = new Set<string>();

/**
 * Recomputes each listed approval's hash from the params the console shows (the backend's
 * paramsHashOf: sha256 of the canonical {action, subjectType, subjectId, params}) as the list
 * loads, since a click may await nothing in front of the wallet popup. The decision signer then
 * refuses, before any popup, an approval whose hash commits to anything else (review R3-06).
 * Without Web Crypto nothing is checked, as before.
 */
export async function checkApprovalHashes(
  approvals: readonly Pick<ApiApproval, "id" | "action" | "subjectType" | "subjectId" | "params" | "paramsHash">[],
): Promise<void> {
  for (const { id, action, subjectType, subjectId, params, paramsHash } of approvals) {
    const hash = await sha256Hex(canonicalJson({ action, subjectType, subjectId, params })).catch(() => null);
    if (hash === null) continue;
    if (hash === paramsHash) PARAMS_HASH_MISMATCHES.delete(`${id}:${paramsHash}`);
    else PARAMS_HASH_MISMATCHES.add(`${id}:${paramsHash}`);
  }
}

/**
 * The console's decision signer over the wallet's `signMessage` (the admin sign-in's path). Only
 * synchronous checks run before `signMessage`, so inside a click it opens the popup first; a wallet
 * on another party than the backend session, or an approval whose hash does not commit to its
 * params, is refused before any popup.
 */
export function makeDecisionSigner(args: {
  required: boolean;
  walletParty: string | null | undefined;
  operatorParty: string | null;
  walletName: string;
  signMessage: (message: string, partyId?: string) => Promise<string>;
}): DecisionSigner {
  const sign = makeMessageSigner(args);
  return async (approval, decision) => {
    if (PARAMS_HASH_MISMATCHES.has(`${approval.id}:${approval.paramsHash}`))
      throw new RampAdminError(
        "This approval's hash does not commit to the parameters shown, so the console decides nothing on it. Reload Approvals; if it stays, report it.",
      );
    return args.required ? sign(approvalMessage(approval, decision)) : undefined;
  };
}

/** Signs one exact message with the operator's wallet (the admin sign-in's `signMessage` path). */
export type MessageSigner = (message: string) => Promise<string>;

/**
 * The console's message signer. Its refusals (no wallet; a wallet on another party than the
 * backend session) are synchronous, so inside a click `signMessage` is still the first await and
 * opens the click's one popup.
 */
export function makeMessageSigner(args: {
  walletParty: string | null | undefined;
  operatorParty: string | null;
  walletName: string;
  signMessage: (message: string, partyId?: string) => Promise<string>;
}): MessageSigner {
  return async (message) => {
    if (!args.walletParty)
      throw new RampAdminError(`Connect your ${args.walletName} wallet first: approval decisions are signed with it.`);
    if (args.operatorParty && args.walletParty !== args.operatorParty) {
      throw new RampAdminError(
        "The connected wallet is not the party signed in to the backend. Switch wallets, or sign in again.",
      );
    }
    const signature = await args.signMessage(message, args.walletParty);
    if (!signature) throw new RampAdminError("The wallet returned an empty signature.");
    return signature;
  };
}

// ── signed single-control requests (C23) ──

/** The request a releasing single-control decision signs over (the approval registry's terms). */
export interface SignedRequest {
  action: string;
  subjectType: string;
  subjectId: string;
  /** Exactly the params the backend normalises the body to (they are hashed into the message). */
  params: Record<string, unknown>;
}

/** The backend's canonical JSON (admin-approval.logic.ts): keys sorted at every level, undefined dropped. */
export function canonicalJson(value: unknown): string {
  const normalise = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalise);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        const item = (v as Record<string, unknown>)[key];
        if (item !== undefined) out[key] = normalise(item);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(normalise(value));
}

async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new RampAdminError(
      "This browser cannot check a decision before signing it (no Web Crypto). Open the console over https.",
    );
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Why the console will not sign `message` for this request, or null. It must be the backend's
 * `truthoracle-approval:request:<action>:<subjectId>:<paramsHash>:<state>` for exactly this
 * action and subject, and its params hash must be the one recomputed here from the decision the
 * operator chose — so the wallet never signs anything else (a sign-in challenge, another decision).
 */
export async function requestMessageProblem(message: string, request: SignedRequest): Promise<string | null> {
  const prefix = `truthoracle-approval:request:${request.action}:${request.subjectId}:`;
  const m = message.startsWith(prefix) ? /^([0-9a-f]{64}):([0-9a-f]{64})$/.exec(message.slice(prefix.length)) : null;
  if (!m)
    return "The backend asked for a signature over something that is not this decision; nothing was signed. Reload and decide again.";
  const { action, subjectType, subjectId, params } = request;
  if (m[1] !== (await sha256Hex(canonicalJson({ action, subjectType, subjectId, params }))))
    return "The message to sign does not commit to the decision you chose; nothing was signed. Reload and decide again.";
  return null;
}

/** The first click's answer when the backend wants the request signed (it saved nothing). */
export interface SignatureStep {
  signatureMessage: string;
}

export function isSignatureStep(value: unknown): value is SignatureStep {
  return Boolean(value && typeof value === "object" && typeof (value as SignatureStep).signatureMessage === "string");
}

/**
 * C23 step 1, the Decide click: the request goes out unsigned. With signatures off, for a decision
 * that releases nothing, or a four-eyes one, that is the answer. With signatures on, a releasing
 * single-control decision answers 400 `approval_signature_required` with the exact message and
 * saves nothing: it comes back as `{signatureMessage}` (checked by `requestMessageProblem`) and the
 * console asks for a second click. Any other error is rethrown.
 */
export async function sendDecisionUnsigned<R>(
  send: (signature?: string) => Promise<R>,
  request: SignedRequest,
): Promise<R | SignatureStep> {
  try {
    return await send();
  } catch (e) {
    const details =
      e instanceof BackendError && e.details && typeof e.details === "object"
        ? (e.details as Record<string, unknown>)
        : null;
    if (
      !(e instanceof BackendError) ||
      e.status !== 400 ||
      e.code !== "approval_signature_required" ||
      typeof details?.message !== "string"
    )
      throw e;
    const problem = await requestMessageProblem(details.message, request);
    if (problem) throw new RampAdminError(problem);
    return { signatureMessage: details.message };
  }
}

/**
 * C23 step 2, the "Sign and decide" click: the wallet signs FIRST — that click's one popup — and
 * the same request is resent with the signature. A 401 `approval_signature_invalid` means another
 * key signed, or the subject changed since step 1 (the message commits to its state): decide again.
 */
export async function sendDecisionSigned<R>(
  send: (signature?: string) => Promise<R>,
  message: string,
  sign: MessageSigner,
): Promise<R> {
  const signature = await sign(message);
  return send(signature);
}

/** Roles unknown (a backend without `GET /admin/session`) → every control shows and the backend refuses. */
export function hasRole(session: ApiAdminSession | null, role: AdminRole): boolean {
  return session === null || session.roles.includes(role);
}

/** "Needs the ops role." when the session lacks it; null otherwise. */
export function roleHint(session: ApiAdminSession | null, role: AdminRole): string | null {
  return hasRole(session, role) ? null : `Needs the ${role} role.`;
}

/** The same person (or, without person ids, the same party) asked for it: they may cancel it, never approve it. */
export function isOwnRequest(
  approval: ApiApproval,
  session: ApiAdminSession | null,
  operatorParty: string | null,
): boolean {
  if (session?.personId && approval.requestedByPerson) return approval.requestedByPerson === session.personId;
  const party = session?.party ?? operatorParty;
  return Boolean(party) && approval.requestedByParty === party;
}

/**
 * The role that approves an action (the backend's registry): `approver` for every four-eyes
 * request — compliance decisions and freeze lifts included — and `aml` for the screening hit
 * decision (single control, so it is normally executed at request).
 */
export function approveRoleFor(action: string): AdminRole {
  return action === "compliance.hit.decide" ? "aml" : "approver";
}

export function isExpired(approval: Pick<ApiApproval, "expiresAt">, now = Date.now()): boolean {
  if (!approval.expiresAt) return false;
  const at = Date.parse(approval.expiresAt);
  return Number.isFinite(at) && at <= now;
}

/** Why this operator may not approve it (the button's tooltip), or null when they may. */
export function approveBlocker(
  approval: ApiApproval,
  session: ApiAdminSession | null,
  operatorParty: string | null,
  now = Date.now(),
): string | null {
  if (approval.status !== "pending") return `This approval is ${approval.status}.`;
  if (isExpired(approval, now)) return "This approval has expired; request it again.";
  if (isOwnRequest(approval, session, operatorParty)) return "You requested this; a second person must approve it.";
  const role = approveRoleFor(approval.action);
  if (!hasRole(session, role)) return `Needs the ${role} role.`;
  return null;
}

/** The confirm button of a decision: the requester withdraws their own request, anyone else rejects it. */
export function rejectLabel(
  approval: ApiApproval,
  session: ApiAdminSession | null,
  operatorParty: string | null,
): string {
  return isOwnRequest(approval, session, operatorParty) ? "Withdraw request" : "Reject";
}

export function approvalTone(status: ApprovalStatus): Tone {
  switch (status) {
    case "pending":
      return "pending";
    case "executed":
    case "approved":
      return "ok";
    case "failed":
      return "bad";
    case "rejected":
    case "expired":
    case "cancelled":
      return "neutral";
  }
}

/** One sentence for what an approval-backed route answered (202 pending vs 200 executed). */
export function outcomeSentence(what: string, outcome: Pick<ApiApprovalOutcome, "approval">): string {
  const a = outcome.approval;
  const ref = a.id.slice(0, 8);
  switch (a.status) {
    case "executed":
      return `${what}: done (approval ${ref}${a.singleControl ? ", single control" : ""}).`;
    case "pending":
      return `${what}: approval ${ref} requested. A second person with the ${approveRoleFor(a.action)} role must approve it under Approvals.`;
    case "approved":
      return `${what}: approved (approval ${ref}); executing.`;
    case "failed":
      return `${what}: approval ${ref} failed${a.error ? `: ${a.error}` : "."}`;
    default:
      return `${what}: approval ${ref} is ${a.status}.`;
  }
}

// ── order actions (§4.2) ──

export interface RampActionInfo {
  action: RampOrderAction;
  label: string;
  /** The §4.2 "allowed when", for the operator; the backend re-checks it with fresh reads. */
  when: string;
  destructive?: boolean;
  params?: "bankAccount" | "then";
}

export const RAMP_ACTIONS: Record<RampOrderAction, RampActionInfo> = {
  retry: {
    action: "retry",
    label: "Retry",
    when: "Resumes the step the order left (review from); its entry conditions must hold now.",
  },
  refund: {
    action: "refund",
    label: "Refund to the payer",
    when: "Nothing was minted (or the mint definitively failed), the user is not frozen and the provider can refund the method.",
    destructive: true,
  },
  refund_bank: {
    action: "refund_bank",
    label: "Refund by bank transfer",
    when: "As refund, to an active, proved bank account of the same user (queued for the next payout batch).",
    destructive: true,
    params: "bankAccount",
  },
  reverse: {
    action: "reverse",
    label: "Reverse (re-mint and credit back)",
    when: "Burn recorded and the fiat provably not paid: card parts definitively unpaid, or never in an exported batch, a matched return, or bank unpaid proved.",
    destructive: true,
  },
  reverse_remainder: {
    action: "reverse_remainder",
    label: "Reverse the unpaid remainder",
    when: "Card cash-out paid by refunds, in payout review: some parts paid, the rest definitively failed.",
    destructive: true,
  },
  credit_back: {
    action: "credit_back",
    label: "Credit back from treasury",
    when: "Withdrawal or burn step; the ledger proves MarkPaid archived the PendingPayout and the burn never landed.",
    destructive: true,
  },
  fail: {
    action: "fail",
    label: "Fail the order",
    when: "On-ramp: the provider shows no capture or returned the money itself. Off-ramp: the PendingPayout is live or was cancelled by the user.",
    destructive: true,
  },
  burn_uncredited: {
    action: "burn_uncredited",
    label: "Burn the uncredited mint",
    when: "A chargeback arrived after a recorded mint that was never credited.",
    destructive: true,
  },
  bank_unpaid: {
    action: "bank_unpaid",
    label: "Bank: unpaid",
    when: "Payout review of an order in a submitted batch (aging moves an unpaid payout_sent there); confirmed statements cover every business day to submission + settle days with no debit and no return for it. Reverse only for a cash-out with a recorded burn.",
    destructive: true,
    params: "then",
  },
  refund_cancel: {
    action: "refund_cancel",
    label: "Cancel the bank refund (chargeback)",
    when: "On-ramp in review whose payment a chargeback returned while its bank refund was owed: the bank does not have the refund (no approved, exported or submitted batch holds it) and no statement shows it paid. onramp.refund_cancelled nets it against the chargeback receivable; the order closes as chargeback.",
    destructive: true,
  },
};

/**
 * The actions the console offers for an order; the backend validates every one with fresh reads.
 * `bank_unpaid` needs payout review (a sent bank payout gets there by aging after the settle
 * days), on a cash-out or an on-ramp's bank refund alike; `reverse_remainder` is a card
 * cash-out's, in payout review.
 */
export function rampOrderActions(
  order: Pick<ApiAdminRampOrder, "direction" | "status" | "reviewStep" | "rail"> & Partial<Pick<ApiAdminRampOrder, "details">>,
): RampActionInfo[] {
  const pick = (...actions: RampOrderAction[]) => actions.map((a) => RAMP_ACTIONS[a]);
  if (order.status === "chargeback") return order.direction === "onramp" ? pick("burn_uncredited") : [];
  if (order.status !== "needs_review") return [];
  const payoutReview = order.reviewStep === "payout";
  if (order.direction === "onramp") {
    const actions: RampOrderAction[] = ["retry", "refund", "refund_bank"];
    if (payoutReview) actions.push("bank_unpaid");
    // C19: a chargeback returned the payment while its bank refund was owed (the backend checks the rest).
    const chargeback = order.details?.chargeback;
    if (chargeback && typeof chargeback === "object" && (chargeback as { state?: unknown }).state === "charged_back")
      actions.push("refund_cancel");
    actions.push("fail");
    return pick(...actions);
  }
  const actions: RampOrderAction[] = ["retry", "reverse"];
  if (order.rail === "card" && payoutReview) actions.push("reverse_remainder");
  if (order.reviewStep === "withdrawal" || order.reviewStep === "burn") actions.push("credit_back");
  if (order.rail === "bank" && payoutReview) actions.push("bank_unpaid");
  actions.push("fail");
  return pick(...actions);
}

export function rampStatusTone(status: string): Tone {
  if (status === "completed") return "ok";
  if (status === "needs_review" || status === "chargeback") return "bad";
  if (["failed", "expired", "cancelled", "refunded"].includes(status)) return "neutral";
  return "pending";
}

// ── exact money labels ──

/**
 * A wire decimal shown exactly: thousands separators, at least `decimals` places, and never a
 * digit dropped (a value finer than `decimals` keeps its extra digits). String work only — a
 * confirm dialog's figure must be the one the backend acts on, not a float's rounding of it.
 */
export function exactMoney(value: Money | null | undefined, decimals: number, unit?: string): string {
  const raw = String(value ?? "").trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!raw || !m || (m[2] === "" && (m[3] ?? "") === "")) return unit ? `— ${unit}` : "—";
  const sign = m[1] === "-" && /[1-9]/.test(raw) ? "-" : "";
  const int = (m[2].replace(/^0+(?=\d)/, "") || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = (m[3] ?? "").replace(/0+$/, "");
  if (frac.length < decimals) frac = frac.padEnd(decimals, "0");
  const text = `${sign}${int}${frac ? `.${frac}` : ""}`;
  return unit ? `${text} ${unit}` : text;
}

/** BYN (any fiat) to the kopeck: `1,234.50 BYN`. */
export function fiatLabel(value: Money | null | undefined, currency = "BYN"): string {
  return exactMoney(value, 2, currency);
}

type FigureOrder = Pick<
  ApiAdminRampOrder,
  "direction" | "fiatAmount" | "fiatCurrency" | "tokenAmount" | "instrument" | "capturedAmount" | "refundedAmount" | "details"
> &
  Partial<Pick<ApiAdminRampOrder, "reviewStep">>;

/** A review step's status when `details.reviewFrom` is missing (backend ramp-actions STEP_STATUS). */
const STEP_STATUS: Record<string, string> = {
  payment: "paid",
  mint: "minting",
  credit: "crediting",
  withdrawal: "withdrawing",
  burn: "burning",
  payout: "paying_out",
  refund: "refunding",
  reversal: "reversing",
  compliance: "paid",
};
/** A capture seen under review from these re-reads at `paid` (backend CAPTURE_REVIEW_FROM). */
const CAPTURE_REVIEW_FROM: readonly string[] = ["awaiting_payment", "failed", "expired", "cancelled"];

/**
 * Where a retry resumes, as the backend's validateRetry and its approval description say (F2 /
 * F8): a capture under review (a payment review, or an on-ramp's compliance review from before
 * the money moved) re-reads at `paid`; anything else resumes at `reviewFrom`, else at its step.
 */
export function retryTarget(order: {
  direction: RampDirection;
  reviewStep?: string | null;
  details?: Record<string, unknown> | null;
}): string {
  const from = typeof order.details?.reviewFrom === "string" && order.details.reviewFrom ? order.details.reviewFrom : null;
  const step = order.reviewStep ?? null;
  const capture =
    step === "payment" || (step === "compliance" && order.direction === "onramp" && (from === null || CAPTURE_REVIEW_FROM.includes(from)));
  if (capture) return "paid";
  return from ?? (step ? (STEP_STATUS[step] ?? "the step it left") : "the step it left");
}

/**
 * The exact figure an order action moves, for its confirm dialog and for the approver (§4.2): the
 * amount the backend itself computes, not the order's quote. A card refund sends captured −
 * refunded (refundStep); a bank refund and an on-ramp's bank payout move the capture
 * (`bankAmountOf`: captured, else the order's fiat); a cash-out's bank payout its fiat amount.
 */
export function rampActionFigure(
  action: RampOrderAction,
  order: FigureOrder,
  opts: { then?: "requeue" | "reverse"; bankAccountId?: string } = {},
): string {
  const fiat = (v: Money) => fiatLabel(v, order.fiatCurrency);
  const token = exactMoney(order.tokenAmount, order.instrument.decimals, order.instrument.symbol);
  const captured = order.capturedAmount;
  switch (action) {
    case "refund": {
      if (captured == null)
        return "No capture is recorded on the order yet: the provider's captured amount, read at execution, goes back to the payer.";
      const left = (toUnits(captured) ?? 0n) - (toUnits(order.refundedAmount) ?? 0n);
      if (left <= 0n) return `Nothing is left to refund: ${fiat(captured)} captured, ${fiat(order.refundedAmount)} already refunded.`;
      const of = moneyIsZero(order.refundedAmount) ? "the whole capture" : `${fiat(captured)} captured − ${fiat(order.refundedAmount)} refunded`;
      return `${fiat(fromUnits(left))} (${of}) goes back to the payer through the provider.`;
    }
    case "refund_bank":
      return captured == null
        ? "No capture is recorded on the order, so the backend refuses a refund by bank."
        : `${fiat(captured)} (the capture) is queued as a bank transfer to the user's proved account ${opts.bankAccountId?.trim() || "?"}.`;
    case "reverse":
      return `${token} is re-minted and credited back to the user's in-app balance.`;
    case "reverse_remainder":
      return `The unpaid remainder of ${token} is re-minted and credited back.`;
    case "credit_back":
      return `${token} is deposited back to the user from treasury holdings (no mint).`;
    case "burn_uncredited":
      return `${token} minted for this order is burned.`;
    case "bank_unpaid": {
      const paid = order.direction === "offramp" ? order.fiatAmount : (captured ?? order.fiatAmount);
      return `The ${fiat(paid)} bank payout is recorded as unpaid, then ${opts.then === "reverse" ? "reversed (re-mint and credit back)" : "re-queued for the next batch"}.`;
    }
    case "fail":
      return "The order is closed as failed; no money moves.";
    case "retry":
      return `The order resumes at ${retryTarget(order)}.`;
    case "refund_cancel":
      return `The ${fiat(captured ?? order.fiatAmount)} bank refund the order owes is cancelled (a chargeback already returned the payment): onramp.refund_cancelled nets it against the chargeback receivable and the order closes as chargeback. Nothing is paid.`;
  }
}

function moneyIsZero(value: Money | null | undefined): boolean {
  return !/[1-9]/.test(String(value ?? ""));
}

// ── file imports (statements, screening lists) ──

/** The backend refuses more than 5 MB decoded (§8 "Files"); base64 in JSON stays under the relay's 8 MB route cap. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/** Why a picked file cannot be imported, or null. */
export function importFileProblem(file: { size: number; name: string } | null): string | null {
  if (!file) return "Choose a file first.";
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_IMPORT_FILE_BYTES) return `${file.name} is larger than 5 MB; ask the bank for a shorter period.`;
  return null;
}

/** camt.053 for XML, CSV otherwise (the bank's own CSV with the #account/#period/#opening/#closing rows). */
export function statementFormatFor(fileName: string): "camt053" | "csv" {
  return /\.xml$/i.test(fileName.trim()) ? "camt053" : "csv";
}

/** Standard base64 of raw bytes, in chunks so a 5 MB file never overflows `String.fromCharCode`'s argument list. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The file as uploaded: its exact bytes base64-encoded; the backend decodes (and charset-checks) it. */
export async function fileToBase64(file: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

// ── export ranges ──

export const MAX_EXPORT_DAYS = 31;
const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` (a date input) as the UTC instant its day starts; null when not a real date. */
export function utcDayStart(date: string): string | null {
  const m = DATE_RE.exec(date.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3]))
    return null;
  return d.toISOString();
}

/** The UTC instants an export of whole days `from`..`to` (inclusive) asks for, or the sentence why not. */
export function exportRange(from: string, to: string): { from: string; to: string } | { problem: string } {
  const start = utcDayStart(from);
  const endDay = utcDayStart(to);
  if (!start || !endDay) return { problem: "Pick both days." };
  const end = new Date(Date.parse(endDay) + DAY_MS - 1).toISOString();
  if (Date.parse(end) < Date.parse(start)) return { problem: "The end day is before the start day." };
  if (Date.parse(end) - Date.parse(start) + 1 > MAX_EXPORT_DAYS * DAY_MS)
    return { problem: `An export covers at most ${MAX_EXPORT_DAYS} days.` };
  return { from: start, to: end };
}

// ── compliance alerts ──

export type DueState = "overdue" | "soon" | "ok" | "none";
const OPEN_ALERT: readonly AlertStatus[] = ["open", "escalated"];

/** Overdue past `dueAt`, "soon" within 2 h of it (the recon check's amber), for alerts still awaiting a decision. */
export function alertDueState(alert: Pick<ApiComplianceAlert, "dueAt" | "status">, now = Date.now()): DueState {
  if (!OPEN_ALERT.includes(alert.status) || !alert.dueAt) return "none";
  const due = Date.parse(alert.dueAt);
  if (!Number.isFinite(due)) return "none";
  if (due <= now) return "overdue";
  return due - now <= 2 * 3_600_000 ? "soon" : "ok";
}

/**
 * The decisions an alert can take (the backend's table; anything else is 409
 * `compliance_alert_state`): open → any; escalated → clear, report or return; reported → clear or
 * return, the hold stays until then; cleared and returned are final. `return` (C25) gives a held
 * payment back, so only an alert that holds an order (review or block severity) offers it.
 */
export function alertDecisions(alert: Pick<ApiComplianceAlert, "status" | "orderId" | "severity">): AlertDecision[] {
  const canReturn = Boolean(alert.orderId) && alert.severity !== "info";
  const next: AlertDecision[] = (() => {
    switch (alert.status) {
      case "open":
        return ["clear", "escalate", "report", "return"];
      case "escalated":
        return ["clear", "report", "return"];
      case "reported":
        return ["clear", "return"];
      default:
        return [];
    }
  })();
  return canReturn ? next : next.filter((d) => d !== "return");
}

/** Why this alert cannot take `decision` (the button's tooltip), or null when it can. */
export function alertDecisionBlocker(
  alert: Pick<ApiComplianceAlert, "status" | "orderId" | "severity">,
  decision: AlertDecision,
): string | null {
  const allowed = alertDecisions(alert);
  if (allowed.includes(decision)) return null;
  if (allowed.length === 0) return `This alert is ${alert.status}: that decision is final.`;
  if (decision === "return")
    return "Only an alert that holds an order's payment (review or block severity) can return it.";
  return `A ${alert.status} alert can only be: ${allowed.join(", ")}.`;
}

/** The alert's status pill: waiting ones pending, a filed report still holding (warn), decided ones neutral. */
export function alertStatusTone(status: AlertStatus): Tone {
  if (OPEN_ALERT.includes(status)) return "pending";
  if (status === "reported") return "warn";
  return "neutral";
}

/** Clear and return end a hold: with signatures on, a single-control one carries the officer's wallet signature (C23). */
export function alertDecisionReleases(decision: AlertDecision): boolean {
  return decision === "clear" || decision === "return";
}

/**
 * The decisions a screening hit can take: an open hit is confirmed or cleared; a CONFIRMED
 * foreign-list hit may still be cleared (it froze nothing, but it denies new orders); a decided
 * Belarusian / UN / Decree 48 hit only ends with the four-eyes freeze lift.
 */
export function screeningHitDecisions(hit: Pick<ApiScreeningHit, "status" | "list">): ("confirm" | "clear")[] {
  if (hit.status === "open") return ["confirm", "clear"];
  if (hit.status === "confirmed" && hit.list === "foreign") return ["clear"];
  return [];
}

/** Undecided alerts first, earliest legal due date first (no due date last); decided ones after, newest first. */
export function sortAlertsByDue<T extends Pick<ApiComplianceAlert, "dueAt" | "status" | "createdAt">>(
  alerts: readonly T[],
): T[] {
  const due = (a: T) =>
    a.dueAt && Number.isFinite(Date.parse(a.dueAt)) ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
  return [...alerts].sort((a, b) => {
    const aOpen = OPEN_ALERT.includes(a.status) ? 0 : 1;
    const bOpen = OPEN_ALERT.includes(b.status) ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    if (aOpen === 0) return due(a) - due(b);
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

// ── reconciliation and batches ──

export function reconTone(status: ReconStatus | null | undefined): Tone {
  if (status === "green") return "ok";
  if (status === "amber") return "warn";
  if (status === "red") return "bad";
  return "pending";
}

/** What each reconciliation check asserts (§6.2), for the console's tooltip. */
export const RECON_CHECKS: Record<string, string> = {
  journal_balanced: "Every journal entry sums to zero.",
  token_records_known: "Every token-app record of the ramp instrument has a command row (I9).",
  token_commands_consistent: "No mismatched command, none recorded twice.",
  token_commands_confirmed: "No command unresolved past the confirm window.",
  issuance_matches_liability: "Customer liability equals the recorded net issuance of the ramp.",
  supply_matches_issuance: "token-app total supply is not above our recorded net issuance.",
  reserve_covers_liabilities: "Client assets cover client liabilities on a fresh confirmed statement.",
  treasury_covers_in_app: "Treasury holdings cover in-app balances, live payouts and collateral.",
  bank_statement_matches_journal: "Confirmed statements and the safeguard postings agree; the chain is unbroken.",
  bank_payout_duplicate: "No reference was debited twice.",
  bank_iban_mismatch: "No payout debit went to another IBAN.",
  provider_clearing_aging: "Captures older than the PSP settle days are settled.",
  operator_money_unswept: "Operator money in the client account is swept within a business day.",
  events_dead: "No dead webhook event (red for a chargeback).",
  no_stuck_orders: "No order sits in a status past its expected time.",
  compliance_alerts_overdue: "No compliance alert is past its legal due date.",
  compliance_bv_table: "A base value (BV) is configured for the current Minsk year.",
  screening_stale: "Lists imported and identities re-screened recently.",
  token_sync_other_instruments:
    "The last token sync read every other instrument in full (amber names the failing ones; never halts or pages).",
};

/** Known reserve figures first, labelled; any other key the backend adds after, as is. */
export const RESERVE_LABELS: Record<string, string> = {
  assets: "Client assets (safeguard bank + provider clearing)",
  liabilities: "Client liabilities",
  headroom: "Headroom",
  safeguardBank: "Safeguard bank (journal)",
  unbookedDebits: "Unbooked bank debits (already taken off assets)",
  providerClearing: "Provider clearing",
  issuancePending: "Issuance pending",
  customerLiability: "Customer liability (cBYN issued)",
  payoutClearing: "Payout clearing",
  bankSuspense: "Bank suspense",
  recordedSupply: "Recorded net issuance (ramp token)",
  unresolvedNonRampMints: "Unresolved non-ramp mints",
  statementClosing: "Latest confirmed statement: closing",
  statementPeriodTo: "Latest confirmed statement: period end",
  statementFresh: "Latest confirmed statement is fresh",
  gate: "Reserve gate",
  tolerance: "Tolerance",
};

export function reserveRows(
  reserve: Record<string, unknown> | null | undefined,
): { key: string; label: string; value: string }[] {
  if (!reserve) return [];
  const keys = [
    ...Object.keys(RESERVE_LABELS).filter((k) => k in reserve),
    ...Object.keys(reserve).filter((k) => !(k in RESERVE_LABELS)),
  ];
  return keys.map((key) => ({
    key,
    label: RESERVE_LABELS[key] ?? key,
    value: reserve[key] === null || reserve[key] === undefined ? "—" : String(reserve[key]),
  }));
}

// ── payouts ──

/** The backend's rule for an out-of-band payment reference (`payout.mark_paid` `txHash`). */
const TX_REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,255}$/;

/**
 * Why a Mark-paid reference would be refused (400 `validation_failed`), or null: 1–256 of letters,
 * digits and `: _ . / -`, starting with a letter or digit, and never `ramp:…` (the ramp's own
 * MarkPaid marker, which would make the payment read as a cash-out's).
 */
export function markPaidReferenceProblem(reference: string): string | null {
  const ref = reference.trim();
  if (!ref) return "Enter the transfer reference first.";
  if (ref.toLowerCase().startsWith("ramp:"))
    return "A ramp: reference belongs to the ramp's own payouts; enter the external payment's reference.";
  if (!TX_REFERENCE_RE.test(ref))
    return "Use up to 256 letters, digits and : _ . / - (starting with a letter or digit).";
  return null;
}

/** Which batch buttons apply in a status (§10.3); the backend re-checks every one. */
export function batchActions(status: BatchStatus): {
  approve: boolean;
  export: boolean;
  submitted: boolean;
  cancel: boolean;
  void: boolean;
} {
  return {
    approve: status === "draft",
    export: status === "approved" || status === "exported",
    submitted: status === "exported",
    cancel: status === "draft" || status === "approved",
    void: status === "exported",
  };
}

// ── screening hits ──

const MATCH_VIA: Record<"fold" | "bridge" | "surname_dob", string> = {
  fold: "the exact name form",
  bridge: "a be / ru / Latin bridged form (check the spelling)",
  surname_dob: "the surname and exact birth date only (a candidate: compare the given names)",
};

/** What a hit matched, in one line: the list's entry and how the account's verified data (or declared principal) met it. */
export function screeningMatchLine(hit: Pick<ApiScreeningHit, "match">): string {
  const m = hit.match;
  if (m.basis === "party") return `party ${m.party} listed as ${m.listed}`;
  const born = m.entryBirthDate ? `, born ${m.entryBirthDate}` : "";
  const ids = m.entryIds.length ? ` · ids ${m.entryIds.join(", ")}` : "";
  if (m.basis === "principal")
    return `"${m.entryName}"${born} · matched the principal the account declares it acts for (consent ${m.consentId.slice(0, 8)})${ids}`;
  return `"${m.entryName}"${born} · matched the ${m.script} name form by ${MATCH_VIA[m.via ?? "fold"]} · birth date ${m.birthDate}${ids}`;
}

// ── consent declarations (C13) ──

/** The declaration an AML officer opened, as lines (UTC); the read is audited and never kept. */
export function declarationLines(d: ApiConsentDeclaration): string[] {
  const lines = [
    `Terms ${d.termsVersion}, accepted ${formatDateTimeUTC(d.acceptedAt) || d.acceptedAt} (consent ${d.consentId.slice(0, 8)})`,
  ];
  if (d.rule === "TM-PRINCIPAL")
    lines.push(d.actsForSelf ? "Declared acting for themselves." : `Acts for: ${d.principal?.trim() || "(not given)"}`);
  if (d.rule === "TM-PEP")
    lines.push(d.pepDeclared ? `Declared a PEP: ${d.pepDetail?.trim() || "(no detail given)"}` : "Declared not a PEP.");
  return lines;
}

/** The alerts whose evidence is a consent declaration (`GET …/alerts/:id/declaration`). */
export function alertHasDeclaration(alert: Pick<ApiComplianceAlert, "rule">): boolean {
  return alert.rule === "TM-PRINCIPAL" || alert.rule === "TM-PEP";
}

// ── KYC override (C22) ──

/** What `POST /admin/users/:id/kyc/override` answered, in one sentence. */
export function kycOverrideSentence(answer: ApiKycOverrideAnswer): string {
  if (answer.approval && answer.approval.status !== "executed")
    return outcomeSentence("KYC approval", { approval: answer.approval });
  if (answer.verification)
    return `KYC set to ${answer.verification.status} by hand (verification ${answer.verification.id.slice(0, 8)}).`;
  return answer.approval ? outcomeSentence("KYC approval", { approval: answer.approval }) : "KYC override: done.";
}

// ── webhook events (C31) ──

export type RampEventState = "dead" | "retrying" | "processed";

/** Applied, dead (nothing retries it) or still backing off. */
export function rampEventState(e: Pick<ApiRampEvent, "deadAt" | "processedAt">): RampEventState {
  if (e.processedAt) return "processed";
  return e.deadAt ? "dead" : "retrying";
}

export function rampEventTone(state: RampEventState): Tone {
  return state === "dead" ? "bad" : state === "retrying" ? "pending" : "ok";
}

/**
 * What the console offers on an event: an unapplied one can be replayed (re-armed; the processor
 * re-reads the payment or payout from the provider, so a purged payload does not matter) or
 * closed by hand (four-eyes, once its effects are applied by hand or it applies to nothing). The
 * backend re-checks both.
 */
export function rampEventActions(e: Pick<ApiRampEvent, "processedAt">): { replay: boolean; close: boolean } {
  const open = !e.processedAt;
  return { replay: open, close: open };
}
