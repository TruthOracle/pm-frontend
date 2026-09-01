/**
 * Server-side Enterprise Wallet calls. Nothing here takes an amount or a recipient
 * from the browser — every value is either derived from upstream state or pinned in
 * env, which is the whole point of moving these flows off the open proxy.
 */

import { WALLET_AUTH_PREFIXES, authedJson, walletBaseUrl } from "./upstream.mjs";

const INBOUND = new Set(["in", "incoming", "inbound", "receive", "received", "credit"]);
const OUTBOUND = new Set(["out", "outgoing", "outbound", "send", "sent", "debit"]);

// Wallet v0.1.35 history rows carry a status ("completed" observed on DevNet). Only
// clearly-final states count toward what a user has sent in: crediting a pending or
// failed transfer would mint balance for money that never arrived. Missing status
// (pre-0.1.35 rows) keeps the old behavior of counting the row.
const SETTLED = new Set(["completed", "complete", "settled", "success", "succeeded", "confirmed", "final"]);

function wallet(path, options) {
  const base = walletBaseUrl();
  if (!base) throw new Error("Enterprise wallet URL is not configured (VITE_ENTERPRISE_WALLET_URL)");
  return authedJson(base, path, { ...options, authPrefixes: WALLET_AUTH_PREFIXES });
}

/**
 * Every settled transfer the admin party has seen. `limit` defaults high because the
 * reconciliation below must see the COMPLETE history — a truncated page would
 * understate what a user has sent in and silently under-credit them.
 *
 * Wallet v0.1.35 replaced `GET /api/v1/transfer/{partyId}` with a unified
 * `GET /api/v1/history/{partyId}` returning `{ events: [{ eventType, event }] }`,
 * where each `event` payload is either a transfer or a swap. We flatten to the
 * payloads — swap events carry no `instrumentId`, so `totalReceivedFrom` skips them
 * naturally. The old flat-array endpoint remains as a fallback for pre-0.1.35
 * deployments (e.g. the local docker wallet).
 */
export async function transferHistory(partyId, { limit = 100000 } = {}) {
  try {
    const response = await wallet(`/api/v1/history/${encodeURIComponent(partyId)}?limit=${limit}`);
    const events = Array.isArray(response?.events)
      ? response.events
      : Array.isArray(response)
        ? response
        : [];
    return events.map((item) => item?.event ?? item);
  } catch (e) {
    if (e?.status !== 404) throw e;
  }
  const rows = await wallet(`/api/v1/transfer/${encodeURIComponent(partyId)}?limit=${limit}`);
  return Array.isArray(rows) ? rows : [];
}

export function transferStatus(partyId, commandId) {
  return wallet(`/api/v1/transfer/${encodeURIComponent(partyId)}/${encodeURIComponent(commandId)}`);
}

// Statuses that mean "this transfer never happened" — a retry with the same commandId
// is safe. Anything else (pending, settled, or a shape we don't recognise) counts as
// submitted: when in doubt, do NOT move money again.
const NEVER_HAPPENED = new Set([
  "failed",
  "rejected",
  "error",
  "cancelled",
  "canceled",
  "not_found",
  "notfound",
]);

/**
 * Has a transfer with this commandId already been submitted (pending or settled)?
 *
 * Callers use deterministic commandIds — derived from the contract being settled —
 * precisely so this check means something: a concurrent or crashed-and-retried
 * settlement of the same contract produces the SAME id, and is caught here instead of
 * paying twice. Ledger-level command deduplication on that id is the backstop for the
 * window this read cannot close.
 */
export async function transferAlreadySubmitted(partyId, commandId) {
  try {
    const row = await transferStatus(partyId, commandId);
    if (!row || typeof row !== "object") return false;
    const status = String(row.status ?? row.state ?? "").trim().toLowerCase();
    return !NEVER_HAPPENED.has(status);
  } catch (e) {
    if (e?.status === 404) return false;
    console.warn(`[wallet] transfer status check failed for ${commandId}: ${e?.message ?? e}`);
    return false;
  }
}

/**
 * Total CC that `counterparty` has transferred IN to `partyId`.
 *
 * Direction strings are not pinned by the wallet's OpenAPI (`type: string`), so an
 * unrecognised value is skipped and logged rather than guessed at: counting an
 * outbound transfer as inbound would credit a user for money they withdrew.
 */
export function totalReceivedFrom(rows, partyId, counterparty, instrumentId = "Amulet") {
  let total = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row?.instrumentId !== instrumentId) continue;

    const status = String(row?.status ?? "").trim().toLowerCase();
    if (status && !SETTLED.has(status)) {
      // Unknown statuses are skipped too, and loudly: under-crediting is recoverable
      // (the next reconcile picks it up once the status is added), over-crediting is a mint.
      if (!["failed", "rejected", "cancelled", "canceled", "expired", "pending"].includes(status)) skipped += 1;
      continue;
    }

    const direction = String(row?.direction ?? "").trim().toLowerCase();
    if (!INBOUND.has(direction)) {
      if (!OUTBOUND.has(direction)) skipped += 1;
      continue;
    }

    // The pair must be exactly {admin, user} in some order — a transfer merely
    // mentioning the user is not a transfer from them.
    const parties = [row?.partyId, row?.partyId2].map((p) => String(p ?? ""));
    if (!parties.includes(partyId) || !parties.includes(counterparty)) continue;
    if (partyId === counterparty) continue;

    const amount = Number(row?.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += amount;
  }
  if (skipped) {
    console.warn(`[wallet] ${skipped} transfer row(s) had an unrecognised direction or status and were ignored`);
  }
  return total;
}

/** Admin-signed Daml commands. Callers must have built `commands` server-side. */
export function externalSubmit({ partyId, appName, commandId, commands, disclosedContracts = [] }) {
  return wallet("/api/v1/external/submit", {
    method: "POST",
    body: { partyId, appName, commandId, commands, disclosedContracts },
  });
}

/** Admin-signed CC transfer. `to` and `amountCC` must be derived, never client-supplied. */
export function transfer({ from, to, amountCC, reason, app, commandId, metadata }) {
  return wallet("/api/v1/transfer", {
    method: "POST",
    body: {
      from,
      to,
      instrumentId: "Amulet",
      transferAmount: amountCC.toFixed(10),
      reason,
      app,
      commandId,
      metadata,
    },
  });
}
