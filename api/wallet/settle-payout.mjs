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
 *   3. A per-instance in-flight set turns same-instance races into an immediate 409.
 */

import { currentOperator } from "../_lib/adminSession.mjs";
import { fetchPendingPayout, templateId } from "../_lib/ledgerClient.mjs";
import { adminPartyId, appName } from "../_lib/upstream.mjs";
import { externalSubmit, transfer, transferAlreadySubmitted } from "../_lib/walletClient.mjs";
import { createHash } from "node:crypto";

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

/** Payouts this instance is settling right now. Layer 3 of the race defence above. */
const inFlight = new Set();

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

  if (inFlight.has(pendingPayoutCid)) {
    return json(res, 409, { error: "a settlement for this payout is already in progress" });
  }
  inFlight.add(pendingPayoutCid);

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
    inFlight.delete(pendingPayoutCid);
  }
}
