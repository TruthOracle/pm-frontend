/**
 * Sentences for the ramp operator console (truthoracle-backend docs/RAMP.md §6.5, §10, §11, §12.2).
 * The person reading them is an operator, so they name the control that refused and what to do
 * next, and where the backend's own message says WHICH condition failed (an order's state, a batch,
 * a statement), it is quoted. Codes the table does not know fall back to lib/backendErrors.ts and
 * then to the server's own message — never through authErrorMessage's wallet-wording rewrites,
 * which would turn a backend "…cancelled…" into "The wallet request was declined". Wallet failures
 * (the decision signature's popup) still go through authErrorMessage.
 */
import { BackendError } from "@/lib/backend";
import { backendErrorMessage } from "@/lib/backendErrors";
import { authErrorMessage } from "@/auth/wallet";
import type { BackendErrorCode } from "@/auth/types";

/** A console-side refusal (a precondition the console checks before calling); its message is final. */
export class RampAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RampAdminError";
  }
}

type Details = Record<string, unknown>;
type Sentence = string | ((details: Details, message: string) => string);
/** Every backend code, plus the ledger relay's own refusal. */
type AdminCode = BackendErrorCode | "relay_write_disabled";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const ref = (d: Details, key: string) => (text(d[key]) ? ` (${String(d[key]).slice(0, 8)})` : "");
/** The backend's own reason, without a prefix it repeats: ": <reason>." — or "." when it gave none. */
function said(message: string, prefix?: string): string {
  let m = message.trim();
  if (prefix && m.toLowerCase().startsWith(prefix)) m = m.slice(prefix.length).trim();
  m = m.replace(/[.\s]+$/, "");
  return m ? `: ${m}.` : ".";
}
/** The first parenthesised part of a backend message: `… (camt053)` → `camt053`. */
const paren = (m: string): string | null => /\(([^)]+)\)/.exec(m)?.[1] ?? null;
const count = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : Array.isArray(v) ? v.length : null;

/** I8 for a market: a person whose accounts hold a position in it neither requests nor approves its resolution. */
export function positionConflictSentence(d: Details): string {
  const person = text(d.person);
  return (
    `${person ? `${person} holds` : "You or the requester hold"} a position in this market (directly or through a linked account), ` +
    "and a person who gains or loses by its outcome may neither request nor approve its resolution. Another person must."
  );
}

/** The treasury wallet's refusal, its own error quoted (a request that ran at once, or an approved one). */
export function walletRefusalSentence(error: string): string {
  return `The treasury wallet did not accept the command${said(error)} The request is closed as failed; reload, and request it again if nothing changed.`;
}

/**
 * Whether a backend message is the treasury wallet's own refusal (`wallet external submit failed
 * (…)`) or the ledger's of what it submitted (`the ledger rejected …`, market.resolve). The other
 * `upstream_failed` messages (the ledger read before submitting, the acquirer, the token-app, the
 * KYC provider) are no wallet refusal: nothing was submitted.
 */
export function isWalletRefusal(message: string): boolean {
  return /^(wallet |the ledger rejected )/i.test(message.trim());
}

/**
 * The wallet's own error on an `approval_failed`: `details.walletError`, or the error of an
 * `upstream_failed` cause that is the wallet's (`isWalletRefusal`); null for any other cause.
 */
function walletErrorOf(d: Details, message: string): string | null {
  const own = text(d.walletError);
  if (own || d.cause !== "upstream_failed") return own;
  const error = message.replace(/^the approved action failed:\s*/i, "");
  return isWalletRefusal(error) ? (text(d.error) ?? text(error)) : null;
}

/** A 503 that says the backend cannot read the ledger at all (unreachable or unconfigured), so nothing vouches for its index. */
const ledgerUnreadable = (message: string) =>
  `The backend cannot read the ledger right now${said(message)} It decides nothing until it can: try again in a minute, and if it keeps failing, its ledger connection needs looking at.`;

