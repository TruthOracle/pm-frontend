/**
 * In-app UserWallet orchestration.
 *
 * Deposit: the user's ONLY signature is a real token transfer to the admin treasury
 * (Cantor8 / any Canton wallet popup), in the instrument they picked. The accounts backend
 * then attributes the inbound — read from its ledger index per (linked wallet, instrument)
 * — to whichever linked wallet sent it and credits the account's PRIMARY UserWallet for
 * that instrument — treasury-signed, create-on-first-deposit (ARCHITECTURE.md §8.3) — and
 * we poll the participant until the credit shows.
 *
 * Withdraw: the user signs UserWallet.Withdraw on the wallet of one instrument (debits the
 * balance, queues a PendingPayout that carries the instrument), then the backend settles it
 * — KYC-gated (§9.4): a real transfer out through the treasury, MarkPaid to archive the row.
 *
 * Both money flows REQUIRE a signed-in account. An on-ledger UserWallet exists only
 * because the backend created it for an account's primary party — one per instrument
 * (docs/TOKENS.md §2.1) — so for a party without an account there is nothing to credit or
 * debit; the UI never offers these flows anonymously. Trades never touch this module:
 * Buy/Sell/Split/Merge/liquidity/bonds debit/credit the UserWallet of the market's
 * collateral inside the market choice itself and stay wallet-signed.
 */

import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { WALLET_DISPLAY_NAME } from "@/config";
import { buildWalletWithdrawParams } from "@/utils/cantonCommands";
import {
  fetchPendingPayouts,
  fetchUserWallet,
  fetchUserWallets,
  waitForUserWallet,
  type UserWalletRecord,
} from "@/utils/activeContracts";
import { enterpriseWalletPartyId } from "@/lib/enterpriseWalletSubmit";
import { backendFetch, isBackendError } from "@/lib/backend";
import { backendErrorMessage, type ErrorSentences } from "@/lib/backendErrors";
import {
  formatMoney,
  instrumentKey,
  quantizeAmount,
  sameInstrument,
  walletInstrumentId,
  type ApiInstrument,
  type InstrumentId,
  type InstrumentRef,
} from "@/lib/instruments";
import type { LedgerWallet, Money, Payout, Wallet } from "@/auth/types";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Accounts-backend views (session required)
// ---------------------------------------------------------------------------

/**
 * One instrument's row of the account's in-app balance (API.md → In-app wallet): the primary
 * party's UserWallet for it (null before the first deposit or grant) and the deposit attribution
 * the treasury keeps for it. `delta = ledgerDeposited − creditedTotal`; anything beyond the
 * ledger's precision makes the next reconcile answer `409 deposit_attribution_drift`.
 */
export interface InAppBalance {
  instrument: InstrumentRef;
  ledger: LedgerWallet | null;
  attribution: { creditedTotal: Money; ledgerDeposited: Money; delta: Money };
}

/** `GET /api/v1/in-app-wallet` (API.md → In-app wallet). */
export interface InAppWalletView {
  partyId: string | null;
  wallets: Wallet[];
  /** One row per instrument the account holds a wallet for, plus the default collateral and the rewards instrument. */
  balances: InAppBalance[];
  pending: { submitted: number };
  payouts: Payout[];
}

/** `POST /api/v1/in-app-wallet/deposits/reconcile` success body. */
export interface ReconcileResult {
  /** The instrument reconciled — what `credited`, `perWallet[].amount` and `ledger` are in. */
  instrument: InstrumentRef;
  credited: Money;
  status: "confirmed" | "submitted" | "nothing_outstanding";
  commandId?: string;
  perWallet: { walletId: string; partyId: string; amount: Money }[];
  ledger: LedgerWallet | null;
}

export function fetchInAppWalletView(): Promise<InAppWalletView> {
  return backendFetch<InAppWalletView>("/api/v1/in-app-wallet");
}

/**
 * The wire's `LedgerWallet` (10-dp Money strings, read by the backend as the treasury) as the
 * `UserWalletRecord` the components and the deposit / withdraw flows work with (numbers, read
 * from the participant). `admin` is the treasury, which the index does not repeat per wallet.
 * `Number()` is display-only here, like everywhere a Money string becomes a figure.
 */
export function ledgerWalletToRecord(w: LedgerWallet): UserWalletRecord {
  return {
    contractId: w.contractId,
    admin: enterpriseWalletPartyId(),
    owner: w.owner,
    instrument: w.instrument,
    balance: Number(w.balance),
    deposited: Number(w.deposited),
    withdrawn: Number(w.withdrawn),
    creditRefs: w.creditRefs ?? [],
  };
}

