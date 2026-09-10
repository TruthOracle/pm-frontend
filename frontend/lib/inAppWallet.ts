/**
 * In-app UserWallet orchestration.
 *
 * Deposit: the user's ONLY signature is a real CC transfer to the admin treasury
 * (Cantor8 / any Canton wallet popup). The accounts backend then attributes the inbound
 * to whichever linked wallet sent it and credits the account's PRIMARY UserWallet —
 * treasury-signed, create-on-first-deposit (ARCHITECTURE.md §8.3) — and we poll the
 * participant until the credit shows.
 *
 * Withdraw: the user signs UserWallet.Withdraw (debits the balance, queues a
 * PendingPayout), then the backend settles it — KYC-gated (§9.4): real CC out, MarkPaid
 * to archive the row.
 *
 * Both money flows REQUIRE a signed-in account. The on-ledger UserWallet exists only
 * because the backend created it for an account's primary wallet, so for a party
 * without an account there is nothing to credit or debit; the UI never offers these
 * flows anonymously. Trades never touch this module: Buy/Sell/Split/Merge/liquidity/
 * bonds debit/credit the UserWallet inside the market choice itself and stay
 * wallet-signed.
 */

import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { buildWalletWithdrawParams } from "@/utils/cantonCommands";
import {
  fetchPendingPayouts,
  fetchUserWallet,
  waitForUserWallet,
  type UserWalletRecord,
} from "@/utils/activeContracts";
import { enterpriseWalletPartyId } from "@/lib/enterpriseWalletSubmit";
import { backendFetch, isBackendError } from "@/lib/backend";
import { backendErrorMessage, type ErrorSentences } from "@/lib/backendErrors";
import type { LedgerWallet, Money, Payout, Wallet } from "@/auth/types";

