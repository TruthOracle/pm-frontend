/**
 * Market resolution through the accounts backend (review F0). ResolveT0, Resolve (from
 * attestations) and VoidMarket are the four-eyes `market.resolve` approval: the subject is the
 * market id (a trade re-creates the contract), `ops` asks, a second person with `approver`
 * approves, and the backend submits the choice through the Enterprise Wallet with its own clock.
 * Nothing in the browser signs as the treasury any more.
 *
 *   GET  /api/v1/admin/markets/:marketId/resolution            (role ops or approver)
 *        → {market, windows: {resolveT0From, resolveT0To, resolveFrom, voidFrom}, choicesAvailable, pending, asOf,
 *           attestations?: [{cid, outcome, sourceUri, fetchedAt, usable, reason}], lastSubmission?: {commandId, choice, at, status, error} | null}
 *   POST /api/v1/admin/markets/:marketId/resolution            (role ops)
 *        {choice, outcome?, sourceUri?, attestationCids?, reason, signature?}
 *        → 202 {approval} (waiting for a second person) | 200 {approval, result: {marketId, choice, commandId, status?}}
 *
 * `:marketId` is the decimal id (the backend canonicalises it: "007" is market 7, the approval's
 * subject). `attestations`, `lastSubmission` and the result's `status` are read leniently: a
 * backend without them gets the console as it was (the public ledger read's attestations, all of
 * them). Refusals: 400 validation_failed (a field the choice does not take), 409
 * market_not_resolvable (details.reason), 409 approval_conflict / 403 approval_linked_person (a
 * position in the market), 503 ledger_stale / not_ready. This module is the one place that knows
 * the route, its bodies and answers, and how the approval's params and precondition snapshot read;
 * MarketView and the approvals console use it.
 */
import { BackendError, backendFetch } from "@/lib/backend";
import { approveRoleFor, type SignedRequest } from "@/lib/rampAdmin";
import { isWalletRefusal, positionConflictSentence, rampAdminErrorMessage, walletRefusalSentence } from "@/lib/rampAdminErrors";
import type { ApiAdminSession, ApiApproval, ApiApprovalOutcome } from "@/lib/rampAdminTypes";

export const MARKET_RESOLVE_ACTION = "market.resolve";
export const MARKET_SUBJECT_TYPE = "market";

export type MarketResolutionChoice = "ResolveT0" | "Resolve" | "VoidMarket";
export const MARKET_RESOLUTION_CHOICES: readonly MarketResolutionChoice[] = ["ResolveT0", "Resolve", "VoidMarket"];

/** A T0 outcome on the wire: the ledger's `VoidOutcome` is `Void` here. */
export type ResolutionOutcome = "Yes" | "No" | "Void";

/** What a request asks for: exactly the approval's params (the body minus `reason` and `signature`). */
export interface MarketResolutionInput {
  choice: MarketResolutionChoice;
  outcome?: ResolutionOutcome;
  sourceUri?: string;
  attestationCids?: string[];
}

/** ISO UTC instants, inclusive bounds (the backend's `resolutionWindows`). */
export interface MarketResolutionWindows {
  resolveT0From: string | null;
  resolveT0To: string | null;
  resolveFrom: string | null;
  voidFrom: string | null;
}

/** `GET …/resolution`'s market: the decision fields as the backend's index holds them. */
export interface MarketResolutionMarket {
  /** Decimal string, the approval's subject. */
  marketId: string;
  ticker: string | null;
  question: string | null;
  status: string | null;
  expiresAt: string | null;
  gracePeriodSecs: number | null;
  collateral: { admin: string | null; id: string; symbol: string | null } | null;
  /** ResolveT0 is offered only when the market enabled it. */
  operatorResolution: boolean;
  /** ResolveT0's `sourceUri` must be one of these when the market lists any (any http(s) URL otherwise). */
  sources: string[];
  /** The ledger's name (`Yes` | `No` | `VoidOutcome`), null while unresolved. */
  outcome: string | null;
}

