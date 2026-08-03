/**
 * Admin-side CC auto-payout for Sell / Merge / Resolve.
 *
 * After a user-signed Sell or Merge creates a PendingPayout contract, the
 * frontend immediately calls the local Enterprise Wallet's `/api/v1/transfer`
 * (admin-signed, key in the wallet container) to send CC to the user, then
 * exercises `MarkPaid` on the PendingPayout to archive the row.
 *
 * The admin is "always on" in this model — exactly what the Cantor8
 * Enterprise Wallet is designed for. The user's experience is fully
 * automatic: one signature for the Sell/Merge choice, then CC arrives
 * in their wallet a moment later.
 */

import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { buildMarkPaidParams } from "@/utils/cantonCommands";
import {
    enterpriseWalletPartyId,
    submitAdminTransaction,
} from "@/lib/enterpriseWalletSubmit";
import { ENTERPRISE_WALLET_APP_NAME, ENTERPRISE_WALLET_PROXY_URL } from "@/config";

function walletBaseUrl(): string {
    return ENTERPRISE_WALLET_PROXY_URL;
}

function appName(): string {
    return ENTERPRISE_WALLET_APP_NAME;
}

export interface AutoPayoutArgs {
    /** Receiver party (the user). */
    toUser: string;
    /** Amount in whole CC. */
    amountCC: number;
    /** PendingPayout contract id to mark paid after the transfer settles. */
    pendingPayoutCid: string;
    /** Human-readable reason (e.g. "sell", "merge", "resolve") — surfaces in wallet history. */
    reason: string;
    /** Bound signAndSubmitTransaction so MarkPaid can fall back if the Enterprise Wallet isn't configured. */
    signAndSubmitTransaction: (p: PrepareExecuteParams) => Promise<{ hash: string }>;
}

export interface AutoPayoutResult {
    transferCommandId: string;
    markPaidCommandId: string;
}

/**
 * Run the admin payout. Throws if the Enterprise Wallet isn't reachable or
 * the transfer is rejected; caller should leave the PendingPayout in place
 * so it can be retried (or settled manually).
 */
export async function runAdminAutoPayout(args: AutoPayoutArgs): Promise<AutoPayoutResult> {
    const adminParty = enterpriseWalletPartyId();
    if (!adminParty) {
        throw new Error(
            "VITE_ENTERPRISE_WALLET_PARTY_ID is not set — admin auto-payout disabled.",
        );
    }
    if (!(args.amountCC > 0)) {
        throw new Error(`Refusing to auto-payout non-positive amount: ${args.amountCC}`);
    }

    const transferCommandId = `payout-${Date.now()}-${crypto.randomUUID()}`;
    const body = {
        from: adminParty,
        to: args.toUser,
        instrumentId: "Amulet",
        transferAmount: args.amountCC.toFixed(10),
        reason: args.reason,
        app: appName(),
        commandId: transferCommandId,
        metadata: {
            kind: "truthoracle_admin_payout",
            pending_payout_cid: args.pendingPayoutCid,
            reason: args.reason,
        },
    };

    const res = await fetch(`${walletBaseUrl()}/api/v1/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Admin transfer failed (${res.status}): ${text.slice(0, 600)}`);
    }

    // The transfer is committed at this point. Mark the PendingPayout paid so it
    // disappears from the user's queue. If MarkPaid fails (e.g. the participant
    // hasn't seen the payout yet), the user still has their CC — they'll just
    // see a stale row until manually cleaned up.
    const markParams = buildMarkPaidParams(adminParty, args.pendingPayoutCid, transferCommandId);
    const markResult = await submitAdminTransaction(markParams, args.signAndSubmitTransaction);

    return {
        transferCommandId,
        markPaidCommandId: markResult.hash,
    };
}
