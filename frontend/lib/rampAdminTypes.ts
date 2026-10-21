/**
 * Wire types of the backend's ramp operator API (truthoracle-backend docs/RAMP.md §12.2), aligned
 * with the final controllers, DTOs and response mappers (src/types.ts `Api*`, F3). Money is a 10-dp
 * decimal string, instants are UTC ISO strings. Free-form blobs the console only shows raw
 * (`details`, `risk`, `figures`, `params`, `result`) stay `Record<string, unknown>` / `unknown`.
 */
import type { KycVerification, Money, Payout, PayoutStatus } from "@/auth/types";
import type { RampOrder } from "@/lib/ramp";

// ── list envelopes ──

/** Most list routes: `{items}` (newest first, capped server-side). */
export interface ApiItems<T> {
  items: T[];
}

/** `GET /admin/ramp/orders`: a keyset page — pass `nextCursor` back as `cursor`; null at the end. */
export interface ApiCursorPage<T> extends ApiItems<T> {
  page: number;
  limit: number;
  total: number;
  nextCursor: string | null;
}

// ── operator session ──

export type AdminRole = "ops" | "approver" | "aml" | "export";
export const ADMIN_ROLES: readonly AdminRole[] = ["ops", "approver", "aml", "export"];

/** `GET /admin/session`: who the operator is and how decisions are made. Roles gate requests; the backend enforces them. */
export interface ApiAdminSession {
  party: string;
  personId: string;
  roles: AdminRole[];
  /** RAMP_APPROVAL_SIGNATURES: decisions must carry the operator wallet's signature. */
  approvalSignatures: boolean;
  /** RAMP_DUAL_CONTROL: false = a request executes at once (dev / test only). */
  dualControl: boolean;
}

// ── four-eyes approvals (§6.5) ──

export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "expired" | "cancelled";
export const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
  "expired",
  "cancelled",
];
export type ApprovalDecision = "approve" | "reject";

export interface ApiApproval {
  id: string;
  /** e.g. `ramp.order.refund`, `ramp.batch.approve`, `compliance.freeze.lift`. */
  action: string;
  subjectType: string;
  subjectId: string;
  params: Record<string, unknown>;
  /** What a signed decision commits to: `truthoracle-approval:<id>:<paramsHash>:<approve|reject>`. */
  paramsHash: string;
  /** The subject's snapshot at request time; a different fresh read fails the approval. */
  precondition: Record<string, unknown> | null;
  /** The registry's one line on what executing it does. */
  description: string | null;
  reason: string;
  status: ApprovalStatus;
  /** Executed at request (one person) — a plain retry, a review alert, dual control off. */
  singleControl: boolean;
  requestedByUserId: string;
  requestedByParty: string;
  requestedByPerson: string;
  requestedAt: string;
  decidedByUserId: string | null;
  decidedByParty: string | null;
  decidedByPerson: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  executedAt: string | null;
  result: unknown;
  error: string | null;
  expiresAt: string;
}

/** An approval-backed route's answer: 202 `{approval}` while pending, 200 `{approval, result}` once executed. */
export interface ApiApprovalOutcome<R = unknown> {
  approval: ApiApproval;
  result?: R;
}

/** `POST /admin/approvals/approve-many`: one entry per id, each decided on its own. */
export interface ApiApproveManyResult {
  results: {
    id: string;
    approval?: ApiApproval;
    result?: unknown;
    error?: { error: string; message?: string } | null;
  }[];
}

// ── ramp orders (§3, §4) ──

export type RampDirection = "onramp" | "offramp";
export const RAMP_STATUSES = [
  "created",
  "awaiting_payment",
  "paid",
  "minting",
  "crediting",
  "awaiting_withdrawal",
  "withdrawing",
  "burning",
  "paying_out",
  "reversing",
  "payout_queued",
  "payout_sent",
  "needs_review",
  "refunding",
  "completed",
  "failed",
  "expired",
  "cancelled",
  "refunded",
  "chargeback",
] as const;
export type RampStatus = (typeof RAMP_STATUSES)[number];
/** Why an order is in `needs_review`; the operator sees `compliance` too (the user never does). */
export type RampReviewStep =
  | "payment"
  | "mint"
  | "credit"
  | "withdrawal"
  | "burn"
  | "payout"
  | "refund"
  | "reversal"
  | "compliance";

/** The operator of record stamped on an order (name, UNP, HTP reference, terms version). */
export interface RampOperatorSnapshot {
  name: string;
  unp: string;
  htpRef: string;
  termsVersion: string;
}