/** "10" not "10.00", "10.5" not "10.50" — wallet memos read better without forced decimals. */
function formatCC(amount: number): string {
  return amount.toFixed(2).replace(/\.?0+$/, "");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Accounts-backend views (session required)
// ---------------------------------------------------------------------------

/** `GET /api/v1/in-app-wallet` (API.md → In-app wallet). */
export interface InAppWalletView {
  partyId: string | null;
  ledger: LedgerWallet | null;
  wallets: Wallet[];
  attribution: { creditedTotalCC: Money; ledgerDepositedCC: Money; delta: Money };
  pending: { submitted: number };
  payouts: Payout[];
}

/** `POST /api/v1/in-app-wallet/deposits/reconcile` success body. */
export interface ReconcileResult {
  credited: Money;
  status: "confirmed" | "submitted" | "nothing_outstanding";
  commandId?: string;
  perWallet: { walletId: string; partyId: string; amountCC: Money }[];
  ledger: LedgerWallet | null;
}

export function fetchInAppWalletView(): Promise<InAppWalletView> {
  return backendFetch<InAppWalletView>("/api/v1/in-app-wallet");
}

export function fetchBackendPayouts(): Promise<Payout[]> {
  return backendFetch<{ payouts: Payout[] }>("/api/v1/in-app-wallet/payouts").then((r) => r.payouts);
}

/**
 * Money-flow flavour of the shared sentence table (lib/backendErrors.ts): the codes a
 * depositor / withdrawer can act on get wording that says what to do next; everything
 * else falls through to the base table. `payout_blocked` carries the blocking status
 * in `details`, so it is resolved here rather than in the static table.
 */
const MONEY_SENTENCES: ErrorSentences = {
  no_primary_wallet: "Your account has no primary wallet yet. Link a wallet on the Account page before depositing.",
  backend_unconfigured: "Accounts are not enabled on this deployment.",
  rate_limited: "Too many requests. Wait a minute and try again.",
};

export function moneyErrorMessage(e: unknown): string {
  if (isBackendError(e, "payout_blocked")) return payoutBlockedSentence(readDetailStatus(e.details));
  if (isBackendError(e, "deposit_attribution_drift")) return depositDriftSentence(readDetailKind(e.details));
  return backendErrorMessage(e, MONEY_SENTENCES);
}

/** `details.kind` of a 409 deposit_attribution_drift (API.md → In-app wallet). */
export type DepositDriftKind = "over_credit" | "ledger_below_expected" | "ledger_above_expected" | "duplicate_user_wallet";

const DRIFT_KINDS: ReadonlySet<string> = new Set<DepositDriftKind>([
  "over_credit",
  "ledger_below_expected",
  "ledger_above_expected",
  "duplicate_user_wallet",
]);

function readDetailKind(details: unknown): DepositDriftKind | undefined {
  if (details && typeof details === "object" && "kind" in details) {
    const k = (details as { kind?: unknown }).kind;
    return typeof k === "string" && DRIFT_KINDS.has(k) ? (k as DepositDriftKind) : undefined;
  }
  return undefined;
}

/**
 * Why the treasury refused to credit (§8.3): drift in EITHER direction between the
 * backend's attribution and the on-ledger UserWallet pauses automatic crediting — there
 * is no silent repair — so the sentence must not promise a credit when the ledger is
 * already ahead.
 */
export function depositDriftSentence(kind: DepositDriftKind | undefined): string {
  switch (kind) {
    case "ledger_above_expected":
      return "Your in-app wallet holds more than the treasury's records account for, so automatic crediting is paused until support reconciles it. Your CC is safe.";
    case "duplicate_user_wallet":
      return "Your party has more than one in-app wallet on the ledger, so automatic crediting is paused until support merges them. Your CC is safe.";
    case "over_credit":
    case "ledger_below_expected":
    default:
      return "The deposit could not be credited automatically because the treasury's records and your wallet disagree. Your CC is safe — support has been notified and will credit it manually.";
  }
}

const PAYOUT_STATUSES: ReadonlySet<string> = new Set<Payout["status"]>([
  "queued",
  "settling",
  "settled_external",
  "settled_in_app",
  "blocked_kyc",
  "blocked_unknown_user",
  "blocked_unknown_reason",
  "blocked_wallet_revoked",
  "failed",
  "archived",
]);

/** Narrow a wire string to the Payout status enum instead of asserting it. */
export function isPayoutStatus(s: unknown): s is Payout["status"] {
  return typeof s === "string" && PAYOUT_STATUSES.has(s);
}

/** `details.status` of a 409 payout_blocked, when it names a status we know. */
function readDetailStatus(details: unknown): Payout["status"] | undefined {
  if (details && typeof details === "object" && "status" in details) {
    const s = (details as { status?: unknown }).status;
    return isPayoutStatus(s) ? s : undefined;
  }
  return undefined;
}

/** Why a payout is parked, in the payee's words (Payout.status values from API.md). */
export function payoutBlockedSentence(status: Payout["status"] | undefined): string {
  switch (status) {
    case "blocked_kyc":
      return "This withdrawal is waiting for identity verification. It settles automatically once you are verified.";
    case "blocked_wallet_revoked":
      return "This payout is addressed to a wallet you have unlinked. Re-link that wallet, or cancel and refund the payout to your in-app balance.";
    case "blocked_unknown_user":
      return "This payout is addressed to a wallet that is not linked to any account. Link it to settle.";
    case "blocked_unknown_reason":
    case "failed":
      return "This payout needs an operator to look at it. Support has been notified.";
    case "settling":
      return "This payout is being sent right now.";
    default:
      return "This payout cannot be settled right now.";
  }
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

export interface DepositArgs {
  /**
   * Party whose UserWallet receives the credit: the account's PRIMARY party — even
   * when a different linked wallet signs the transfer (ARCHITECTURE.md §16 state B).
   */
  userParty: string;
  amountCC: number;
  /** Bound transferCC from the wallet context — signs the real CC transfer. */
  transferCC: (args: {
    to: string;
    amount: number;
    memo?: string;
    metadata?: Record<string, string>;
  }) => Promise<{ txId: string }>;
}

/** How long we keep asking the backend to reconcile / wait for its deposit lock. */
const RECONCILE_WINDOW_MS = 30_000;

/**
 * Thrown when the CC has already reached the treasury but the credit step did not
 * complete (session expired, rate limit, the backend's deposit lock never freed in
 * time, a 5xx). The transfer is safe; the caller should offer a credit-only retry
 * (`creditPendingDeposits`) instead of asking for another transfer.
 */
export class DepositCreditPendingError extends Error {
  readonly creditPending = true;
  constructor(message: string) {
    super(message);
    this.name = "DepositCreditPendingError";
  }
}

export function isDepositCreditPending(e: unknown): e is DepositCreditPendingError {
  return e instanceof DepositCreditPendingError;
}

/**
 * The credit step of a deposit — ARCHITECTURE.md §8.3, and the ONLY way to re-run it
 * without moving more CC. The server re-derives what is owed from the treasury's
 * transfer history, so this never tells it an amount. Two things make the first call
 * after a transfer come back empty-handed and both are transient: the history walk may
 * not show the inbound yet (`nothing_outstanding`), or another tab / the confirm pass
 * still holds the deposit lock (`deposit_in_progress`). Both are retried inside one
 * bounded window; anything else is a real answer. Exported so the wallet card and the
 * Account page can offer "credit pending deposits" on its own.
 */
export async function creditPendingDeposits(opts?: { windowMs?: number }): Promise<ReconcileResult> {
  const deadline = Date.now() + (opts?.windowMs ?? RECONCILE_WINDOW_MS);
  for (;;) {
    try {
      const res = await backendFetch<ReconcileResult>("/api/v1/in-app-wallet/deposits/reconcile", {
        method: "POST",
      });
      if (res.status !== "nothing_outstanding" || Date.now() >= deadline) return res;
      await sleep(3_000);
    } catch (e) {
      if (isBackendError(e, "deposit_in_progress")) {
        await waitForDepositLock(deadline);
        if (Date.now() >= deadline) throw new DepositCreditPendingError(moneyErrorMessage(e));
        continue;
      }
      throw new DepositCreditPendingError(moneyErrorMessage(e));
    }
  }
}

/** Poll `GET /in-app-wallet` until no treasury-signed credit is in flight (or the deadline). */
async function waitForDepositLock(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    await sleep(2_000);
    try {
      const view = await fetchInAppWalletView();
      if (view.pending.submitted === 0) return;
    } catch {
      // A failed read is not a reason to give up on the deposit; the outer loop
      // re-runs reconcile, which is the authoritative check.
      return;
    }
  }
}

export interface DepositOutcome {
  /** Latest wallet record the participant showed (null if the party has none yet). */
  wallet: UserWalletRecord | null;
  /** The balance moved up by the deposited amount within the polling window. */
  credited: boolean;
  /**
   * The CC reached the treasury but the credit is not visible yet: the backend found
   * nothing outstanding within its window (history lag) or the treasury-signed credit
   * is still in flight. Offer `creditPendingDeposits` — never another transfer.
   */
  pending: boolean;
  /** The backend's reconcile answer. */
  reconcile: ReconcileResult;
}

/**
 * Run a deposit end-to-end. Throws before any CC moves for bad input; after the
 * transfer it throws only `DepositCreditPendingError` (the CC is safe in the treasury)
 * and otherwise reports whether the credit landed.
 */
export async function depositToInAppWallet(args: DepositArgs): Promise<DepositOutcome> {
  const admin = enterpriseWalletPartyId();
  if (!admin) {
    throw new Error("VITE_ENTERPRISE_WALLET_PARTY_ID is not set — can't address the treasury.");
  }
  if (!(args.amountCC > 0)) throw new Error("Deposit amount must be positive");

  const before = await fetchUserWallet(args.userParty);

  // 1. Real CC to the treasury — the user's only signature.
  await args.transferCC({
    to: admin,
    amount: args.amountCC,
    memo: `TruthOracle: deposit ${formatCC(args.amountCC)} CC to in-app wallet`,
    metadata: { kind: "truthoracle_deposit", amount_cc: String(args.amountCC) },
  });

  // 2. The backend attributes the inbound to whichever linked wallet sent it and
  //    credits the account's primary UserWallet (§8.3).
  const reconcile = await creditPendingDeposits();
  if (reconcile.status === "nothing_outstanding") {
    // The history walk never showed the inbound inside the window. Nothing was
    // submitted, so the wallet will not change on its own — do not sit on the ledger
    // for another 30 s pretending it might.
    return { wallet: await fetchUserWallet(args.userParty), credited: false, pending: true, reconcile };
  }

  // 3. Wait until the participant shows the credited balance.
  const target = (before?.balanceCC ?? 0) + args.amountCC;
  const reached = (w: UserWalletRecord | null) => (w?.balanceCC ?? 0) >= target - 1e-6;
  const wallet = await waitForUserWallet(args.userParty, reached);
  const credited = reached(wallet);
  return { wallet, credited, pending: !credited, reconcile };
}

// ---------------------------------------------------------------------------
// Withdraw / settle
// ---------------------------------------------------------------------------

export interface WithdrawArgs {
  userParty: string;
  amountCC: number;
  walletContractId: string;
  /** Bound signAndSubmitTransaction from the wallet context (signs Withdraw). */
  signAndSubmitTransaction: (p: PrepareExecuteParams) => Promise<{ hash: string }>;
}

export type SettleMode = "external" | "in_app" | "already_settled";

/** Outcome of asking the backend to settle one payout (`POST …/payouts/:cid/settle`). */
export interface SettleOutcome {
  /** True once the CC transfer + MarkPaid (or SettleToWallet) completed. */
  settled: boolean;
  /** How it settled: real CC out (`external`) or credited in-app (`in_app`, bond / model-prize per §9.4). */
  mode?: SettleMode;
  /** Backend's view of the row after the attempt, when it answered. */
  status?: Payout["status"];
  /** Why it did not settle: "kyc" for the identity gate, the blocking status, or "blocked" when unnamed. */
  blocked?: "kyc" | "blocked" | Payout["status"];
  /** One sentence the UI can show next to "queued". */
  detail?: string;
}

export interface WithdrawResult extends SettleOutcome {
  /** The PendingPayout that was created, when the participant surfaced it in time. */
  pendingPayoutCid?: string;
}

/**
 * Ask the accounts backend to settle a payout. Never throws for a payout that is
 * merely parked (KYC, revoked wallet, not yet indexed) — the Withdraw that created
 * it already committed, and the row waits safely for the gate to clear.
 */
export async function settlePayoutWithBackend(pendingPayoutCid: string): Promise<SettleOutcome> {
  try {
    const res = await backendFetch<{ payout: Payout; mode: SettleMode }>(
      `/api/v1/in-app-wallet/payouts/${encodeURIComponent(pendingPayoutCid)}/settle`,
      { method: "POST" },
    );
    const status = res.payout.status;
    const settled =
      res.mode === "already_settled" || status === "settled_external" || status === "settled_in_app";
    return settled
      ? { settled: true, mode: res.mode, status }
      : { settled: false, mode: res.mode, status, blocked: status, detail: payoutBlockedSentence(status) };
  } catch (e) {
    if (isBackendError(e, "kyc_required")) {
      return { settled: false, status: "blocked_kyc", blocked: "kyc", detail: payoutBlockedSentence("blocked_kyc") };
    }
    if (isBackendError(e, "payout_blocked")) {
      const status = readDetailStatus(e.details);
      return { settled: false, status, blocked: status ?? "blocked", detail: payoutBlockedSentence(status) };
    }
    return { settled: false, detail: moneyErrorMessage(e) };
  }
}

/**
 * Run a withdrawal end-to-end. If the settlement step fails the CC stays safe: the
 * balance debit and the PendingPayout are atomic, and the payout remains queued for
 * the backend's processor (or can be canceled back into the balance).
 */
export async function withdrawFromInAppWallet(args: WithdrawArgs): Promise<WithdrawResult> {
  if (!(args.amountCC > 0)) throw new Error("Withdrawal amount must be positive");

  const beforeCids = new Set(
    (await fetchPendingPayouts(args.userParty))
      .filter((p) => p.user === args.userParty)
      .map((p) => p.contractId),
  );

  // 1. User signs Withdraw (debit + PendingPayout, atomically).
  await args.signAndSubmitTransaction(
    buildWalletWithdrawParams(args.userParty, args.walletContractId, args.amountCC),
  );

  // 2. Find the fresh "withdraw" payout on the participant.
  const deadline = Date.now() + 15_000;
  let fresh: { contractId: string; amountCC: number } | null = null;
  while (Date.now() < deadline && !fresh) {
    const list = await fetchPendingPayouts(args.userParty);
    fresh =
      list.find(
        (p) => p.user === args.userParty && p.reason === "withdraw" && !beforeCids.has(p.contractId),
      ) ?? null;
    if (!fresh) await sleep(1_000);
  }
  if (!fresh) return { settled: false };

  // 3. KYC and wallet-status gates live server-side (§9.4); a blocked row stays queued
  //    and is re-tried when the gate clears.
  const outcome = await settlePayoutWithBackend(fresh.contractId);
  return { ...outcome, pendingPayoutCid: fresh.contractId };
}
