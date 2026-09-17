/**
 * What the deposit reconciliation should credit, derived purely from ledger facts
 * (see ledgerClient.incomingTransfersFromLedger) and the user's current UserWallet.
 * Pure so the money arithmetic is unit-tested without a ledger.
 *
 * Deduplication is on-ledger: every credit carries a txRef listing the update ids
 * it covers ("ledger:<id>,<id>"), and v13 2.0.0 UserWallet.Deposit records the ref
 * and rejects a repeat. Transfers whose update ids already appear in the wallet's
 * depositRefs are therefore never credited twice, even across racing calls.
 */

import { createHash } from "node:crypto";

export const LEDGER_TXREF_PREFIX = "ledger:";

/**
 * Transfers recorded before this instant are ignored. Everything earlier was handled
 * by the previous wallet-history reconciliation (or deliberately written off), and
 * it has no ledger:<updateId> refs, so the ledger path could not tell it apart from
 * an uncredited transfer while it is still inside the participant's retained window.
 */
export const LEDGER_RECONCILE_SINCE = "2026-09-16T00:00:00Z";

// CC carries 10 decimal places; anything under this is rounding noise, not a deposit.
export const DUST_CC = 1e-9;

/** Update ids already credited, parsed out of the wallet's depositRefs. */
export function creditedUpdateIds(depositRefs) {
  const ids = new Set();
  for (const ref of Array.isArray(depositRefs) ? depositRefs : []) {
    if (typeof ref !== "string" || !ref.startsWith(LEDGER_TXREF_PREFIX)) continue;
    for (const id of ref.slice(LEDGER_TXREF_PREFIX.length).split(",")) {
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * @param transfers   output of incomingTransfersFromLedger (all senders)
 * @param userPartyId the depositor
 * @param existing    the user's UserWallet record (or null before the first deposit)
 * @param since       ISO instant; transfers recorded earlier are ignored
 * @returns { seenCC, pending, credit } — credit is null when nothing is outstanding.
 */
export function planDeposit({ transfers, userPartyId, existing, since = LEDGER_RECONCILE_SINCE }) {
  const sinceMs = Date.parse(since);
  const credited = creditedUpdateIds(existing?.depositRefs);

  const mine = (Array.isArray(transfers) ? transfers : [])
    .filter((t) => t?.sender === userPartyId && t.amountCC > DUST_CC && t.updateId)
    .filter((t) => Number.isFinite(sinceMs) ? Date.parse(t.recordTime) >= sinceMs : true)
    .sort((a, b) => a.offset - b.offset);
  const seenCC = mine.reduce((sum, t) => sum + t.amountCC, 0);

  const pending = mine.filter((t) => !credited.has(t.updateId));
  const total = pending.reduce((sum, t) => sum + t.amountCC, 0);
  if (total <= DUST_CC) return { seenCC, pending: [], credit: null };

  const amount = total.toFixed(10);
  const txRef = LEDGER_TXREF_PREFIX + pending.map((t) => t.updateId).join(",");
  // Derived from the exact state this command was computed against: racing
  // duplicates collide on the id and ledger command-dedup drops all but one, while
  // a genuine later deposit sees new transfers and gets a new id.
  const stateHash = createHash("sha256")
    .update(`${userPartyId}|${existing?.contractId ?? "create"}|${amount}|${txRef}`)
    .digest("hex")
    .slice(0, 40);
  return { seenCC, pending, credit: { amount, txRef, commandId: `deposit-${stateHash}` } };
}