const ADMIN_SENTENCES: Partial<Record<AdminCode, Sentence>> = {
  // four-eyes approvals (§6.5)
  approval_pending: (d) =>
    `Another request for this action on the same subject is already pending${ref(d, "approvalId")} with different parameters. Decide or withdraw it under Approvals first.`,
  approval_not_pending: (d) =>
    text(d.status)
      ? `This approval is ${String(d.status)}, no longer pending. Reload Approvals.`
      : "This approval is being decided right now, or is no longer pending. Reload Approvals and try again.",
  approval_expired: "This approval expired (approvals live 2 business days). Request the action again.",
  approval_self: "You requested this, so you cannot approve it. A second person with the approver role must.",
  approval_same_person: (_d, m) => `You may not decide this${said(m)} A second person with the approver role must.`,
  approval_linked_person: (d) =>
    d.reason === "position_in_market"
      ? positionConflictSentence(d)
      : "You or the requester are linked to the account this concerns, so neither of you may decide it.",
  // A conflict of interest, named by `details.reason` (`position_in_market`: the market being resolved).
  approval_conflict: (d, m) =>
    d.reason === "position_in_market" ? positionConflictSentence(d) : `A conflict of interest refuses this${said(m)} Another person must act.`,
  approval_role_required: (d) =>
    text(d.role)
      ? `Deciding this needs the ${String(d.role)} operator role.`
      : "Your operator roles do not allow this decision.",
  // One role (`details.role`), or any of several (`details.roles`, e.g. a market's resolution state: ops or approver).
  role_required: (d) => {
    const roles = Array.isArray(d.roles) ? d.roles.map(text).filter((r): r is string => r !== null) : [];
    if (text(d.role)) return `This needs the ${String(d.role)} operator role.`;
    return roles.length ? `This needs the ${roles.join(" or ")} operator role.` : "Your operator roles do not allow this.";
  },
  approval_signature_required: "This decision must be signed with your operator wallet. Connect it and decide again.",
  approval_signature_invalid: (_d, m) =>
    /no verified key/i.test(m)
      ? "The backend knows no verified wallet key for your operator session. Sign out of the backend and sign in again with your wallet, then decide again."
      : "The wallet signature does not match this decision: another wallet signed, or the subject changed since you were asked. Reload and decide again with the wallet you signed in with.",
  signature_invalid:
    "The wallet signature does not match this decision. Sign with the wallet you signed in to the backend with.",
  approval_precondition_changed: (_d, m) =>
    `The request no longer applies, so it was closed as failed${said(m, "the request no longer applies:")} Request the action again if it is still needed.`,
  approval_failed: (d, m) => {
    const wallet = walletErrorOf(d, m);
    return wallet
      ? walletRefusalSentence(wallet)
      : `The approved action ran and failed${said(m, "the approved action failed:")} Nothing was half-applied; the approval shows the error.`;
  },
  forbidden: "Your operator session or roles do not allow this.",
  validation_failed: (_d, m) => `The backend refused the input${said(m)}`,
  // orders, cards and gates (§4.2, §6.3, §6.4)
  // C25: a retry AML refused names the exit that gives the money back (`details.use`: refund, reverse or fail).
  ramp_order_state: (d, m) =>
    text(d.use) ? `Not possible now${said(m)} Use the order's ${String(d.use)} exit instead.` : `Not possible now${said(m)} Reload and check the current state.`,
  ramp_card_state: (_d, m) => `The card is not in a state for this${said(m)} Reload the order.`,
  // webhook inbox (C31): replay / close of an event that was applied or closed meanwhile
  ramp_event_state: (_d, m) => `The event is no longer open${said(m)} Reload the list: an applied or closed event needs nothing more.`,
  payout_gate: (d) =>
    `The payout gate is closed${text(d.reason) ? ` (${String(d.reason)})` : ""}: a payouts halt, or a stale, red or unknown reconciliation. Run reconciliation and clear the red checks first.`,
  reserve_gate: (d) =>
    `The reserve gate is closed${text(d.reason) ? ` (${String(d.reason)})` : ""}: a mints halt, a stale or red reconciliation, a cap, a stale statement, or reserves that do not cover liabilities.`,
  ramp_paused: "The ramp is halted for this scope. Lifting a halt is a four-eyes resume request.",
  ramp_rail_unavailable: (_d, m) => `The bank rail cannot do this${said(m)}`,
  ramp_unavailable: "The ramp is not configured on this backend.",
  payout_blocked: (d, m) => {
    switch (d.reason) {
      case "ramp_bound":
        return "This withdrawal belongs to a ramp cash-out: only its order may consume it. Resolve it from the order, never by hand.";
      case "ramp_bindable":
        return `The user has a cash-out waiting for its withdrawal${ref(d, "orderId")}; this withdrawal may be that one. Let the order bind it instead of marking it paid.`;
      case "settlement_recorded":
        return "A settlement was already recorded for this payout: the processor resumes it (or use Force settle), so it is never marked paid by hand.";
      case "compliance_hold":
        return "The payee is frozen, or a compliance review holds this payout, so it is never marked paid by hand. Decide it under Compliance first.";
      case "in_flight":
      case "settlement_in_progress":
        return "A settlement of this payout is in flight right now. Wait for it to finish, then reload.";
    }
    if (text(d.cid))
      return "The PendingPayout is no longer live on the ledger (settled or cancelled meanwhile). Reload the queue.";
    return text(d.status)
      ? `The payout is already ${String(d.status)}.`
      : `This payout cannot be settled by hand${said(m)}`;
  },
  // token side (§7)
  token_command_state: (_d, m) =>
    `The command's state does not allow this${said(m)} Resend needs no mirror record and a last POST within 144 h; abandon needs 8 days since the last POST and two clean re-pages.`,
  token_command_conflict: "A token command with this id already exists with different fields.",
  token_app_unconfigured:
    "Cantor8's token-app is not configured on the backend (TOKEN_APP_URL and its Keycloak client).",
  token_app_unauthorized:
    "The token-app refused the backend's credentials even after a refresh. Check the token-app Keycloak client.",
  token_app_forbidden: "The token-app refused this command (403). It is definitive; nothing is retried.",
  token_app_invalid_request:
    "The token-app refused the command as invalid. Nothing was minted or burned; check the amount and the party.",
  token_app_cap: (_d, m) =>
    `A token-app cap refuses this amount${said(m)} Split it, or have the per-call / per-day caps raised.`,
  instrument_unknown: "The instrument is not in the catalog.",
  instrument_disabled: "The instrument is disabled in the catalog.",
  // bank rail (§10)
  batch_state: (d, m) => {
    const skipped = count(d.skipped);
    return `The batch cannot do this now${said(m)}${skipped ? ` ${skipped} queued order(s) were left out (held, frozen, linked to you, or their account is not usable).` : ""}`;
  },
  batch_held: (d) => {
    const held = Array.isArray(d.held)
      ? d.held.map((h) => text((h as Details)?.orderId)).filter((x): x is string => !!x)
      : [];
    return `An order in this batch is on hold (a freeze, a compliance decision or a chargeback)${
      held.length ? `: ${held.map((x) => x.slice(0, 8)).join(", ")}` : ""
    }. The batch can be neither downloaded nor submitted; void or cancel it to release the rest.`;
  },
  batch_export_mismatch:
    "Re-exporting produced a different file than the first export. Do not send it; void the batch instead.",
  statement_mismatch: (_d, m) =>
    /same kind of file/i.test(m)
      ? `Your copy must be the same kind of file as the uploaded statement${paren(m) ? ` (${paren(m)})` : ""}. Download that format from the bank and confirm with it.`
      : /own copy/i.test(m)
        ? "Confirm with your own copy of the statement: upload the file you downloaded from the bank yourself."
        : "Your copy does not parse to the same statement (account, period, balances or a line differ). Download it from the bank again; do not confirm.",
  statement_continuity: (_d, m) =>
    `The statement does not continue the last confirmed one${said(m)} Import the missing period first.`,
  statement_account: "The statement is not for the client-money account.",
  statement_duplicate: "This statement (or one of its lines) was imported or confirmed already.",
  statement_invalid: (_d, m) => `The file could not be used as that statement${said(m)}`,
  bank_line_state: (_d, m) => `This bank line cannot be booked that way now${said(m)} Reload the lines.`,
  bank_account_invalid: (_d, m) => `The bank account is not valid for this${said(m)}`,
  // compliance (§11)
  compliance_alert_state: (_d, m) =>
    `The alert cannot take this decision${said(m)} Open alerts take any decision; escalated ones clear, report or return; reported ones clear or return; cleared and returned are final. Only an alert that holds an order's payment can return it.`,
  export_range: "An export covers at most 31 days.",
  screening_list_invalid: (d, m) =>
    `The list file could not be read${typeof d.line === "number" ? ` (line ${d.line})` : ""}${said(m)} It must be the normalised CSV (kind,name_variants,birth_date,ids).`,
  screening_list_exists: "This version of the list was imported already. A new delivery needs its own version.",
  screening_hit_state: (_d, m) =>
    `This hit was decided already${said(m)} Only a confirmed foreign-list hit can still be cleared; a domestic freeze ends with the four-eyes lift.`,
  screening_hits_open: (d) => {
    const n = count(d.openHits);
    return `Open list hits still hold this account${n ? ` (${n})` : ""}. Decide them under Screening first; clearing the last one lifts a provisional freeze by itself.`;
  },
  rescreen_running: "A re-screen is already running. Wait for it to finish (see Re-screens).",
  freeze_active: (d) =>
    `This account already has an active freeze${ref(d, "freezeId")}. Keep that one, or lift it first.`,
  freeze_state: "The freeze is no longer active (lifted meanwhile). Reload the freezes.",
  kyc_identity_unavailable: (d, m) =>
    /no stored verified identity/i.test(m)
      ? `Account ${text(d.userId) ? String(d.userId).slice(0, 8) : "?"} has no stored verified identity${
          text(d.orderId) ? ` (order ${String(d.orderId).slice(0, 8)})` : ""
        }, so the register would be incomplete: nothing was exported. Check that account's KYC before exporting this period.`
      : `The verified identity could not be read from the KYC provider right now${text(d.userId) ? ` (account ${String(d.userId).slice(0, 8)})` : ""}. Try again shortly.`,
  // KYC override (C22)
  kyc_duplicate_identity:
    "Another account already holds this verified identity, so it cannot be approved here. Resolve the duplicate first (the KYC duplicates queue).",
  user_suspended: (_d, m) => `The account is suspended or closed${said(m)}`,
  bad_request: (_d, m) => `The backend refused this${said(m)}`,
  // market resolution (review F0): the backend's sentence names the market and the check that failed
  market_not_resolvable: (d, m) => {
    const reason = text(d.reason) ?? "";
    const sources = Array.isArray(d.sources) ? d.sources.map(text).filter((s): s is string => s !== null) : [];
    const next =
      reason === "not_expired" || reason === "grace_not_elapsed"
        ? "Request it once that time has passed."
        : reason === "window_closed" || reason === "operator_resolution_off"
          ? "Resolve it from attestations, or void it once the grace period is over."
          : reason === "source_not_allowed"
            ? `Name one of the market's sources${sources.length ? `: ${sources.join(", ")}` : ""}.`
            : reason.startsWith("attestation_")
              ? "Reload the market and request again with attestations of this market, from its sources, read inside the window."
              : reason === "no_tier" || reason === "attestations_disagree"
                ? "Wait for attestations that satisfy a tier and agree, or void the market once the grace period is over."
                : reason === "ledger_ambiguous"
                  ? "The backend will not choose between them, and a reload changes nothing: have an engineer look at the ledger first."
                  : "Reload the market.";
    return `The market cannot be resolved that way now${said(m)} ${next}`;
  },
  // 503: the index lags the ledger end (`details.lag`), or the backend cannot read the ledger at all (no lag to report).
  ledger_stale: (d, m) =>
    typeof d.lag === "number"
      ? `The backend's ledger index is behind the ledger, so it decides nothing now${said(m)} Try again in a moment.`
      : ledgerUnreadable(m),
  not_ready: (_d, m) => `The backend is not ready for this${said(m)}`,
  // relays and limits
  relay_write_disabled:
    "The browser relay no longer signs treasury money moves. Use the console's approval-backed action instead.",
  body_too_large:
    "The file is too large for the relay. The backend accepts at most 5 MB, and on Vercel a request above about 3.3 MB of file cannot pass.",
  rate_limited: "Too many exports or imports this hour (per operator: exports 10/h, imports 20/h). Wait and try again.",
  not_found: "Not found. It may have moved on, or this backend does not have the route yet.",
};

/** One sentence for whatever a console call or decision threw. */
export function rampAdminErrorMessage(e: unknown): string {
  if (e instanceof RampAdminError) return e.message;
  if (e instanceof BackendError) {
    const details = e.details && typeof e.details === "object" ? (e.details as Details) : {};
    const code = String(e.code) as AdminCode;
    const sentence =
      ADMIN_SENTENCES[code] ?? (code.startsWith("reserve_gate:") ? ADMIN_SENTENCES.reserve_gate : undefined);
    if (sentence) return typeof sentence === "function" ? sentence(details, e.message) : sentence;
    // A 503 under a code this table does not know that names the ledger: the backend cannot read it.
    if (e.status === 503 && /ledger/i.test(code)) return ledgerUnreadable(e.message);
    return backendErrorMessage(e);
  }
  return authErrorMessage(e);
}

/** For tests and the console's own checks: whether a code has an operator sentence. */
export function hasRampAdminSentence(code: string): boolean {
  return code in ADMIN_SENTENCES;
}
