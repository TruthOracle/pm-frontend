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
    };
  }
  return null;
}

/** One PendingPayout by contract id, or null when it is already archived. */
export async function fetchPendingPayout(adminParty, contractId) {
  const rows = await activeContracts(adminParty, "PendingPayout");
  for (const row of rows) {
    if (row.contractId !== contractId) continue;
    // Field names mirror truthoracle-contracts/daml/daml/Truthoracle.daml (PendingPayout) — the payee is `user`.
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
