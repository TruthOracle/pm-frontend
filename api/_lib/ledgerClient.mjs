/**
 * Minimal server-side reads against the Canton JSON Ledger API.
 *
 * These exist so admin-signed actions can be derived from what is actually on the
 * ledger instead of from what the browser claims. Read-only by design — writes go
 * through the wallet, which holds the signing key. Record shapes follow truthoracle-v17
 * (truthoracle-backend docs/TOKENS.md §3): one UserWallet per (owner, instrument), every
 * money field next to the instrument it is in, no currency suffix anywhere.
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

/**
 * The GetActiveContractsRequest body for one template visible to `party`. Only
 * `activeAtOffset` sits next to `eventFormat`: Canton 3.6 disables the legacy top-level
 * `filter` / `verbose` fields (DEPRECATED_API_DISABLED), so the verbose flag lives inside
 * the eventFormat and nowhere else. Exported so a test can pin the shape without a ledger.
 */
export function activeContractsRequest(party, entity, activeAtOffset, module = TRUTHORACLE_MODULE) {
  return {
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
  };
}

/** Active contracts of one template, visible to `party`. */
export async function activeContracts(party, entity, module = TRUTHORACLE_MODULE) {
  const activeAtOffset = await ledgerEnd();
  const response = await ledger("/v2/state/active-contracts", {
    method: "POST",
    body: activeContractsRequest(party, entity, activeAtOffset, module),
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

/** `Truthoracle.InstrumentId` as the ledger serialises it: the registry party and the token id. */
export function parseInstrument(value) {
  return { admin: String(value?.admin ?? ""), id: String(value?.id ?? "") };
}

export function sameInstrument(a, b) {
  return !!a && !!b && a.admin === b.admin && a.id === b.id;
}

/**
 * The owner's UserWallet for one instrument, read as the admin (signatory, so it sees
 * every wallet). A party holds one wallet per instrument, so the caller names the one it
 * means — a market's collateral, or the rewards token. Null when the user has never
 * deposited or been granted that instrument — the backend creates it.
 */
export async function fetchUserWallet(adminParty, ownerParty, instrument) {
  if (!instrument?.admin || !instrument?.id) throw new Error("fetchUserWallet needs the wallet's instrument { admin, id }");
  const rows = await activeContracts(adminParty, "UserWallet");
  for (const row of rows) {
    if (String(row.payload?.owner ?? "") !== ownerParty) continue;
    const rowInstrument = parseInstrument(row.payload?.instrument);
    if (!sameInstrument(rowInstrument, instrument)) continue;
    return {
      contractId: row.contractId,
      owner: String(row.payload.owner),
      instrument: rowInstrument,
      balance: num(row.payload.balance),
      deposited: num(row.payload.deposited),
      withdrawn: num(row.payload.withdrawn),
      creditRefs: Array.isArray(row.payload.creditRefs) ? row.payload.creditRefs.map(String) : [],
    };
  }
  return null;
}

/** One PendingPayout by contract id, or null when it is already archived. */
export async function fetchPendingPayout(adminParty, contractId) {
  const rows = await activeContracts(adminParty, "PendingPayout");
  for (const row of rows) {
    if (row.contractId !== contractId) continue;
    // Field names mirror truthoracle-contracts/daml/daml/Truthoracle.daml (PendingPayout) — the payee is `user`,
    // and the row carries the instrument it is owed in (the market's collateral, or the wallet's for a withdrawal).
    return {
      contractId: row.contractId,
      user: String(row.payload?.user ?? ""),
      marketId: num(row.payload?.marketId),
      instrument: parseInstrument(row.payload?.instrument),
      amount: num(row.payload?.amount),
      reason: String(row.payload?.reason ?? ""),
    };
  }
  return null;
}
