/**
 * Minimal server-side reads against the Canton JSON Ledger API.
 *
 * These exist so admin-signed actions can be derived from what is actually on the
 * ledger instead of from what the browser claims. Read-only by design — writes go
 * through the wallet, which holds the signing key.
 */

import {
  LEDGER_AUTH_PREFIXES,
  authedJson,
  ledgerBaseUrl,
  packageId,
  packageName,
} from "./upstream.mjs";

const TRUTHORACLE_MODULE = "Truthoracle";

function ledger(path, options) {
  const base = ledgerBaseUrl();
  if (!base) throw new Error("Ledger API URL is not configured");
  return authedJson(base, path, { ...options, authPrefixes: LEDGER_AUTH_PREFIXES() });
}

/** Package-id form, for Create/Exercise commands (pins the exact package version). */
export function templateId(entity, module = TRUTHORACLE_MODULE) {
  const pkg = packageId();
  if (!pkg) throw new Error("VITE_TRUTHORACLE_PACKAGE_ID is not set");
  return `${pkg}:${module}:${entity}`;
}

/**
 * Package-NAME form, for active-contracts filters. The JSON Ledger API rejects the
 * package-id form there ("Invalid field packageId: Received an identifier with
 * package ID ..., but expected a package name") — frontend/utils/activeContracts.ts
 * hit the same wall. Responses still carry templateId in package-id form.
 */
export function filterTemplateId(entity, module = TRUTHORACLE_MODULE) {
  const name = packageName();
  if (!name) throw new Error("VITE_TRUTHORACLE_PACKAGE_NAME is not set");
  return `#${name}:${module}:${entity}`;
}

async function ledgerEnd() {
  const end = await ledger("/v2/state/ledger-end", { method: "GET" });
  return String(typeof end?.offset === "number" ? end.offset : 0);
}