/** `ApiAdminRampOrder`: the user's view of the order plus every id, figure and blob the operator needs. */
export interface ApiAdminRampOrder extends Omit<RampOrder, "reviewStep" | "operator"> {
  reviewStep: RampReviewStep | null;
  operator: RampOperatorSnapshot | null;
  userId: string;
  partyId: string;
  provider: string;
  idempotencyKey: string;
  /** The funding card of an on-ramp, or the destination card of a card cash-out. */
  paymentMethodId: string | null;
  pendingPayoutCid: string | null;
  bankAccountId: string | null;
  payoutBatchId: string | null;
  consentId: string | null;
  /** Compliance decisions by point (§11.5): `{[point]: {decision, rules, alertIds, at}}`. */
  risk: Record<string, unknown>;
  /** The CAS version an approval snapshots. */
  version: number;
  providerPaymentId: string | null;
  providerPayoutId: string | null;
  providerRefundId: string | null;
  capturedAmount: Money | null;
  capturedAt: string | null;
  refundedAmount: Money;
  mintCommandId: string | null;
  creditCommandId: string | null;
  burnCommandId: string | null;
  remintCommandId: string | null;
  remintCreditCommandId: string | null;
  attempts: number;
  lastError: string | null;
  /** `reviewFrom`, `reviewReason`, `payment`, `payout`, `cardPayout`, `hold`, `chargeback`, `timeline`, … (§3.1). */
  details: Record<string, unknown>;
}

export interface ApiRampEvent {
  id: string;
  type: string;
  kind: string;
  objectId: string;
  sandbox: boolean;
  receivedAt: string;
  processedAt: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  /** Set after RAMP_EVENT_DEAD_AFTER_HOURS of failure: an operator must look. */
  deadAt: string | null;
  error: string | null;
}

/**
 * The webhook-events console's filter (C31): `dead` = failed for RAMP_EVENT_DEAD_AFTER_HOURS, so
 * nothing retries it (`events_dead`, red for a chargeback); `unprocessed` = not applied yet, dead
 * or still backing off.
 */
export type RampEventFilter = "dead" | "unprocessed";

/**
 * `GET /admin/ramp/events` item and `POST …/events/:id/replay` `{event}` (backend `ApiRampEventRow`):
 * the order view's fields plus where it came from, the last attempt, the last operator replay
 * (its dead-after window starts there) and, once a four-eyes `ramp.event.close` ran, the close.
 */
export interface ApiAdminRampEvent extends ApiRampEvent {
  provider: string;
  orderId: string | null;
  occurredAt: string;
  lastAttemptAt: string | null;
  replayedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
}

/** The four-eyes action that closes a webhook event without applying it (`ops` asks, `approver` approves). */
export const RAMP_EVENT_CLOSE_ACTION = "ramp.event.close";

/** `GET /admin/ramp/events?status&cursor` → a keyset page: pass `nextCursor` back as `cursor`; null at the end. */
export interface ApiRampEventPage extends ApiItems<ApiAdminRampEvent> {
  nextCursor: string | null;
}

export interface ApiRampJournalLine {
  entryId: string;
  /** The posting's kind (§5): `onramp.captured`, `offramp.burned`, … */
  kind: string;
  orderId: string | null;
  statementLineId: string | null;
  /** Set on client-liability lines (issuance_pending, customer_liability, payout_clearing). */
  userId: string | null;
  account: string;
  currency: string;
  /** + debit, − credit. */
  amount: Money;
  createdAt: string;
}