/**
 * The account's in-app position across instruments: every instrument the backend lists a row
 * for (the default collateral and the rewards instrument even before a wallet exists, plus any
 * instrument the account holds a wallet in) and the wallets that exist among them.
 */
export interface AccountBalances {
  instruments: InstrumentRef[];
  wallets: UserWalletRecord[];
}

/**
 * The balances behind the wallet card. The backend's view (`GET /in-app-wallet`) is the primary
 * read: it is taken from the ledger index as the treasury, so it answers for an external party
 * whose own participant reads come back empty (mainnet), and it already names the instruments
 * the card must show. When the backend does not answer the participant is read directly for the
 * party's UserWallets — fewer rows, same figures — so a backend hiccup degrades the card
 * instead of blanking it.
 */
export async function fetchAccountBalances(party: string): Promise<AccountBalances> {
  try {
    const view = await fetchInAppWalletView();
    const wallets = view.balances.flatMap((b) => (b.ledger ? [ledgerWalletToRecord(b.ledger)] : []));
    return { instruments: view.balances.map((b) => b.instrument), wallets };
  } catch {
    const wallets = await fetchUserWallets(party);
    return { instruments: wallets.map((w) => w.instrument), wallets };
  }
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
  ledger_stale: "The treasury's ledger index is catching up. Your transfer is safe; the credit follows in a moment.",
};

export function moneyErrorMessage(e: unknown): string {
  if (isBackendError(e, "payout_blocked")) return payoutBlockedSentence(readDetailStatus(e.details));
  if (isBackendError(e, "deposit_attribution_drift")) return depositDriftSentence(readDetailKind(e.details));
  return backendErrorMessage(e, MONEY_SENTENCES);
}

/** `details.kind` of a 409 deposit_attribution_drift (API.md → In-app wallet). */
export type DepositDriftKind =
  | "over_credit"
  | "ledger_below_expected"
  | "ledger_above_expected"
  | "duplicate_user_wallet";

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
      return "Your in-app wallet holds more than the treasury's records account for, so automatic crediting is paused until support reconciles it. Your funds are safe.";
    case "duplicate_user_wallet":
      return "Your party has more than one in-app wallet for this instrument on the ledger, so automatic crediting is paused until support merges them. Your funds are safe.";
    case "over_credit":
    case "ledger_below_expected":
    default:
      return "The deposit could not be credited automatically because the treasury's records and your wallet disagree. Your funds are safe — support has been notified and will credit it manually.";
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

/** What the external wallet is asked to send: `instrumentId` is the wallet SDK's own id for the token. */
export interface TransferArgs {
  to: string;
  instrumentId: string;
  amount: number;
  memo?: string;
  metadata?: Record<string, string>;
}

/** The sentence a deposit control carries for a token the connected wallet does not list (docs/TOKENS.md §5). */
export function walletMissingInstrumentSentence(instrument: Pick<InstrumentRef, "symbol">): string {
  return `Your ${WALLET_DISPLAY_NAME} wallet does not list ${instrument.symbol} yet`;
}

/**
 * Why a deposit in `instrument` must not be offered, given what the connected wallet says it can
 * send (`listInstruments()`): the sentence above when the list is known and lacks the token's
 * wallet id, null when it is listed. A list that is NOT known (null — the wallet did not answer)
 * never blocks: the wallet itself refuses a token it cannot send, and a flaky lookup must not
 * take deposits down with it.
 */
export function missingWalletInstrumentReason(
  walletInstruments: readonly { instrumentId: string }[] | null | undefined,
  instrument: Pick<ApiInstrument, "id" | "symbol" | "walletInstrumentId">,
): string | null {
  if (!walletInstruments) return null;
  const id = walletInstrumentId(instrument);
  return walletInstruments.some((w) => w.instrumentId === id) ? null : walletMissingInstrumentSentence(instrument);
}

export interface DepositArgs {
  /**
   * Party whose UserWallet receives the credit: the account's PRIMARY party — even
   * when a different linked wallet signs the transfer (ARCHITECTURE.md §16 state B).
   */
  userParty: string;
  /**
   * The catalog entry being deposited: its identity selects the wallet and the reconcile,
   * `walletInstrumentId` is what the Cantor8 SDK's `send()` expects, symbol and decimals
   * label the memo.
   */
  instrument: ApiInstrument;
  amount: number;
  /** Bound transfer from the wallet context — signs the real token transfer. */
  transfer: (args: TransferArgs) => Promise<{ txId: string }>;
  /**
   * What the connected wallet lists (`listInstruments()`), when the caller has it: a token
   * missing from it is refused here, before any popup, with `walletMissingInstrumentSentence`.
   */
  walletInstruments?: readonly { instrumentId: string }[] | null;
}

