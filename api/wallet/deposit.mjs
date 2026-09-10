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
 *     credit = (total Amulet received by the treasury from this user)
 *            - (the user's on-ledger depositedCC)
 *
 * Both sides come from authoritative sources the browser cannot influence: the
 * wallet's own transfer history, and the ledger. That makes the endpoint idempotent
 * by construction — replaying it computes a delta of zero and credits nothing — and
 * self-healing, since a credit lost to a crash between the transfer and the submit is
 * simply picked up by the next call.
 *
 * SEQUENTIAL replays are idempotent; CONCURRENT ones need more care. Two racing calls
 * read the same state and derive the same owed amount. On the Deposit path the ledger
 * arbitrates — the choice consumes the wallet contract, so the loser aborts — but
 * UserWallet has no contract key, so two racing CreateCommands would mint two wallets,
 * each credited in full. The commandId is therefore DERIVED from the exact state the
 * command was computed against: racing duplicates submit the same id and ledger
 * command-dedup rejects all but one, while a legitimate later deposit sees new state
 * and gets a new id. A best-effort lock (cross-instance when a shared store is
 * configured) cheapens the common race to a fast 409.
 *
 * RETIRED once an accounts backend is configured (BACKEND_URL set — see
 * truthoracle-backend/docs/ARCHITECTURE.md §18). The backend's
 * POST /in-app-wallet/deposits/reconcile owns this derivation, extended to all of an
 * account's linked wallets with per-wallet attribution. The two cannot coexist: this
 * endpoint's "total received from the party" has no way to know which transfers the
 * backend already attributed, so running both would double-credit. With BACKEND_URL
 * set every request answers 410 moved_to_backend; the frontend then requires a
 * signed-in account to deposit. Without it (no backend deployed) nothing below changes.
 */

import { currentOperator } from "../_lib/adminSession.mjs";
import { fetchUserWallet, templateId } from "../_lib/ledgerClient.mjs";
import { absoluteTarget, adminPartyId, appName } from "../_lib/upstream.mjs";
import { externalSubmit, totalReceivedFrom, transferHistory } from "../_lib/walletClient.mjs";
import { acquireLock, hitRateLimit, requestClientKey } from "../_lib/sharedStore.mjs";
import { createHash } from "node:crypto";

// CC carries 10 decimal places; anything under this is rounding noise, not a deposit.
const DUST_CC = 1e-9;

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

// ARCHITECTURE.md §18: a configured accounts backend owns deposits. Only an absolute
// URL counts — the same rule api/proxy/backend.mjs applies before forwarding anything.
const retiredByBackend = () => Boolean(absoluteTarget(process.env.BACKEND_URL));

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

  if (retiredByBackend()) {
    return json(res, 410, {
      error: "moved_to_backend",
      message: "Deposits are reconciled by the TruthOracle backend; sign in and use the in-app wallet.",
    });
  }

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
    const [history, existing] = await Promise.all([
      transferHistory(admin),
      fetchUserWallet(admin, userPartyId),
    ]);

    const totalIn = totalReceivedFrom(history, admin, userPartyId);
    const alreadyCredited = existing?.depositedCC ?? 0;
    const owed = totalIn - alreadyCredited;

    if (owed <= DUST_CC) {
      return json(res, 200, {
        credited: 0,
        totalTransferredIn: totalIn,
        alreadyCredited,
        walletContractId: existing?.contractId ?? null,
        balanceCC: existing?.balanceCC ?? 0,
        note: "nothing outstanding — in-app balance already matches transfers received",
      });
    }

    const amount = owed.toFixed(10);
    // Derived from the exact state this command was computed against (see header):
    // concurrent duplicates collide on the id, a genuine later deposit does not.
    const stateHash = createHash("sha256")
      .update(`${userPartyId}|${existing?.contractId ?? "create"}|${amount}|${alreadyCredited}`)
      .digest("hex")
      .slice(0, 40);
    const commandId = `deposit-${stateHash}`;
    const commands = existing
      ? [
          {
            ExerciseCommand: {
              templateId: templateId("UserWallet"),
              contractId: existing.contractId,
              choice: "Deposit",
              choiceArgument: { amountCC: amount, txRef: `reconcile:${commandId}` },
            },
          },
        ]
      : [
          {
            // No depositRefs here: v13 1.0.0 has no such field, and on 2.0.0 an
            // omitted Optional defaults to None — the wallet records refs from its
            // first Deposit exercise onward (see ADMIN_AUTH.md, deposit audit trail).
            CreateCommand: {
              templateId: templateId("UserWallet"),
              createArguments: {
                admin,
                owner: userPartyId,
                balanceCC: amount,
                depositedCC: amount,
                withdrawnCC: "0.0000000000",
              },
            },
          },
        ];

    await externalSubmit({ partyId: admin, appName: appName(), commandId, commands });

    console.log(
      `[deposit] credited ${amount} CC to ${userPartyId}` +
        ` (transfersIn=${totalIn}, wasCredited=${alreadyCredited}` +
        `${operator ? `, by operator ${operator.partyId}` : ""})`,
    );

    return json(res, 200, {
      credited: Number(amount),
      totalTransferredIn: totalIn,
      alreadyCredited,
      commandId,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[deposit] failed for ${userPartyId}: ${message}`);
    return json(res, 502, { error: "deposit reconciliation failed", detail: message.slice(0, 800) });
  } finally {
    await lock.release();
  }
}
