/**
 * POST /api/wallet/deposit — reconcile a user's in-app balance against the CC they
 * have actually transferred to the treasury.
 *
 * Body: { userPartyId }.  Deliberately no amount.
 *
 * The flow this replaces had the browser tell the open wallet proxy how much to
 * credit (frontend/lib/inAppWallet.ts step 2). Since the proxy signs as the admin and
 * authenticated nobody, anyone could POST a credit for any amount without ever moving
 * CC — an unlimited mint. The amount is now derived, never accepted:
 *
 *     credit = sum of the user's Canton Coin transfers INTO the treasury that the
 *              ledger shows and the user's UserWallet has not yet recorded
 *
 * Both sides are ledger facts the browser cannot influence: the transfer exercises
 * and the Amulets they created (ledgerClient.incomingTransfersFromLedger), and the
 * txRefs already recorded on the UserWallet (v13 2.0.0 depositRefs). Every credit
 * names the update ids it covers, and the Deposit choice rejects a repeated ref, so
 * the endpoint is idempotent by construction and self-healing: a credit lost to a
 * crash between the transfer and the submit is picked up by the next call.
 *
 * This used to read the Enterprise Wallet's transfer history instead. On MainNet
 * that endpoint returns nothing (HTTP 500 without a limit, [] with one) even for the
 * funded treasury, so deposits were never credited — see api/_lib/ledgerClient.mjs.
 *
 * SEQUENTIAL replays are idempotent; CONCURRENT ones need more care. Two racing calls
 * read the same state and derive the same credit. On the Deposit path the ledger
 * arbitrates — the choice consumes the wallet contract and rejects a repeated txRef —
 * but UserWallet has no contract key, so two racing CreateCommands would mint two
 * wallets, each credited in full. The commandId is therefore DERIVED from the exact
 * state the command was computed against (see depositPlan.mjs): racing duplicates
 * submit the same id and ledger command-dedup rejects all but one, while a legitimate
 * later deposit sees new transfers and gets a new id. A best-effort lock
 * (cross-instance when a shared store is configured) cheapens the common race to a
 * fast 409.
 *
 * Requires the v13 2.0.0 package (UserWallet.depositRefs) on the target participant.
 */

import { currentOperator } from "../_lib/adminSession.mjs";
import { fetchUserWallet, incomingTransfersFromLedger, templateId } from "../_lib/ledgerClient.mjs";
import { adminPartyId, appName } from "../_lib/upstream.mjs";
import { externalSubmit } from "../_lib/walletClient.mjs";
import { acquireLock, hitRateLimit, requestClientKey } from "../_lib/sharedStore.mjs";
import { planDeposit } from "../_lib/depositPlan.mjs";

// The endpoint is unauthenticated (no user sessions yet) and each call costs upstream
// work — a transfer-history fetch, a ledger read, possibly a submit. The limits only
// cap what an anonymous caller can burn, so they are sized WAY above legitimate use
// (one reconcile per deposit): headroom for shared IPs (NAT, offices) and for retry
// loops, while still bounding a flood.
const RATE_WINDOW_MS = 60_000;
const MAX_PER_IP = 60;
const MAX_PER_PARTY = 30;

// Crash ceiling for the cross-instance lock. Generous next to the endpoint's few
// upstream calls; correctness never depends on it (ledger command-dedup does that).
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

  const userPartyId = String(body.userPartyId ?? "").trim();
  if (!userPartyId) return json(res, 400, { error: "userPartyId is required" });
  if (userPartyId === admin) return json(res, 400, { error: "the treasury cannot deposit to itself" });

  // A user may reconcile only themselves; an operator may reconcile anyone (support).
  // There is no session for ordinary users yet, so self-service is currently open —
  // which is safe here precisely BECAUSE the amount is derived: the worst an
  // unauthenticated caller can do is trigger someone else's legitimate credit.
  const operator = currentOperator(req);

  const [byIp, byParty] = await Promise.all([
    hitRateLimit(`rl:deposit:ip:${requestClientKey(req)}`, RATE_WINDOW_MS, MAX_PER_IP),
    hitRateLimit(`rl:deposit:party:${userPartyId}`, RATE_WINDOW_MS, MAX_PER_PARTY),
  ]);
  if (byIp.limited || byParty.limited) {
    return json(res, 429, { error: "too many reconciliation attempts, try again shortly" });
  }

  const lock = await acquireLock(`lock:deposit:${userPartyId}`, LOCK_TTL_MS);
  if (!lock.acquired) {
    return json(res, 409, { error: "a reconciliation for this user is already in progress" });
  }

  try {
    const [transfers, existing] = await Promise.all([
      incomingTransfersFromLedger(admin),
      fetchUserWallet(admin, userPartyId),
    ]);

    const plan = planDeposit({ transfers, userPartyId, existing });
    const alreadyCredited = existing?.depositedCC ?? 0;

    if (!plan.credit) {
      return json(res, 200, {
        credited: 0,
        totalTransferredIn: plan.seenCC,
        alreadyCredited,
        walletContractId: existing?.contractId ?? null,
        balanceCC: existing?.balanceCC ?? 0,
        note: "nothing outstanding — every transfer the ledger shows from this party is already credited",
      });
    }

    const { amount, txRef, commandId } = plan.credit;
    const commands = existing
      ? [
          {
            ExerciseCommand: {
              templateId: templateId("UserWallet"),
              contractId: existing.contractId,
              choice: "Deposit",
              choiceArgument: { amountCC: amount, txRef },
            },
          },
        ]
      : [
          {
            // First deposit creates the wallet with the covering ref already recorded,
            // so a replay against the new contract is rejected on-ledger like any other.
            CreateCommand: {
              templateId: templateId("UserWallet"),
              createArguments: {
                admin,
                owner: userPartyId,
                balanceCC: amount,
                depositedCC: amount,
                withdrawnCC: "0.0000000000",
                depositRefs: [txRef],
              },
            },
          },
        ];

    await externalSubmit({ partyId: admin, appName: appName(), commandId, commands });

    console.log(
      `[deposit] credited ${amount} CC to ${userPartyId}` +
        ` (${plan.pending.length} ledger transfer(s), seen=${plan.seenCC}, wasCredited=${alreadyCredited}` +
        `${operator ? `, by operator ${operator.partyId}` : ""})`,
    );

    return json(res, 200, {
      credited: Number(amount),
      totalTransferredIn: plan.seenCC,
      alreadyCredited,
      commandId,
      transfers: plan.pending.map((t) => ({ updateId: t.updateId, recordTime: t.recordTime, amountCC: t.amountCC })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[deposit] failed for ${userPartyId}: ${message}`);
    return json(res, 502, { error: "deposit reconciliation failed", detail: message.slice(0, 800) });
  } finally {
    await lock.release();
  }
}