/** `GET …/resolution`'s read of one of the market's OutcomeAttestations: whether a Resolve may name it now, and why not. */
export interface ResolutionAttestation {
  cid: string;
  /** The ledger's name (`Yes` | `No` | `VoidOutcome`). */
  outcome: string | null;
  sourceUri: string | null;
  /** ISO UTC. */
  fetchedAt: string | null;
  usable: boolean;
  /** The backend's slug when unusable (the 409's `attestation_*` reasons). */
  reason: string | null;
}

/** `submitted`: the wallet accepted the command and the backend's index has not shown the result yet. */
export type ResolutionSubmissionStatus = "submitted" | "succeeded" | "failed" | "unknown";
const SUBMISSION_STATUSES: readonly ResolutionSubmissionStatus[] = ["submitted", "succeeded", "failed", "unknown"];

/** `GET …/resolution`'s last resolution the backend submitted for this market. */
export interface ResolutionSubmission {
  commandId: string;
  choice: MarketResolutionChoice | null;
  /** ISO UTC. */
  at: string | null;
  status: ResolutionSubmissionStatus;
  error: string | null;
}

/** `GET …/resolution`: the market as the backend reads it, its windows, what it accepts now, the open request. */
export interface MarketResolutionState {
  market: MarketResolutionMarket;
  windows: MarketResolutionWindows;
  choicesAvailable: MarketResolutionChoice[];
  pending: ApiApproval | null;
  /** The backend clock reading the windows and choices were judged at (ISO UTC). */
  asOf: string | null;
  /** The backend's read of the market's attestations; null when it sends none (the console then offers the public ledger read, all of it). */
  attestations: ResolutionAttestation[] | null;
  /** Null when there is none, or the backend does not say. */
  lastSubmission: ResolutionSubmission | null;
}

export interface MarketResolutionResult {
  /** Decimal string. */
  marketId: string;
  choice: MarketResolutionChoice;
  commandId: string;
  /** How the submission stands; absent from a backend before the field. */
  status?: ResolutionSubmissionStatus;
}

export type MarketResolutionAnswer = ApiApprovalOutcome<MarketResolutionResult>;

export const CHOICE_LABEL: Record<MarketResolutionChoice, string> = {
  ResolveT0: "T0 operator resolution",
  Resolve: "resolution from attestations (T1/T2)",
  VoidMarket: "void after the grace period",
};

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function isResolutionChoice(v: unknown): v is MarketResolutionChoice {
  return typeof v === "string" && (MARKET_RESOLUTION_CHOICES as readonly string[]).includes(v);
}

function isApproval(v: unknown): v is ApiApproval {
  return isObject(v) && typeof v.id === "string" && typeof v.action === "string" && typeof v.status === "string";
}

/**
 * The backend's subject for a market (`marketIdParam`): the decimal id without leading zeros, so
 * the route, the approval's subject and the C23 message name the same market. Anything else is
 * passed through and the backend refuses it (400).
 */
export function canonicalMarketId(marketId: number | string): string {
  const raw = String(marketId).trim();
  return /^\d{1,15}$/.test(raw) ? String(Number(raw)) : raw;
}

const routeOf = (marketId: number | string) =>
  `/api/v1/admin/markets/${encodeURIComponent(canonicalMarketId(marketId))}/resolution`;

/** `{admin, id, symbol?}` (the GET's InstrumentRef, the snapshot's InstrumentId). */
function collateralOf(v: unknown): MarketResolutionMarket["collateral"] {
  if (!isObject(v)) return null;
  const id = text(v.id);
  return id ? { admin: text(v.admin), id, symbol: text(v.symbol) } : null;
}

