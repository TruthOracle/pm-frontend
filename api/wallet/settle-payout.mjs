/**
 * POST /api/wallet/settle-payout — pay out one PendingPayout and archive it.
 *
 * Body: { pendingPayoutCid }.  Deliberately no recipient and no amount.
 *
 * This replaces frontend/lib/adminAutoPayout.ts, which posted `to` and
 * `transferAmount` straight through the open wallet proxy to `/api/v1/transfer`.
 * Because that proxy signs as the admin and authenticated nobody, the treasury could
 * be drained by a single unauthenticated request naming any recipient and any amount.
 *
 * Here the contract IS the authorisation: the payee and the amount are read from the
 * on-ledger PendingPayout, which only the market choices can create. The caller
 * supplies a contract id and nothing else, so the worst a hostile caller can do is
 * settle a payout that the ledger already says is owed — to the party the ledger says
 * owns it.
 *
 * Concurrency is the remaining way to abuse that: the transfer happens BEFORE the
 * consuming MarkPaid (money must move before the record archives), so two requests
 * racing on the same cid would both read an active payout and both pay. Three layers
 * close that:
 *
 *   1. The transfer commandId is DERIVED from the cid, so every settlement attempt for
 *      one payout submits the same id and ledger command-dedup rejects the copies.
 *   2. Before transferring we ask the wallet whether that commandId was already
 *      submitted — which doubles as crash recovery: a payout whose transfer went
 *      through but whose MarkPaid didn't resumes at MarkPaid instead of paying again.
 *   3. A best-effort lock (cross-instance when a shared store is configured) turns
 *      most races into an immediate 409 before any upstream work happens.
 */

import { currentOperator } from "../_lib/adminSession.mjs";
import { fetchPendingPayout, templateId } from "../_lib/ledgerClient.mjs";
import { adminPartyId, appName } from "../_lib/upstream.mjs";
import { externalSubmit, transfer, transferAlreadySubmitted } from "../_lib/walletClient.mjs";
import { acquireLock, hitRateLimit, requestClientKey } from "../_lib/sharedStore.mjs";
import { createHash } from "node:crypto";

// Anonymous callers can only trigger legitimate, ledger-recorded payouts, but each
// attempt costs upstream reads — cap the burn, nothing else. Sized for an operator
// draining a long payout queue from one IP (auto-payout settles sequentially, so
// even 120/min is far above what the loop can reach) plus retry headroom per cid.
const RATE_WINDOW_MS = 60_000;
const MAX_PER_IP = 120;
const MAX_PER_CID = 30;

// Crash ceiling for the cross-instance lock; correctness lives in command-dedup.
const LOCK_TTL_MS = 60_000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024) reject(new Error("body too large"));
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

/** Stable per-payout ids: every attempt to settle one cid submits the same commands. */
function commandIdsFor(pendingPayoutCid) {
  const cidHash = createHash("sha256").update(pendingPayoutCid).digest("hex").slice(0, 40);
  return { transferCommandId: `payout-${cidHash}`, markPaidCommandId: `markpaid-${cidHash}` };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });

  const admin = adminPartyId();
  if (!admin) return json(res, 503, { error: "VITE_ENTERPRISE_WALLET_PARTY_ID is not configured" });

  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return json(res, 400, { error: "invalid JSON body" });
  }

  const pendingPayoutCid = String(body.pendingPayoutCid ?? "").trim();
  if (!pendingPayoutCid) return json(res, 400, { error: "pendingPayoutCid is required" });

  const operator = currentOperator(req);

  const [byIp, byCid] = await Promise.all([
    hitRateLimit(`rl:payout:ip:${requestClientKey(req)}`, RATE_WINDOW_MS, MAX_PER_IP),
    hitRateLimit(`rl:payout:cid:${pendingPayoutCid}`, RATE_WINDOW_MS, MAX_PER_CID),
  ]);
  if (byIp.limited || byCid.limited) {
    return json(res, 429, { error: "too many settlement attempts, try again shortly" });
  }

  const lock = await acquireLock(`lock:payout:${pendingPayoutCid}`, LOCK_TTL_MS);
  if (!lock.acquired) {
    return json(res, 409, { error: "a settlement for this payout is already in progress" });
  }

  try {
    const payout = await fetchPendingPayout(admin, pendingPayoutCid);

    // Already archived: either settled moments ago, or cancelled by the user. Either
    // way there is nothing owed, and re-transferring would double-pay.
    if (!payout) {
      return json(res, 200, { settled: false, reason: "payout not found or already settled" });
    }
    if (!payout.user) return json(res, 409, { error: "payout has no payee" });
    if (!(payout.amountCC > 0)) return json(res, 409, { error: "payout amount is not positive" });

    const { transferCommandId, markPaidCommandId } = commandIdsFor(pendingPayoutCid);

    // Skip the transfer when a previous attempt already submitted it (crashed before
    // MarkPaid, or a concurrent request from another instance won). The payout is
    // still active, so finishing the job means archiving it — not paying again.
    if (await transferAlreadySubmitted(admin, transferCommandId)) {
      console.warn(`[payout] transfer ${transferCommandId} already submitted — resuming at MarkPaid`);
    } else {
      await transfer({
        from: admin,
        to: payout.user,
        amountCC: payout.amountCC,
        reason: payout.reason || "payout",
        app: appName(),
        commandId: transferCommandId,
        metadata: {
          kind: "truthoracle_admin_payout",
          pending_payout_cid: pendingPayoutCid,
          reason: payout.reason || "payout",
        },
      });
    }

    // The CC has moved. If MarkPaid fails the user still has their money; the row
    // just lingers until the next settle attempt resumes here and archives it.
    await externalSubmit({
      partyId: admin,
      appName: appName(),
      commandId: markPaidCommandId,
      commands: [
        {
          ExerciseCommand: {
            templateId: templateId("PendingPayout"),
            contractId: pendingPayoutCid,
            choice: "MarkPaid",
            choiceArgument: { txHash: transferCommandId },
          },
        },
      ],
    });

    console.log(
      `[payout] settled ${payout.amountCC} CC to ${payout.user} (${payout.reason})` +
        `${operator ? ` by operator ${operator.partyId}` : ""}`,
    );

    return json(res, 200, {
      settled: true,
      amountCC: payout.amountCC,
      to: payout.user,
      transferCommandId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[payout] failed for ${pendingPayoutCid}: ${message}`);
    return json(res, 502, { error: "payout settlement failed", detail: message.slice(0, 400) });
  } finally {
    await lock.release();
  }
}