export interface ApiAuditEvent {
  id: string;
  actorType: string;
  actorUserId: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** A token-app command of the order (the short form the order detail carries). */
export interface ApiRampTokenCommand {
  commandId: string;
  kind: "mint" | "burn";
  amount: Money;
  status: string;
  attempts: number;
  lastPostAt: string | null;
  lastError: string | null;
  recordedAt: string | null;
  resolvedBy: string | null;
}

/**
 * `GET /admin/ramp/orders/:id`: the order and everything that touched it. Compliance alerts are
 * not part of it: `order.risk` holds the decisions, `GET /admin/compliance/alerts?orderId=` the alerts.
 */
export interface ApiAdminRampOrderDetail {
  order: ApiAdminRampOrder;
  events: ApiRampEvent[];
  journal: ApiRampJournalLine[];
  tokenCommands: ApiRampTokenCommand[];
  audit: ApiAuditEvent[];
  /** Four-eyes approvals of this order, newest first. */
  approvals: ApiApproval[];
}

/** The §4.2 exits (and the two outside `needs_review`), as the route segment. */
export type RampOrderAction =
  | "retry"
  | "refund"
  | "refund_bank"
  | "reverse"
  | "reverse_remainder"
  | "credit_back"
  | "fail"
  | "burn_uncredited"
  | "bank_unpaid"
  /** C19: a chargeback stopped an on-ramp's bank refund the bank never got (`onramp.refund_cancelled`). */
  | "refund_cancel";

/** Where an order's fiat goes, as a `ramp.order.*` approval snapshots it (backend RampSnapshotDestination). */
export type ApiRampSnapshotDestination =
  | { kind: "card"; paymentMethodId: string; brand: string | null; last4: string | null }
  | { kind: "bank"; bankAccountId: string };

/**
 * F2 / F8: the figures every `ramp.order.*` approval's precondition carries besides the order's
 * state (backend RampOrderFigures): the amounts, whose money and where it goes. They are set once
 * on an order, so a figure the order read disagrees with means the request is not about this order.
 */
export interface ApiRampOrderFigures {
  direction: RampDirection;
  userId: string;
  partyId: string;
  fiatAmount: Money;
  fiatCurrency: string;
  tokenAmount: Money;
  instrument: { admin: string; id: string };
  /** A cash-out's card or bank account; an on-ramp's bank refund account, else its card. */
  destination: ApiRampSnapshotDestination | null;
}

// ── controls and reconciliation (§6.1, §6.2) ──

export type HaltScope = "orders" | "mints" | "payouts";
export const HALT_SCOPES: readonly HaltScope[] = ["orders", "mints", "payouts"];

/** `GET /admin/ramp/controls` → `{controls}`. */
export interface ApiRampControls {
  haltedScopes: HaltScope[];
  reason: string | null;
  source: "admin" | "auto" | null;
  /** The red checks behind an automatic halt. */
  failingChecks: { name: string; detail: string | null }[] | null;
  since: string | null;
  setByUserId: string | null;
  updatedAt: string | null;
}

export type ReconStatus = "green" | "amber" | "red" | "unknown";

export interface ApiReconCheck {
  name: string;
  status: ReconStatus;
  detail: string | null;
  figures: Record<string, unknown> | null;
  /** What a red (or a long unknown) halts. */
  haltScopes: HaltScope[];
}

export interface ApiReconRun {
  id: string;
  trigger: "schedule" | "admin" | "pre_batch" | "sync";
  startedAt: string;
  finishedAt: string | null;
  status: ReconStatus;
  checks: ApiReconCheck[];
  /** This run set a halt. */
  halted: boolean;
}

/**
 * `GET /admin/ramp/reconciliation`: the latest full run, whether one is running, the reserve
 * figures the gate uses now (`assets`, `liabilities`, `headroom`, …, `statementFresh`, `gate`) and
 * the journal's balance per account. Reserve figures render generically, labelled where known.
 */
export interface ApiRampReconciliation {
  run: ApiReconRun | null;
  running: boolean;
  reserve: Record<string, string | number | boolean | null> | null;
  journal: Record<string, Money>;
}

/** `GET /admin/ramp/provider`: the acquirer adapter's wiring and a live probe (never card data). */
export interface ApiRampProviderStatus {
  provider: string;
  configured: boolean;
  capabilities: Record<string, unknown>;
  /** What the acquirer is told to post to; null until RAMP_PUBLIC_API_URL is configured. */
  webhookUrl: string | null;
  health: Record<string, unknown>;
}

// ── token commands (§7) ──

export type TokenCommandStatus =
  | "pending"
  | "submitted"
  | "unknown"
  | "recorded"
  | "rejected"
  | "mismatch"
  | "abandoned";
export const TOKEN_COMMAND_STATUSES: readonly TokenCommandStatus[] = [
  "pending",
  "submitted",
  "unknown",
  "recorded",
  "rejected",
  "mismatch",
  "abandoned",
];
export type TokenCommandSource = "ramp" | "admin" | "rewards" | "faucet" | "check" | "legacy";
export const TOKEN_COMMAND_SOURCES: readonly TokenCommandSource[] = [
  "ramp",
  "admin",
  "rewards",
  "faucet",
  "check",
  "legacy",
];
export type TokenCommandAction = "resend" | "abandon" | "compensate";

/** `GET /admin/tokens/commands` item: a `to_token_commands` row. */
export interface ApiTokenCommand {
  commandId: string;
  kind: "mint" | "burn";
  instrumentAdmin: string;
  instrumentId: string;
  partyId: string;
  amount: Money;
  source: TokenCommandSource;
  ref: string | null;
  status: TokenCommandStatus;
  attempts: number;
  lastPostAt: string | null;
  lastError: string | null;
  lastHttpStatus: number | null;
  updateId: string | null;
  recordedAmount: Money | null;
  recordedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── treasury payouts (PendingPayout rows the backend indexes) ──

/**
 * `GET /admin/payouts` item = the payout row with the REAL status (the operators' `toApi`; only the
 * payee's view folds the holds into `processing`); `offrampOrderId` marks one bound to a cash-out.
 */
export type ApiAdminPayout = Omit<Payout, "status"> & { status: PayoutStatus };
export type { PayoutStatus };

// ── bank rail (§10) ──

export type BatchStatus = "draft" | "approved" | "exported" | "submitted" | "settled" | "cancelled" | "voided";
export const BATCH_STATUSES: readonly BatchStatus[] = [
  "draft",
  "approved",
  "exported",
  "submitted",
  "settled",
  "cancelled",
  "voided",
];
export type PayoutItemStatus = "included" | "paid" | "returned" | "voided" | "unpaid";

export interface ApiPayoutBatch {
  id: string;
  status: BatchStatus;
  currency: string;
  itemCount: number;
  totalAmount: Money;
  createdByUserId: string;
  approvalId: string | null;
  fileFormat: string | null;
  fileSha256: string | null;
  exportedAt: string | null;
  exportedByUserId: string | null;
  exportCount: number;
  submittedAt: string | null;
  submittedByUserId: string | null;
  bankReference: string | null;
  settledAt: string | null;
  voidApprovalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiPayoutBatchItem {
  batchId: string;
  orderId: string;
  /** `payout` = a cash-out, `refund` = an on-ramp's bank refund. */
  kind: "payout" | "refund";
  documentNo: string;
  amount: Money;
  status: PayoutItemStatus;
  /** `TO-…`. */
  payoutReference: string;
  userId: string;
  bankAccountId: string;
  ibanMasked: string | null;
  bankName: string | null;
  paidLineId: string | null;
  returnedLineId: string | null;
}

/** `POST /admin/ramp/payout-batches`: the draft and what was left out (and why). */
export interface ApiPayoutBatchDraft {
  batch: ApiPayoutBatch;
  items: ApiPayoutBatchItem[];
  skipped: { orderId: string; reason: string }[];
}

export type BankStatementStatus = "draft" | "confirmed" | "rejected";
export type BankLineStatus = "unmatched" | "proposed" | "matched";

export interface ApiBankStatement {
  id: string;
  accountIban: string;
  format: "csv" | "camt053";
  fileSha256: string;
  periodFrom: string;
  periodTo: string;
  openingBalance: Money;
  closingBalance: Money;
  currency: string;
  status: BankStatementStatus;
  prevStatementId: string | null;
  importedByUserId: string;
  approvalId: string | null;
  confirmedAt: string | null;
  lineCount: number;
  createdAt: string;
}

/** What a statement line can be booked as (§10.4). `refund_return`: an on-ramp bank refund the bank sent back. */
export const BANK_MATCH_KINDS = [
  "payout",
  "payout_batch",
  "payout_return",
  "refund",
  "refund_return",
  "psp_settlement",
  "psp_funding",
  "bank_fee",
  "operator_topup",
  "operator_sweep",
  "suspense",
] as const;
export type BankMatchKind = (typeof BANK_MATCH_KINDS)[number];

/** `reference_credit`: a credit quoting an order that is not a return; the other two halt payouts. */
export const BANK_LINE_FLAGS = ["reference_credit", "iban_mismatch", "payout_duplicate"] as const;
export type BankLineFlag = (typeof BANK_LINE_FLAGS)[number];

export interface ApiBankLine {
  id: string;
  statementId: string;
  lineRef: string;
  bookingDate: string;
  valueDate: string | null;
  /** Signed: + credit to the client-money account, − debit. */
  amount: Money;
  currency: string;
  counterpartyName: string | null;
  counterpartyIbanLast4: string | null;
  counterpartyBic: string | null;
  bankTxCode: string | null;
  /** The bank marked the line as a return (camt `RtrInf`). */
  returnInfo: boolean;
  returnCode: string | null;
  /** `TO-…` when the line quotes one. */
  reference: string | null;
  documentNo: string | null;
  matchKind: BankMatchKind | null;
  matchedOrderId: string | null;
  matchedBatchId: string | null;
  status: BankLineStatus;
  flags: BankLineFlag[];
}

/** An upload's answer and `GET /admin/ramp/bank-statements/:id`: balances and lines from the FILE, matches only proposed. */
export interface ApiStatementPreview {
  statement: ApiBankStatement;
  lines: ApiBankLine[];
}

/** What an executed statement confirm returns (the approval's `result`). */
export interface ApiStatementConfirmResult {
  statement: ApiBankStatement;
  matched: number;
  unmatched: number;
  flagged: number;
}

/** How an unmatched line is booked at confirm (or later, `ramp.bank_line.classify`). */
export interface BankLineClassification {
  lineId: string;
  matchKind: BankMatchKind;
  orderId?: string;
  batchId?: string;
}

export type BankAccountStatus = "cooling_off" | "pending_proof" | "active" | "removed" | "blocked";

/** `GET /admin/ramp/bank-accounts` item. */
export interface ApiAdminBankAccount {
  id: string;
  userId: string;
  ibanMasked: string;
  /** Characters 5–8 of the IBAN: the bank in the NBRB directory. */
  bankCode: string;
  bankName: string | null;
  bic: string | null;
  nameForm: "be" | "ru" | "lat";
  status: BankAccountStatus;
  coolingOffUntil: string;
  proof: "bank_name_check" | "payer_match" | "manual" | null;
  proofRef: string | null;
  verifiedAt: string | null;
  firstPayoutOrderId: string | null;
  lastUsedAt: string | null;
  /** The bank directory's sanctions flags (informational). */
  sanctions: { eu: readonly string[]; us: readonly string[]; uk: readonly string[] };
  createdAt: string;
}

// ── compliance (§11.6) ──

export type AlertSeverity = "info" | "review" | "block";
/**
 * `open` / `escalated` await a decision; `reported` (special form filed) still holds; `cleared`
 * releases; `returned` (final) ends the hold WITHOUT releasing: the payment goes back (C25).
 */
export type AlertStatus = "open" | "cleared" | "escalated" | "reported" | "returned";
export const ALERT_STATUSES: readonly AlertStatus[] = ["open", "escalated", "reported", "cleared", "returned"];
/** `return` (C25): refuse the held payment — the ramp refunds it, never mints or pays it out. */
export type AlertDecision = "clear" | "escalate" | "report" | "return";

/** `GET /admin/compliance/alerts[/:id]`. Figures never carry personal data. */
export interface ApiComplianceAlert {
  id: string;
  userId: string;
  rule: string;
  /** The value point (`onramp.create` …) or what raised it (`consent`, `identity`, `bank_account`, …). */
  point: string | null;
  severity: AlertSeverity;
  orderId: string | null;
  figures: Record<string, unknown>;
  windowKey: string;
  status: AlertStatus;
  /** The legal deadline (Belarusian business days, UTC); null for info. */
  dueAt: string | null;
  rulesVersion: string;
  /** The base value (BYN) the thresholds were computed with. */
  bvByn: Money | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  reportRef: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /admin/compliance/alerts` → at most 200, undecided first by due date; no further pages. */
export interface ApiComplianceAlertList extends ApiItems<ApiComplianceAlert> {
  nextCursor: null;
}

/**
 * `GET /admin/compliance/alerts/:id/declaration` (role `aml`, audited, never cached; C13): the
 * consent a TM-PRINCIPAL / TM-PEP alert was raised on, its sealed answer opened for the officer.
 */
export interface ApiConsentDeclaration {
  alertId: string;
  rule: "TM-PRINCIPAL" | "TM-PEP";
  consentId: string;
  termsVersion: string;
  acceptedAt: string;
  actsForSelf: boolean;
  pepDeclared: boolean;
  /** TM-PRINCIPAL: who the account declared it acts for. */
  principal?: string | null;
  /** TM-PEP: the declared PEP detail. */
  pepDetail?: string | null;
}

export type ScreeningListName = "by_terror" | "un" | "decree48" | "foreign";
export const SCREENING_LISTS: readonly ScreeningListName[] = ["by_terror", "un", "decree48", "foreign"];
/** A hit on these freezes the account provisionally; a `foreign` hit only denies new orders. */
export const FREEZING_LISTS: readonly ScreeningListName[] = ["by_terror", "un", "decree48"];
export type ScreeningEntryKind = "person" | "org" | "address";
export type ScreeningHitStatus = "open" | "confirmed" | "cleared";

/** What a hit matched: the list side verbatim, the account side only as the name form and how the birth dates agree. */
export type ScreeningHitMatch =
  | {
      basis: "name";
      entryName: string;
      entryBirthDate: string | null;
      entryIds: string[];
      script: "be" | "ru" | "lat";
      birthDate: "exact" | "partial" | "unknown";
      /**
       * How the forms met (C12; absent from older rows = `fold`): `fold` the exact name keys,
       * `bridge` the be / ru / Latin forms bridged, `surname_dob` the surname and exact birth date only.
       */
      via?: "fold" | "bridge" | "surname_dob";
    }
  | { basis: "party"; party: string; listed: string }
  /** The principal a consent declares the account acts for (C13; free text, no birth date). */
  | { basis: "principal"; consentId: string; entryName: string; entryBirthDate: string | null; entryIds: string[] };

export interface ApiScreeningList {
  id: string;
  list: ScreeningListName;
  version: string;
  deliveredAt: string;
  importedAt: string;
  importedByPerson: string | null;
  charset: string;
  sha256: string;
  entryCount: number;
}

export interface ApiScreeningHit {
  id: string;
  listId: string;
  list: ScreeningListName;
  listVersion: string;
  entryId: string;
  entryKind: ScreeningEntryKind;
  userId: string;
  match: ScreeningHitMatch;
  status: ScreeningHitStatus;
  alertId: string | null;
  freezeId: string | null;
  decidedByPerson: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
}

/** `GET /admin/compliance/screening-hits/:id` (role aml, audited): the hit and the VERIFIED identity to compare it with. */
export interface ApiScreeningHitDetail {
  hit: ApiScreeningHit;
  identity: {
    names: { script: "be" | "ru" | "lat"; last: string; first: string; middle?: string | null }[];
    birthDate: string | null;
    citizenship: string | null;
    residenceCountry: string | null;
  } | null;
  /** Set when the identity could not be read now. */
  identityError?: string;
}

/** A re-screen (full or one account). */
export interface ApiScreeningRun {
  id: string;
  trigger: "import" | "schedule" | "admin" | "user";
  scope: "full" | "user";
  userId: string | null;
  status: "running" | "done" | "partial" | "failed";
  listIds: string[];
  startedAt: string;
  finishedAt: string | null;
  subjects: number;
  identities: number;
  parties: number;
  hits: number;
  failures: number;
  /** C44: accounts whose identity could not be read (their parties screened; refused until read). */
  unreadable: number;
  error: string | null;
}

/** `POST /admin/compliance/screening-lists`: the stored list and the import's re-screen (null: another one was running; the processor follows up). */
export interface ApiScreeningImport {
  list: ApiScreeningList;
  hits: number | null;
  run: ApiScreeningRun | null;
}

export type FreezeSource = "screening" | "sanctions" | "aml" | "manual" | "court";
/** The sources an operator picks from (manual first: the default). */
export const FREEZE_SOURCES: readonly FreezeSource[] = ["manual", "aml", "court", "sanctions", "screening"];

export interface ApiComplianceFreeze {
  id: string;
  userId: string;
  reason: string;
  source: FreezeSource;
  /** A screening hit's freeze until the hit is decided. */
  provisional: boolean;
  active: boolean;
  createdByUserId: string | null;
  createdByPerson: string | null;
  /** The four-eyes lift that ended it (null until lifted, and for a cleared hit's provisional freeze). */
  liftApprovalId: string | null;
  liftedByUserId: string | null;
  liftReason: string | null;
  liftedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── KYC override (C22) ──

/** `POST /admin/users/:id/kyc/override {status, reason}` (role `aml`). */
export type KycOverrideStatus = "approved" | "rejected_final" | "expired";
export const KYC_OVERRIDE_STATUSES: readonly KycOverrideStatus[] = ["approved", "rejected_final", "expired"];

/**
 * Its answer: `approved` opens the KYC-gated ramp, so it is the four-eyes `kyc.override` — 202
 * `{approval}` pending, 200 `{verification, approval}` once executed; closing the gate
 * (`rejected_final`, `expired`) is one aml decision: 200 `{verification}`.
 */
export interface ApiKycOverrideAnswer {
  verification?: KycVerification;
  approval?: ApiApproval;
}