function wholeSeconds(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** The GET's market; one without its id is no market the console can request anything of. */
function readMarket(m: Obj): MarketResolutionMarket | null {
  const id = typeof m.marketId === "number" || typeof m.marketId === "string" ? canonicalMarketId(m.marketId) : "";
  if (!/^\d+$/.test(id)) return null;
  return {
    marketId: id,
    ticker: text(m.ticker),
    question: text(m.question),
    status: text(m.status),
    expiresAt: text(m.expiresAt),
    gracePeriodSecs: wholeSeconds(m.gracePeriodSecs),
    collateral: collateralOf(m.collateral),
    operatorResolution: m.operatorResolution === true,
    sources: Array.isArray(m.sources) ? m.sources.map(text).filter((s): s is string => s !== null) : [],
    outcome: text(m.outcome),
  };
}

function submissionStatus(v: unknown): ResolutionSubmissionStatus | null {
  return typeof v === "string" && (SUBMISSION_STATUSES as readonly string[]).includes(v) ? (v as ResolutionSubmissionStatus) : null;
}

/**
 * The GET's attestations: no list is null (a backend before the field). An entry without its cid
 * is dropped (no request can name it), a repeated cid kept once, and anything but `usable: true`
 * is unusable.
 */
function readAttestations(v: unknown): ResolutionAttestation[] | null {
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  return v.filter(isObject).flatMap((a) => {
    const cid = text(a.cid);
    if (!cid || seen.has(cid)) return [];
    seen.add(cid);
    return [{ cid, outcome: text(a.outcome), sourceUri: text(a.sourceUri), fetchedAt: text(a.fetchedAt), usable: a.usable === true, reason: text(a.reason) }];
  });
}

/** The GET's last submission: null when absent or without its command id; a status the console does not know reads `unknown`. */
function readSubmission(v: unknown): ResolutionSubmission | null {
  const commandId = isObject(v) ? text(v.commandId) : null;
  if (!isObject(v) || !commandId) return null;
  return {
    commandId,
    choice: isResolutionChoice(v.choice) ? v.choice : null,
    at: text(v.at),
    status: submissionStatus(v.status) ?? "unknown",
    error: text(v.error),
  };
}

/** The GET answer, read strictly: any other envelope is `invalid_response`, never a half-offered console. */
export function readResolutionState(raw: unknown): MarketResolutionState {
  const market = isObject(raw) && isObject(raw.market) ? readMarket(raw.market) : null;
  if (!isObject(raw) || !market || !isObject(raw.windows) || !Array.isArray(raw.choicesAvailable))
    throw new BackendError(200, "invalid_response", "The accounts service returned no resolution state for this market.");
  // A pending request the console cannot read would be offered a second time: refuse it instead.
  if (raw.pending !== null && raw.pending !== undefined && !isApproval(raw.pending))
    throw new BackendError(200, "invalid_response", "The accounts service returned a pending request the console cannot read.");
  const w = raw.windows;
  return {
    market,
    windows: {
      resolveT0From: text(w.resolveT0From),
      resolveT0To: text(w.resolveT0To),
      resolveFrom: text(w.resolveFrom),
      voidFrom: text(w.voidFrom),
    },
    choicesAvailable: raw.choicesAvailable.filter(isResolutionChoice),
    pending: isApproval(raw.pending) ? raw.pending : null,
    asOf: text(raw.asOf),
    attestations: readAttestations(raw.attestations),
    lastSubmission: readSubmission(raw.lastSubmission),
  };
}

/** An operator session's read: what the backend would accept for this market now, and the open request. */
export async function fetchMarketResolution(marketId: number | string): Promise<MarketResolutionState> {
  return readResolutionState(await backendFetch<unknown>(routeOf(marketId)));
}

/** The params of a request, keys in a fixed order and only those the choice takes. */
export function resolutionParams(input: MarketResolutionInput): MarketResolutionInput {
  switch (input.choice) {
    case "ResolveT0":
      return { choice: "ResolveT0", outcome: input.outcome, sourceUri: input.sourceUri?.trim() };
    case "Resolve":
      return { choice: "Resolve", attestationCids: [...(input.attestationCids ?? [])] };
    case "VoidMarket":
      return { choice: "VoidMarket" };
  }
}

/**
 * Role `ops`: 202 `{approval}` while a second person's decision is pending, 200 `{approval,
 * result}` once executed (dual control off, dev). With signatures on, a single-control request
 * answers 400 `approval_signature_required` first; `signature` is the second click's (C23).
 */
export async function requestMarketResolution(
  marketId: number | string,
  input: MarketResolutionInput,
  reason: string,
  signature?: string,
): Promise<MarketResolutionAnswer> {
  const answer = await backendFetch<unknown>(routeOf(marketId), {
    method: "POST",
    body: { ...resolutionParams(input), reason, ...(signature ? { signature } : {}) },
  });
  if (!isObject(answer) || !isApproval(answer.approval))
    throw new BackendError(200, "invalid_response", "The accounts service did not return the resolution request.");
  return answer as unknown as MarketResolutionAnswer;
}

/** What a signed single-control request commits to (C23): the params exactly as sent, the canonical subject. */
export function resolutionSignedRequest(marketId: number | string, input: MarketResolutionInput): SignedRequest {
  return {
    action: MARKET_RESOLVE_ACTION,
    subjectType: MARKET_SUBJECT_TYPE,
    subjectId: canonicalMarketId(marketId),
    params: { ...resolutionParams(input) },
  };
}

/** The console's T0 buttons speak the ledger's `VoidOutcome`; the route takes `Void`. */
export function wireOutcome(outcome: "Yes" | "No" | "VoidOutcome"): ResolutionOutcome {
  return outcome === "VoidOutcome" ? "Void" : outcome;
}

/** The ledger's `VoidOutcome` (the GET's market, the snapshot's attestations) in the route's word. */
export function outcomeWord(outcome: string | null | undefined): string | null {
  return outcome === "VoidOutcome" ? "Void" : (outcome ?? null);
}

// The DTO's limits (market-resolution.dto.ts, admin.dto.ts REASON_MAX_LENGTH).
export const MARKET_RESOLUTION_MAX_ATTESTATIONS = 50;
export const MARKET_RESOLUTION_MAX_SOURCE_URI = 2048;
const MAX_CID_LENGTH = 512;
const REASON_MAX_LENGTH = 500;

function isHttpUrl(s: string): boolean {
  try {
    const { protocol } = new URL(s);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Why the backend would refuse this body with 400 validation_failed, checked before it is sent
 * (the DTO and `resolutionParams`): a reason over 500 characters, a T0 outcome or source it does
 * not take, an attestation list that is empty, over 50, repeats an id or holds a non-id. Null
 * when it passes; an empty reason is the button's own rule.
 */
export function resolutionInputProblem(input: MarketResolutionInput, reason: string): string | null {
  // Code points: never fewer than class-validator's MaxLength counts (it counts a surrogate pair once).
  const chars = [...reason.trim()].length;
  if (chars > REASON_MAX_LENGTH) return `The reason is at most ${REASON_MAX_LENGTH} characters (${chars} now).`;
  const p = resolutionParams(input);
  if (p.choice === "ResolveT0") {
    if (p.outcome !== "Yes" && p.outcome !== "No" && p.outcome !== "Void") return "Choose the outcome: Yes, No or Void.";
    const uri = p.sourceUri ?? "";
    if (!isHttpUrl(uri)) return "The source must be an http(s) URL: the page the result was read from.";
    if (uri.length > MARKET_RESOLUTION_MAX_SOURCE_URI)
      return `The source URL is at most ${MARKET_RESOLUTION_MAX_SOURCE_URI} characters (${uri.length} now).`;
  }
  if (p.choice === "Resolve") {
    const cids = p.attestationCids ?? [];
    if (cids.length === 0) return "There is no attestation to resolve from.";
    if (cids.length > MARKET_RESOLUTION_MAX_ATTESTATIONS)
      return `A request names at most ${MARKET_RESOLUTION_MAX_ATTESTATIONS} attestations; this one names ${cids.length}.`;
    if (new Set(cids).size !== cids.length) return "An attestation is listed twice.";
    if (cids.some((c) => !/^\S+$/.test(c) || c.length > MAX_CID_LENGTH)) return "An attestation id is not a contract id.";
  }
  return null;
}

/**
 * Requests need the `ops` role (the approval's requestRoles); an `approver` reads the state and
 * decides requests under Approvals. Null when the roles allow it or are unknown (the backend
 * enforces them either way).
 */
export function resolutionRoleProblem(session: Pick<ApiAdminSession, "roles"> | null): string | null {
  if (!session || session.roles.includes("ops")) return null;
  return session.roles.includes("approver")
    ? "Requesting a resolution needs the ops role. As an approver you decide the requests under Operator console → Approvals."
    : "Requesting a resolution needs the ops role.";
}

/** What the console offers now: what the backend would accept, to an `ops` session, and nothing while a request is pending. */
export function offeredChoices(
  state: MarketResolutionState | null,
  session: Pick<ApiAdminSession, "roles"> | null = null,
): MarketResolutionChoice[] {
  if (!state || state.pending || resolutionRoleProblem(session)) return [];
  return MARKET_RESOLUTION_CHOICES.filter((c) => state.choicesAvailable.includes(c));
}

/** `2026-10-21 12:00:00 UTC`: windows and fetch times to the second (the ledger compares seconds). */
export function utcSeconds(at: string | number | null | undefined): string {
  const ms = typeof at === "number" ? at : typeof at === "string" ? Date.parse(at) : NaN;
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

/** `ResolveT0 → Yes from https://…`, `Resolve from 2 attestations`, `VoidMarket`. */
export function resolutionWhat(params: Partial<MarketResolutionInput> | Obj | null | undefined): string {
  const p: Obj = params ?? {};
  const choice = text(p.choice) ?? "?";
  if (choice === "ResolveT0") return `ResolveT0 → ${text(p.outcome) ?? "?"}${text(p.sourceUri) ? ` from ${text(p.sourceUri)}` : ""}`;
  if (choice === "Resolve") {
    const n = Array.isArray(p.attestationCids) ? p.attestationCids.length : 0;
    return `Resolve from ${n} attestation${n === 1 ? "" : "s"}`;
  }
  return choice;
}

const who = (a: Pick<ApiApproval, "requestedByPerson" | "requestedByParty">) =>
  text(a.requestedByPerson) ?? (text(a.requestedByParty) ? `${a.requestedByParty.slice(0, 16)}…` : "?");

/** The open request in one sentence: what, who asked, when (UTC), until when, who decides. */
export function pendingResolutionSentence(a: ApiApproval): string {
  return (
    `${resolutionWhat(a.params)} is waiting for a second person to approve: requested by ${who(a)} at ` +
    `${utcSeconds(a.requestedAt)}, expires ${utcSeconds(a.expiresAt)} (approval ${a.id.slice(0, 8)}). ` +
    `A person with the ${approveRoleFor(a.action)} role approves it under Operator console → Approvals; no second request is offered meanwhile.`
  );
}

/** The POST answer for the operator: waiting (who asked, when), submitted (command id) and how it stands, or failed. */
export function resolutionAnswerSentence(answer: MarketResolutionAnswer): {
  title: string;
  description: string;
  status: "info" | "success" | "warning" | "error";
} {
  const a = answer.approval;
  if (a.status === "pending") return { title: "Waiting for a second person to approve", description: pendingResolutionSentence(a), status: "info" };
  if (a.status === "executed") {
    const r = answer.result;
    const choice = r?.choice ?? text(a.params?.choice) ?? "Resolution";
    const sent =
      `${resolutionWhat(a.params)} on market #${String(r?.marketId ?? a.subjectId)} was submitted by the backend as the treasury` +
      `${r?.commandId ? ` (command ${r.commandId})` : ""}, requested by ${who(a)} at ${utcSeconds(a.requestedAt)}${a.singleControl ? ", single control" : ""}`;
    switch (submissionStatus(r?.status)) {
      case "succeeded":
        return { title: `${choice} applied`, description: `${sent}, and the ledger applied it.`, status: "success" };
      case "failed":
        return { title: `${choice} failed`, description: `${sent}, and the ledger did not apply it. The last submission below says why; request it again once that is fixed.`, status: "error" };
      case "submitted":
        return { title: `${choice} submitted`, description: `${sent}. The wallet accepted it and the backend's index has not shown the result yet; the market updates once it does.`, status: "success" };
      case "unknown":
        return { title: `${choice} submitted, outcome unknown`, description: `${sent}, but the backend cannot tell how it ended. Reload in a minute before requesting it again.`, status: "warning" };
    }
    // A backend without the result's status: "executed" means the wallet took the command, not that
    // the ledger applied it (an index behind the ledger can name a contract a trade just consumed).
    return {
      title: `${choice} submitted`,
      description:
        `${sent}. The market updates once the ledger shows it; if it still shows open a minute ` +
        "later, the ledger refused the submission (the market moved meanwhile): request it again.",
      status: "success",
    };
  }
  if (a.status === "approved")
    return { title: "Approved: the backend is submitting it", description: `${resolutionWhat(a.params)} (approval ${a.id.slice(0, 8)}) is being submitted.`, status: "info" };
  return {
    title: `Resolution request ${a.status}`,
    description: `${resolutionWhat(a.params)} (approval ${a.id.slice(0, 8)}) is ${a.status}${a.error ? `: ${a.error}` : "."}`,
    status: "warning",
  };
}

/** The GET's last submission for the operator: what, which command, when (UTC), and what its status means. */
export function lastSubmissionSentence(s: ResolutionSubmission): string {
  const what = `Last submission: ${s.choice ?? "a resolution"} (command ${s.commandId}) at ${utcSeconds(s.at)}`;
  const error = s.error ? s.error.replace(/[.\s]+$/, "") : null;
  switch (s.status) {
    case "submitted":
      return `${what}, submitted: the wallet accepted it and the backend's index has not shown the result yet. The market updates once it does; wait for that before requesting again.`;
    case "succeeded":
      return `${what}, succeeded: the ledger applied it.`;
    case "failed":
      return `${what}, failed${error ? `: ${error}` : ""}. The ledger did not apply it; request it again once the cause is fixed.`;
    case "unknown":
      return `${what}: the backend cannot tell how it ended${error ? ` (${error})` : ""}. Reload in a minute before requesting it again.`;
  }
}

/** Why the backend will not let a Resolve name an attestation now (its `reason`, the 409's `attestation_*` slugs), for the operator. */
export function attestationReasonSentence(reason: string | null): string {
  switch ((reason ?? "").replace(/^attestation_/, "")) {
    case "unknown":
      return "The backend's ledger index does not hold it yet, so it cannot vouch for it. Reload in a minute.";
    case "archived":
      return "It is no longer active on the ledger.";
    case "other_market":
      return "It is about another market.";
    case "source":
    case "source_not_allowed":
      return "Its source is not in this market's source allowlist.";
    case "window":
      return "It was read outside the resolution window (from the expiry to the end of the grace period).";
    case "malformed":
      return "Its signature or its source's pinned key is not DER-encoded, so the ledger would refuse the whole request.";
    case "":
      return "The backend will not use it and gave no reason.";
    default:
      return `The backend will not use it (${reason}).`;
  }
}

/** One attestation row of the market page's console. */
export interface ResolveAttestationRow {
  cid: string;
  /** `Yes` | `No` | `Void`. */
  outcome: string | null;
  sourceUri: string | null;
  /** Milliseconds since the epoch. */
  fetchedAt: number | null;
  /** A pinned source's signature is on it (only the public ledger read says). */
  signed: boolean;
  /** Whether a Resolve may name it now; an unusable row is listed with `why`, never selectable. */
  usable: boolean;
  why: string | null;
  /** Named by the request: usable, and not unticked by the operator. */
  selected: boolean;
}

/** The public ledger read's fields the console shows (activeContracts' OutcomeAttestationRecord). */
interface LedgerAttestation {
  contractId: string;
  outcome: string;
  sourceUri: string;
  /** Epoch seconds. */
  fetchedAt: number;
  hasSourceSignature?: boolean;
}

/**
 * The console's attestations: the backend's read when it sends one (usable ones preselected, the
 * operator may untick them; unusable ones listed with why and never selected), else the public
 * ledger read, every one selected — what the console sent before the backend said which it accepts.
 */
export function resolveAttestationRows(
  backend: readonly ResolutionAttestation[] | null,
  ledger: readonly LedgerAttestation[],
  unticked: ReadonlySet<string> = new Set(),
): ResolveAttestationRow[] {
  if (backend === null)
    return ledger.map((a) => ({
      cid: a.contractId,
      outcome: outcomeWord(a.outcome),
      sourceUri: text(a.sourceUri),
      fetchedAt: Number.isFinite(a.fetchedAt) ? a.fetchedAt * 1000 : null,
      signed: a.hasSourceSignature === true,
      usable: true,
      why: null,
      selected: true,
    }));
  return backend.map((a) => ({
    cid: a.cid,
    outcome: outcomeWord(a.outcome),
    sourceUri: a.sourceUri,
    fetchedAt: isoMs(a.fetchedAt),
    signed: false,
    usable: a.usable,
    why: a.usable ? null : attestationReasonSentence(a.reason),
    selected: a.usable && !unticked.has(a.cid),
  }));
}

/** Why the console's Resolve names no attestation, or null when it names one. */
export function resolvePickProblem(rows: readonly ResolveAttestationRow[]): string | null {
  if (rows.some((r) => r.selected)) return null;
  if (rows.some((r) => r.usable)) return "Tick at least one usable attestation.";
  return rows.length > 0 ? "No attestation can be used now; each one says why." : "There is no attestation of this market to resolve from yet.";
}

/**
 * The console's sentence for a failed read or request: lib/rampAdminErrors.ts's, except two that
 * read differently for a market. I8 (`approval_linked_person`) can only mean a position in it, as
 * `approval_conflict` with `position_in_market` says outright; and a request that ran at once
 * (single control) answers `upstream_failed`: the wallet's or the ledger's refusal of the command,
 * or a failure before anything was submitted (the market's contract unreadable on the ledger, the
 * wallet's token).
 */
export function resolutionErrorMessage(e: unknown): string {
  if (e instanceof BackendError && e.code === "approval_linked_person") return positionConflictSentence(isObject(e.details) ? e.details : {});
  if (e instanceof BackendError && e.code === "upstream_failed")
    return isWalletRefusal(e.message)
      ? walletRefusalSentence(e.message)
      : `Nothing was submitted: ${e.message.trim().replace(/[.\s]+$/, "") || "a service the backend needs did not answer"}. Try again in a minute; if it keeps failing, the backend's ledger or wallet connection needs looking at.`;
  return rampAdminErrorMessage(e);
}

// ── the stored request: the approval's params and its precondition snapshot ──

/** One attestation a Resolve request names, as the snapshot recorded it from the backend's index; null fields when it held none. */
export interface ResolveAttestationView {
  contractId: string;
  /** `Yes` | `No` | `Void` (the ledger's `VoidOutcome`). */
  outcome: string | null;
  sourceUri: string | null;
  /** Milliseconds since the epoch. */
  fetchedAt: number | null;
}

/**
 * A `market.resolve` approval as the approver reads it: its params and the backend's snapshot
 * (ApiMarketResolutionSnapshot: the decision fields only, never the contract id or the pool
 * figures). Every instant in milliseconds, UTC; the windows are the backend's own, computed from
 * the expiry and the grace (the snapshot records none).
 */
export interface MarketResolveView {
  choice: MarketResolutionChoice | null;
  marketId: string | null;
  /** The snapshot's own market id when it names another market than the request's subject. */
  snapshotMarketId: string | null;
  ticker: string | null;
  question: string | null;
  /** ResolveT0's outcome (`Yes` | `No` | `Void`). */
  outcome: string | null;
  sourceUri: string | null;
  attestations: ResolveAttestationView[];
  collateral: { admin: string | null; id: string; symbol: string | null } | null;
  /** The market's source allowlist (empty: any http(s) URL); null when the snapshot does not say. */
  sources: string[] | null;
  status: string | null;
  /** The market's outcome at request time, `Void` for the ledger's `VoidOutcome`. */
  currentOutcome: string | null;
  expiresAt: number | null;
  gracePeriodSecs: number | null;
  windows: { resolveT0From: number | null; resolveT0To: number | null; resolveFrom: number | null; voidFrom: number | null };
}

/** An ISO instant (the backend's `secToIso`) in milliseconds. */
function isoMs(v: unknown): number | null {
  const ms = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Reads params + precondition; absent figures stay null (the approvals console then blocks Approve). */
export function marketResolveView(a: Pick<ApiApproval, "subjectId" | "params" | "precondition">): MarketResolveView {
  const p: Obj = a.params ?? {};
  const pre: Obj = a.precondition ?? {};
  const subject = text(a.subjectId);
  const snapshotId = typeof pre.marketId === "string" || typeof pre.marketId === "number" ? canonicalMarketId(pre.marketId) : null;
  const marketId = subject !== null ? canonicalMarketId(subject) : snapshotId;
  const expiresAt = isoMs(pre.expiresAt);
  const grace = wholeSeconds(pre.gracePeriodSecs);
  const end = expiresAt !== null && grace !== null ? expiresAt + grace * 1000 : null;
  // Each recorded attestation names its contract as `cid`, in the request's order.
  const recorded = Array.isArray(pre.attestations) ? pre.attestations.filter(isObject) : [];
  const byCid = new Map(recorded.map((x) => [String(x.cid ?? ""), x]));
  const cids = Array.isArray(p.attestationCids) ? p.attestationCids.map(String) : recorded.map((x) => String(x.cid ?? ""));
  return {
    choice: isResolutionChoice(p.choice) ? p.choice : null,
    marketId,
    snapshotMarketId: snapshotId !== null && marketId !== null && snapshotId !== marketId ? snapshotId : null,
    ticker: text(pre.ticker),
    question: text(pre.question),
    outcome: text(p.outcome),
    sourceUri: text(p.sourceUri),
    attestations: cids.map((contractId) => {
      const x: Obj = byCid.get(contractId) ?? {};
      return { contractId, outcome: outcomeWord(text(x.outcome)), sourceUri: text(x.sourceUri), fetchedAt: isoMs(x.fetchedAt) };
    }),
    collateral: collateralOf(pre.collateral),
    sources: Array.isArray(pre.sources) ? pre.sources.map(text).filter((s): s is string => s !== null) : null,
    status: text(pre.status),
    currentOutcome: outcomeWord(text(pre.outcome)),
    expiresAt,
    gracePeriodSecs: grace,
    // The backend's resolutionWindows: VoidMarket asserts now > expiry + grace, so it opens one second after.
    windows: { resolveT0From: expiresAt, resolveT0To: end, resolveFrom: expiresAt, voidFrom: end !== null ? end + 1000 : null },
  };
}
