/**
 * In-app UserWallet orchestration (v13 architecture).
 *
 * Deposit: the user's ONLY signature is a real CC transfer to the admin
 * treasury (Cantor8 / any Canton wallet popup). The Enterprise Wallet then
 * credits the on-ledger UserWallet balance (create-on-first-deposit), and we
 * poll the participant until the credit shows.
 *
 * Withdraw: the user signs UserWallet.Withdraw (debits the balance, queues a
 * PendingPayout), then the Enterprise Wallet auto-settles it — real CC out,
 * MarkPaid to archive the row.
 *
 * Trades never touch this module: Buy/Sell/Split/Merge/liquidity/bonds
 * debit/credit the UserWallet inside the market choice itself.
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
import { runAdminAutoPayout } from "@/lib/adminAutoPayout";

/** "10" not "10.00", "10.5" not "10.50" — wallet memos read better without forced decimals. */
function formatCC(amount: number): string {
  return amount.toFixed(2).replace(/\.?0+$/, "");
}

export interface DepositArgs {
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

export interface DepositResult {
  /** Latest wallet record seen (null if none exists yet). */
  wallet: UserWalletRecord | null;
  /** True once the wallet reflects this deposit. False = CC sent, credit still pending. */
  credited: boolean;
}

// The server credits only what the ledger shows the user has sent. The popup reports
// "sent" before the participant has indexed the transaction, so the first reconcile
// can legitimately find nothing — keep asking for a while.
const RECONCILE_WINDOW_MS = 60_000;
const RECONCILE_INTERVAL_MS = 4_000;

async function reconcileDeposit(userPartyId: string): Promise<number> {
  const res = await fetch("/api/wallet/deposit", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userPartyId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Deposit reconciliation failed (${res.status}): ${text.slice(0, 900)}`);
  }
  const body = (await res.json().catch(() => ({}))) as { credited?: number };
  return Number(body?.credited ?? 0);
}

/**
 * Run a deposit end-to-end. Resolves once the wallet reflects the deposit, or —
 * after the reconcile window — with `credited: false` while the CC is already in
 * the treasury and the credit is picked up by a later reconcile.
 */
export async function depositToInAppWallet(args: DepositArgs): Promise<DepositResult> {
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

  // 2. Ask the server to reconcile. It credits exactly the transfers the LEDGER shows
  //    from this party that the wallet has not recorded yet, so the amount we just
  //    transferred is never something the browser asserts. This replaced a direct
  //    admin-signed credit through the open wallet proxy, which let anyone mint
  //    balance by POSTing a credit they never paid for. Retry while the participant
  //    catches up with the transfer the popup just reported.
  const target = (before?.balanceCC ?? 0) + args.amountCC;
  const reached = (w: UserWalletRecord | null) => (w?.balanceCC ?? 0) >= target - 1e-6;
  const deadline = Date.now() + RECONCILE_WINDOW_MS;
  for (;;) {
    const creditedCC = await reconcileDeposit(args.userParty);
    if (creditedCC > 0) break;
    // Nothing outstanding: either an earlier call already credited it, or the
    // participant has not indexed the transfer yet.
    const current = await fetchUserWallet(args.userParty);
    if (reached(current)) return { wallet: current, credited: true };
    if (Date.now() >= deadline) return { wallet: current, credited: false };
    await new Promise((r) => setTimeout(r, RECONCILE_INTERVAL_MS));
  }

  // 3. Wait until the participant shows the credited balance.
  const wallet = await waitForUserWallet(args.userParty, reached);
  return { wallet, credited: reached(wallet) };
}

export interface WithdrawArgs {
  userParty: string;
  amountCC: number;
  walletContractId: string;
  /** Bound signAndSubmitTransaction from the wallet context (signs Withdraw). */
  signAndSubmitTransaction: (p: PrepareExecuteParams) => Promise<{ hash: string }>;
}

export interface WithdrawResult {
  /** True once the admin transfer + MarkPaid completed; false = payout still queued. */
  settled: boolean;
}

/**
 * Run a withdrawal end-to-end. If the auto-settlement step fails the CC stays
 * safe: the balance debit and the PendingPayout are atomic, and the payout
 * remains queued for the admin (or can be canceled back into the balance).
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
    if (!fresh) await new Promise((r) => setTimeout(r, 1_000));
  }
  if (!fresh) return { settled: false };

  // 3. Admin sends real CC and marks the payout paid. The amount and payee come from
  //    the contract server-side, so nothing here can influence what gets paid.
  const result = await runAdminAutoPayout({ pendingPayoutCid: fresh.contractId });
  return { settled: result.settled };
}
