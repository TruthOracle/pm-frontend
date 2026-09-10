/**
 * Admin-side CC auto-payout for Sell / Merge / Resolve / withdraw.
 *
 * After a user-signed choice creates a PendingPayout contract, the frontend asks the
 * server to settle it: send real CC to the payee and exercise MarkPaid to archive the
 * row. The admin is "always on" in this model — exactly what the Cantor8 Enterprise
 * Wallet is designed for — so the user's experience stays automatic: one signature for
 * the Sell/Merge/Withdraw choice, then CC arrives a moment later.
 *
 * This used to POST `to` and `transferAmount` straight to the wallet proxy's
 * /api/v1/transfer, which signed with the treasury key and authenticated nobody: a
 * single crafted request could send any amount to any party. Both values now come from
 * the on-ledger PendingPayout, so the contract itself is the authorisation and the
 * caller supplies nothing but its id.
 */

export interface AutoPayoutArgs {
  /** PendingPayout contract id to settle and then archive. */
  pendingPayoutCid: string;
}

export interface AutoPayoutResult {
  /** False when the payout was already settled or cancelled — not an error. */
  settled: boolean;
  /** Amount the server actually paid, read from the contract. */
  amountCC?: number;
  /** Party the server actually paid, read from the contract. */
  to?: string;
  transferCommandId?: string;
}

function retiredMessage(text: string): string {
  try {
    const data = JSON.parse(text) as { message?: unknown };
    if (typeof data.message === "string" && data.message) return data.message;
  } catch {
    // Not JSON — fall through to the generic sentence.
  }
  return "Payout settlement moved to the TruthOracle backend; this legacy path no longer settles it.";
}

/**
 * Settle one payout. Throws only when the server could not complete the attempt;
 * callers should leave the PendingPayout in place on failure so it can be retried
 * (the amount is re-derived each time, so a retry cannot double-pay).
 */
export async function runAdminAutoPayout(args: AutoPayoutArgs): Promise<AutoPayoutResult> {
  if (!args.pendingPayoutCid) throw new Error("pendingPayoutCid is required to settle a payout");

  const res = await fetch("/api/wallet/settle-payout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingPayoutCid: args.pendingPayoutCid }),
  });

  const text = await res.text();
  if (!res.ok) {
    // ARCHITECTURE.md §18: with an accounts backend configured this route answers
    // 410 moved_to_backend for every caller and reason — the backend's payout
    // processor settles those rows itself. Its message says where settlement now
    // happens — show that sentence, not the raw envelope.
    if (res.status === 410) throw new Error(retiredMessage(text));
    throw new Error(`Payout settlement failed (${res.status}): ${text.slice(0, 900)}`);
  }

  try {
    const data = JSON.parse(text) as AutoPayoutResult;
    return { settled: Boolean(data.settled), amountCC: data.amountCC, to: data.to, transferCommandId: data.transferCommandId };
  } catch {
    return { settled: true };
  }
}