/** How long we keep asking the backend to reconcile / wait for its deposit lock. */
const RECONCILE_WINDOW_MS = 30_000;

/**
 * Thrown when the transfer has already reached the treasury but the credit step did not
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
 * without moving more tokens. The server re-derives what is owed in `instrument` (the
 * default collateral when omitted) from its ledger index, so this never tells it an
 * amount. Three things make the first call after a transfer come back empty-handed and
 * all are transient: the index may not have folded the inbound yet (`nothing_outstanding`),
 * it may lag the ledger end beyond what the backend accepts (`503 ledger_stale`), or
 * another tab / the confirm pass still holds the deposit lock (`deposit_in_progress`).
 * Each is retried inside one bounded window; anything else is a real answer. Exported so
 * the wallet card and the Account page can offer "credit pending deposits" on its own.
 */
export async function creditPendingDeposits(opts?: {
  windowMs?: number;
  instrument?: InstrumentId;
}): Promise<ReconcileResult> {
  const deadline = Date.now() + (opts?.windowMs ?? RECONCILE_WINDOW_MS);
  // No body at all for the default collateral: the server picks it, the browser names nothing.
  const body = opts?.instrument ? { instrument: { admin: opts.instrument.admin, id: opts.instrument.id } } : undefined;
  for (;;) {
    try {
      const res = await backendFetch<ReconcileResult>("/api/v1/in-app-wallet/deposits/reconcile", {
        method: "POST",
        body,
      });
      if (res.status !== "nothing_outstanding" || Date.now() >= deadline) return res;
      await sleep(3_000);
    } catch (e) {
      if (isBackendError(e, "deposit_in_progress")) {
        await waitForDepositLock(deadline);
        if (Date.now() >= deadline) throw new DepositCreditPendingError(moneyErrorMessage(e));
        continue;
      }
      if (isBackendError(e, "ledger_stale")) {
        if (Date.now() >= deadline) throw new DepositCreditPendingError(moneyErrorMessage(e));
        await sleep(3_000);
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
  /** Latest wallet record the participant showed for the instrument (null if the party has none yet). */
  wallet: UserWalletRecord | null;
  /** The balance moved up by the deposited amount within the polling window. */
  credited: boolean;
  /**
   * The transfer reached the treasury but the credit is not visible yet: the backend found
   * nothing outstanding within its window (index lag) or the treasury-signed credit
   * is still in flight. Offer `creditPendingDeposits` — never another transfer.
   */
  pending: boolean;
  /** The backend's reconcile answer. */
  reconcile: ReconcileResult;
}

/**
 * Run a deposit end-to-end. Throws before any token moves for bad input; after the
 * transfer it throws only `DepositCreditPendingError` (the tokens are safe in the
 * treasury) and otherwise reports whether the credit landed.
 */
export async function depositToInAppWallet(args: DepositArgs): Promise<DepositOutcome> {
  const admin = enterpriseWalletPartyId();
  if (!admin) {
    throw new Error("VITE_ENTERPRISE_WALLET_PARTY_ID is not set — can't address the treasury.");
  }
  if (!(args.amount > 0)) throw new Error("Deposit amount must be positive");
  const { instrument } = args;
  const missing = missingWalletInstrumentReason(args.walletInstruments, instrument);
  if (missing) throw new Error(missing);

  // The balance we compare against afterwards is READ WITHOUT AWAITING here: the wallet
  // popup must open in the click's user activation, and a browser grants that only while
  // nothing has been awaited in front of it (frontend/wallets/cantor8/popupGesture.ts —
  // WebKit in particular does not carry the gesture through `response.json()`). Advisory
  // only: a failed read just means the balance target falls back to zero.
  const beforePromise = fetchUserWallet(args.userParty, instrument).catch(() => null);

  // 1. Real tokens to the treasury — the user's only signature, in the wallet's own id for the
  //    token. The memo is what the person reads in the popup and later in their wallet history;
  //    the metadata is what the treasury's index can key on (amount and instrument, no suffix).
  await args.transfer({
    to: admin,
    instrumentId: walletInstrumentId(instrument),
    amount: args.amount,
    memo: `TruthOracle: deposit ${formatMoney(args.amount, instrument)} to in-app wallet`,
    metadata: { kind: "truthoracle_deposit", amount: String(args.amount), instrument: instrumentKey(instrument) },
  });

  // 2. The backend attributes the inbound to whichever linked wallet sent it and
  //    credits the account's primary UserWallet for this instrument (§8.3).
  const reconcile = await creditPendingDeposits({ instrument });
  if (reconcile.status === "nothing_outstanding") {
    // The index never showed the inbound inside the window. Nothing was submitted, so
    // the wallet will not change on its own — do not sit on the ledger for another 30 s
    // pretending it might.
    return { wallet: await fetchUserWallet(args.userParty, instrument), credited: false, pending: true, reconcile };
  }

  // 3. Wait until the participant shows the credited balance. The tolerance is half a unit
  //    of the instrument's own precision — never coarser than what was sent.
  const before = await beforePromise;
  const target = (before?.balance ?? 0) + args.amount;
  const tolerance = 10 ** -Math.min(10, Math.max(0, instrument.decimals)) / 2;
  const reached = (w: UserWalletRecord | null) => (w?.balance ?? 0) >= target - tolerance;
  const wallet = await waitForUserWallet(args.userParty, instrument, reached);
  const credited = reached(wallet);
  return { wallet, credited, pending: !credited, reconcile };
}

// ---------------------------------------------------------------------------
// Withdraw / settle
// ---------------------------------------------------------------------------

export interface WithdrawArgs {
  userParty: string;
  /** The instrument being withdrawn: names the wallet's token and the PendingPayout to watch for. */
  instrument: InstrumentRef;
  amount: number;
  /** The UserWallet of that instrument. */
  walletContractId: string;
  /** Bound signAndSubmitTransaction from the wallet context (signs Withdraw). */
  signAndSubmitTransaction: (p: PrepareExecuteParams) => Promise<{ hash: string }>;
}

export type SettleMode = "external" | "in_app" | "already_settled";

/** Outcome of asking the backend to settle one payout (`POST …/payouts/:cid/settle`). */
export interface SettleOutcome {
  /** True once the transfer + MarkPaid (or SettleToWallet) completed. */
  settled: boolean;
  /** How it settled: real tokens out (`external`) or credited in-app (`in_app`, bond / model-prize per §9.4). */
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
  /** What was actually asked for: the input floored to the instrument's decimals. */
  amount: number;
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
    const settled = res.mode === "already_settled" || status === "settled_external" || status === "settled_in_app";
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
 * Run a withdrawal end-to-end. The amount is floored to the instrument's decimals first —
 * the treasury quantises the same way before a transfer leaves and keeps any dust in-app,
 * so what is debited is exactly what can be sent. If the settlement step fails the funds
 * stay safe: the balance debit and the PendingPayout are atomic, and the payout remains
 * queued for the backend's processor (or can be canceled back into the balance).
 */
export async function withdrawFromInAppWallet(args: WithdrawArgs): Promise<WithdrawResult> {
  const amount = quantizeAmount(args.amount, args.instrument.decimals);
  if (!(amount > 0))
    throw new Error(
      `Withdrawal amount must be positive (${args.instrument.symbol} has ${args.instrument.decimals} decimals)`,
    );

  // Which payouts existed BEFORE this withdrawal, so the new one can be told apart.
  // Started but not awaited: the wallet popup must open inside the click's user
  // activation, which an awaited read in front of it would spend
  // (frontend/wallets/cantor8/popupGesture.ts). An empty set on failure is safe — step 2
  // then falls back to matching on reason and instrument.
  const beforePromise = fetchPendingPayouts(args.userParty)
    .then((list) => new Set(list.filter((p) => p.user === args.userParty).map((p) => p.contractId)))
    .catch(() => new Set<string>());

  // 1. User signs Withdraw (debit + PendingPayout, atomically).
  await args.signAndSubmitTransaction(buildWalletWithdrawParams(args.userParty, args.walletContractId, amount));
  const beforeCids = await beforePromise;

  // 2. Find the fresh "withdraw" payout for this instrument on the participant.
  const deadline = Date.now() + 15_000;
  let fresh: { contractId: string; amount: number } | null = null;
  while (Date.now() < deadline && !fresh) {
    const list = await fetchPendingPayouts(args.userParty);
    fresh =
      list.find(
        (p) =>
          p.user === args.userParty &&
          p.reason === "withdraw" &&
          sameInstrument(p.instrument, args.instrument) &&
          !beforeCids.has(p.contractId),
      ) ?? null;
    if (!fresh) await sleep(1_000);
  }
  if (!fresh) return { settled: false, amount };

  // 3. KYC and wallet-status gates live server-side (§9.4); a blocked row stays queued
  //    and is re-tried when the gate clears.
  const outcome = await settlePayoutWithBackend(fresh.contractId);
  return { ...outcome, pendingPayoutCid: fresh.contractId, amount };
}