/** Active contracts of one template, visible to `party`. */
export async function activeContracts(party, entity, module = TRUTHORACLE_MODULE) {
  const activeAtOffset = await ledgerEnd();
  const response = await ledger("/v2/state/active-contracts", {
    method: "POST",
    body: {
      verbose: false,
      activeAtOffset,
      eventFormat: {
        filtersByParty: {
          [party]: {
            cumulative: [
              {
                identifierFilter: {
                  TemplateFilter: {
                    value: {
                      templateId: filterTemplateId(entity, module),
                      includeCreatedEventBlob: false,
                    },
                  },
                },
              },
            ],
          },
        },
        verbose: false,
      },
    },
  });

  const items = Array.isArray(response)
    ? response
    : (response?.activeContracts ?? response?.contracts ?? []);
  const out = [];
  for (const item of items) {
    const event = item?.contractEntry?.JsActiveContract?.createdEvent;
    if (!event?.contractId) continue;
    out.push({ contractId: String(event.contractId), payload: event.createArgument ?? {} });
  }
  return out;
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The owner's UserWallet, read as the admin (signatory, so it sees every wallet).
 * Returns null when the user has never deposited — the caller creates one.
 */
export async function fetchUserWallet(adminParty, ownerParty) {
  const rows = await activeContracts(adminParty, "UserWallet");
  for (const row of rows) {
    if (String(row.payload?.owner ?? "") !== ownerParty) continue;
    return {
      contractId: row.contractId,
      owner: String(row.payload.owner),
      balanceCC: num(row.payload.balanceCC),
      depositedCC: num(row.payload.depositedCC),
      withdrawnCC: num(row.payload.withdrawnCC),
      // v13 2.0.0 records every credited txRef; a 1.0.0 contract reads as None (null).
      depositRefs: Array.isArray(row.payload.depositRefs) ? row.payload.depositRefs.map(String) : null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Incoming Canton Coin transfers, read from the ledger itself.
//
// The deposit reconciliation used to derive "what did this user send us" from the
// Enterprise Wallet's /api/v1/history. On MainNet that endpoint is broken (HTTP 500
// without a limit, an empty list with one) even for the funded treasury, so every
// reconcile computed "owed = 0" while the CC sat in the treasury. The participant's
// own transaction trees carry the facts: a Splice transfer exercises
// TransferPreapproval_Send(V2) / AmuletRules_Transfer (naming the sender) and
// creates an Amulet owned by the receiver (the amount that actually arrived). Both
// are visible to the admin as receiver.
//
// Retention: the participant prunes, and only updates after the prune point are
// readable (older ranges fail with PARTICIPANT_PRUNED_DATA_ACCESSED). We scan the
// retained window on every call; a transfer that ages out unreconciled is not
// visible here any more, so the reconcile has to run soon after the transfer — the
// app does so immediately after each deposit.
// ---------------------------------------------------------------------------

const TREES_PAGE = 200;
const TRANSFER_CHOICES = new Set(["TransferPreapproval_Send", "TransferPreapproval_SendV2", "AmuletRules_Transfer"]);
const TRANSFER_TEMPLATE = /:Splice\.AmuletRules:(TransferPreapproval|AmuletRules)$/;
const AMULET_TEMPLATE = /:Splice\.Amulet:Amulet$/;

/** The transaction tree inside one /v2/updates/trees item (tolerating the flat shape). */
function treeOf(update) {
  return update?.update?.TransactionTree?.value ?? update?.update?.Transaction?.value ?? null;
}

/** Prune point and ledger end, so scans stay inside what the participant retains. */
async function retainedRange() {
  const [pruned, end] = await Promise.all([
    ledger("/v2/state/latest-pruned-offsets", { method: "GET" }),
    ledger("/v2/state/ledger-end", { method: "GET" }),
  ]);
  return {
    beginExclusive: Number(pruned?.participantPrunedUpToInclusive ?? 0),
    endInclusive: Number(end?.offset ?? 0),
  };
}

/**
 * Every transaction tree visible to `party` in the retained window, oldest first.
 * Pages with `limit`, resuming after the last offset seen. If pruning advances under
 * the scan, it restarts once from the new prune point.
 */
export async function retainedTransactionTrees(party) {
  const filter = {
    filtersByParty: {
      [party]: {
        cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }],
      },
    },
  };
  for (let attempt = 0; ; attempt += 1) {
    const { beginExclusive, endInclusive } = await retainedRange();
    const out = [];
    let cursor = beginExclusive;
    try {
      while (cursor < endInclusive) {
        const page = await ledger(`/v2/updates/trees?limit=${TREES_PAGE}`, {
          method: "POST",
          body: { beginExclusive: cursor, endInclusive, filter, verbose: false },
        });
        const list = Array.isArray(page) ? page : [];
        out.push(...list);
        if (list.length < TREES_PAGE) break;
        const last = Number(treeOf(list[list.length - 1])?.offset);
        if (!Number.isFinite(last) || last <= cursor) throw new Error("transaction tree paging did not advance");
        cursor = last;
      }
      return out;
    } catch (e) {
      if (attempt === 0 && String(e?.message ?? "").includes("PARTICIPANT_PRUNED_DATA_ACCESSED")) continue;
      throw e;
    }
  }
}

/**
 * Canton Coin received by `receiver`, one entry per transaction, attributed to the
 * sender named in the transfer exercise. Pure, so the parsing is testable on
 * fixtures; `amountCC` is what the receiver's new Amulet(s) hold — the amount that
 * actually arrived, fees having been taken on the sender's side.
 *
 * Skipped on purpose: the receiver's own outbound transfers (its change Amulets are
 * created in the same transaction, but the sender is the receiver), and anything
 * that creates Amulets for the receiver without a transfer exercise (minting,
 * rewards) — there is no counterparty to credit.
 */
export function incomingTransfersFromTrees(updates, receiver) {
  const out = [];
  for (const update of Array.isArray(updates) ? updates : []) {
    const tx = treeOf(update);
    if (!tx) continue;
    const events = Object.values(tx.eventsById ?? {});
    const exercised = events.map((e) => e?.ExercisedTreeEvent?.value ?? e?.ExercisedEvent?.value).filter(Boolean);
    const created = events.map((e) => e?.CreatedTreeEvent?.value ?? e?.CreatedEvent?.value).filter(Boolean);

    const transfer = exercised.find(
      (ev) => TRANSFER_CHOICES.has(ev.choice) && TRANSFER_TEMPLATE.test(String(ev.templateId ?? "")),
    );
    if (!transfer) continue;
    const arg = transfer.choiceArgument ?? {};
    const sender = String(arg.sender ?? arg.transfer?.sender ?? "");
    if (!sender || sender === receiver) continue;

    let received = 0;
    for (const ev of created) {
      if (!AMULET_TEMPLATE.test(String(ev.templateId ?? ""))) continue;
      if (ev.createArgument?.owner !== receiver) continue;
      const n = Number(ev.createArgument?.amount?.initialAmount);
      if (Number.isFinite(n) && n > 0) received += n;
    }
    if (received <= 0) continue;

    out.push({
      updateId: String(tx.updateId ?? ""),
      offset: Number(tx.offset),
      recordTime: String(tx.recordTime ?? ""),
      sender,
      amountCC: received,
    });
  }
  return out;
}

/** Incoming transfers to `receiver` in the participant's retained window. */
export async function incomingTransfersFromLedger(receiver) {
  return incomingTransfersFromTrees(await retainedTransactionTrees(receiver), receiver);
}

/** One PendingPayout by contract id, or null when it is already archived. */
export async function fetchPendingPayout(adminParty, contractId) {
  const rows = await activeContracts(adminParty, "PendingPayout");
  for (const row of rows) {
    if (row.contractId !== contractId) continue;
    // Field names mirror daml/daml/Truthoracle.daml:215 — the payee is `user`.
    return {
      contractId: row.contractId,
      user: String(row.payload?.user ?? ""),
      marketId: num(row.payload?.marketId),
      amountCC: num(row.payload?.amountCC),
      reason: String(row.payload?.reason ?? ""),
    };
  }
  return null;
}
