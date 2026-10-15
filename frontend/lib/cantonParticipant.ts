/**
 * Canton Participant client for the JSON Ledger API.
 * Uses Bearer JWT for all requests per OpenAPI (httpAuth).
 *
 * Auth is injected SERVER-SIDE by the ledger proxy (api/proxy/ledger.mjs, and the
 * matching dev middleware in vite.config.ts): the browser calls the proxy with no
 * credentials, and the proxy mints + attaches the Keycloak token. The client id/secret
 * are server-only env (KEYCLOAK_CLIENT_ID/SECRET) and never enter the browser bundle.
 */

import type { PrepareExecuteParams } from "./cantonDapp";
import { DEBUG_ACTIVE_CONTRACTS, IS_DEV, PARTICIPANT_PROXY_URL } from "@/config";
import { normalizeCommand } from "@/utils/normalizeCommand";

/** Cache synchronizerId from GET /v2/state/connected-synchronizers (per baseUrl). */
let synchronizerIdCache: { baseUrl: string; synchronizerId: string } | null = null;

export interface CantonParticipantConfig {
  /** Base URL of the participant Ledger API — always the same-origin proxy path. */
  baseUrl: string;
  /**
   * Optional Bearer token. Normally null: the ledger proxy injects the token
   * server-side. Kept for callers that pass an end-user token explicitly.
   */
  getToken: () => Promise<string | null>;
}

export interface PrepareResponse {
  /** Base64-encoded prepared transaction (`preparedTransaction` in the JSON Ledger API). */
  preparedTransaction: string;
  /** Base64 (std, with padding) of the transaction hash to sign (`preparedTransactionHash`). */
  preparedTransactionHash: string;
  /** Hashing scheme version the wallet must use to sign the hash, e.g. "HASHING_SCHEME_VERSION_V2". */
  hashingSchemeVersion: string;
  /** The commandId used in the prepare request (echo it back when executing / signing). */
  commandId: string;
  /** Raw prepare response (cost estimation, hashing details, etc.). */
  metadata?: Record<string, unknown>;
}

export interface ExecuteResponse {
  /** Transaction/command ID */
  transactionId?: string;
  commandId?: string;
  /** Update ID (if available) */
  updateId?: string;
  /** Status or error */
  status?: string;
  error?: string;
}

/**
 * Canton Participant client for Interactive Submission.
 */
export class CantonParticipantClient {
  private config: CantonParticipantConfig;

  constructor(config: CantonParticipantConfig) {
    this.config = config;
  }

  /**
   * Build request headers for the Ledger API. Auth is added by the ledger proxy
   * server-side, so a token here is optional; if `getToken` returns one (e.g. an
   * end-user token), it's attached, otherwise the proxy injects the client token.
   */
  private async ledgerHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = await this.config.getToken();
    if (typeof token === "string" && token.trim()) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
  }

  /**
   * Fetch synchronizerId from GET /v2/state/connected-synchronizers (cached per baseUrl).
   * Required by JsPrepareSubmissionRequest.
   */
  private async getSynchronizerId(): Promise<string> {
    if (synchronizerIdCache?.baseUrl === this.config.baseUrl) {
      return synchronizerIdCache.synchronizerId;
    }
    const url = `${this.config.baseUrl}/v2/state/connected-synchronizers`;
    const headers = await this.ledgerHeaders();
    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Connected synchronizers failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as {
      connectedSynchronizers?: Array<{ synchronizerId?: string }>;
    };
    const id =
      data.connectedSynchronizers?.[0]?.synchronizerId ??
      (data as Record<string, unknown>).connectedSynchronizers?.[0]?.synchronizerId;
    if (!id || typeof id !== "string") {
      throw new Error("No synchronizerId in connected-synchronizers response");
    }
    synchronizerIdCache = { baseUrl: this.config.baseUrl, synchronizerId: id };
    return id;
  }

  /**
   * Prepare a transaction using /v2/interactive-submission/prepare.
   * Request body matches JsPrepareSubmissionRequest (camelCase: commandId, synchronizerId, actAs, …).
   * Returns the prepared transaction + hash + hashing scheme — hand these to the wallet to sign,
   * or to {@link execute} for participant-hosted parties.
   * Pass `commandId` to reuse a caller-generated id (so the same id can be echoed when executing/signing).
   */
  async prepare(params: PrepareExecuteParams, commandId?: string): Promise<PrepareResponse> {
    const url = `${this.config.baseUrl}/v2/interactive-submission/prepare`;
    const headers = await this.ledgerHeaders();
    const cmdId = commandId ?? crypto.randomUUID();

    const rawCommands = params.commands ?? [];
    const commands = Array.isArray(rawCommands) ? rawCommands.map(normalizeCommand) : [normalizeCommand(rawCommands)];

    const body = {
      commandId: cmdId,
      synchronizerId: await this.getSynchronizerId(),
      verboseHashing: false,
      commands,
      actAs: params.actAs?.length ? params.actAs : [],
      readAs: params.readAs ?? [],
      disclosedContracts: params.disclosedContracts ?? [],
      packageIdSelectionPreference: params.packageIdSelectionPreference ?? [],
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Prepare failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const preparedTransaction = data.preparedTransaction || data.prepared_transaction || "";
    const preparedTransactionHash = data.preparedTransactionHash || data.prepared_transaction_hash || "";
    const hashingSchemeVersion =
      data.hashingSchemeVersion || data.hashing_scheme_version || "HASHING_SCHEME_VERSION_V2";
    if (!preparedTransaction) {
      throw new Error("Prepare did not return a preparedTransaction");
    }
    return { preparedTransaction, preparedTransactionHash, hashingSchemeVersion, commandId: cmdId, metadata: data };
  }

  /**
   * Execute a prepared transaction using /v2/interactive-submission/execute.
   * Works for participant-hosted parties (the participant signs — pass no party signatures).
   * For external / self-custody parties the participant rejects this ("did not provide an external
   * signature"); those must be signed + executed via the wallet (`signAndExecutePreparedTransfer`).
   */
  async execute(prepared: {
    preparedTransaction: string;
    hashingSchemeVersion?: string;
    partySignatures?: unknown;
  }): Promise<ExecuteResponse> {
    const url = `${this.config.baseUrl}/v2/interactive-submission/execute`;
    const headers = await this.ledgerHeaders();

    const body = {
      preparedTransaction: prepared.preparedTransaction,
      hashingSchemeVersion: prepared.hashingSchemeVersion ?? "HASHING_SCHEME_VERSION_V2",
      partySignatures: prepared.partySignatures ?? { signatures: [] },
      deduplicationPeriod: { Empty: {} },
      submissionId: crypto.randomUUID(),
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Execute failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    return {
      transactionId: data.transaction_id || data.transactionId,
      commandId: data.command_id || data.commandId,
      updateId: data.update_id || data.updateId,
      status: data.status,
      error: data.error,
    };
  }

  /**
   * Query active contracts by template from the participant Ledger API.
   * Uses GET /v2/state/ledger-end and POST /v2/state/active-contracts (GetActiveContractsRequest).
   *
   * The template filter must reference the template by *package name* ("#<pkgName>:<module>:<entity>"),
   * not by package ID — the JSON Ledger API rejects package-ID identifiers in active-contracts filters
   * ("expected a package name"). Pass `packageName`; `packageId` is accepted as a legacy fallback only.
   *
   * Pass `options.includeCreatedEventBlob: true` to also get the base64 createdEventBlob and
   * synchronizerId on each item — those are required to build a `DisclosedContract` so a party
   * that doesn't see the contract directly (e.g. an external wallet party) can still exercise it.
   */
  async queryActiveContracts(
    partyId: string,
    templateId: { packageName?: string; packageId?: string; moduleName: string; entityName: string },
    options?: { includeCreatedEventBlob?: boolean },
  ): Promise<unknown[]> {
    const headers = await this.ledgerHeaders();

    // GetActiveContractsRequest requires activeAtOffset (snapshot time). No "use latest" sentinel,
    // so we GET ledger-end once, then POST active-contracts. (Prepare/execute are for submitting
    // transactions, not for querying contracts.)
    const ledgerEndUrl = `${this.config.baseUrl}/v2/state/ledger-end`;
    const ledgerEndRes = await fetch(ledgerEndUrl, { method: "GET", headers });
    if (!ledgerEndRes.ok) {
      const text = await ledgerEndRes.text();
      throw new Error(`Ledger end failed (${ledgerEndRes.status}): ${text}`);
    }
    const ledgerEnd = (await ledgerEndRes.json()) as { offset?: number };
    const activeAtOffset = typeof ledgerEnd.offset === "number" ? ledgerEnd.offset : 0;

    // Template id in package-name reference format: "#packageName:moduleName:entityName".
    // (Falls back to a raw package-id reference only if no package name is supplied.)
    const templateIdStr = templateId.packageName
      ? `#${templateId.packageName}:${templateId.moduleName}:${templateId.entityName}`
      : `${templateId.packageId}:${templateId.moduleName}:${templateId.entityName}`;

    // GetActiveContractsRequest: activeAtOffset as a string plus an eventFormat (filtersByParty and
    // its own verbose flag). The legacy top-level `filter` / `verbose` fields are DISABLED on Canton
    // 3.6 (DEPRECATED_API_DISABLED), so nothing may sit next to eventFormat but the offset.
    const includeBlob = options?.includeCreatedEventBlob === true;
    const body = {
      activeAtOffset: String(activeAtOffset),
      eventFormat: {
        filtersByParty: {
          [partyId]: {
            cumulative: [
              {
                identifierFilter: {
                  TemplateFilter: {
                    value: {
                      templateId: templateIdStr,
                      includeCreatedEventBlob: includeBlob,
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

    const url = `${this.config.baseUrl}/v2/state/active-contracts`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Query active contracts failed (${response.status}): ${text}`);
    }

    const raw = (await response.json()) as unknown;
    const list = Array.isArray(raw)
      ? raw
      : ((raw as Record<string, unknown>).activeContracts ?? (raw as Record<string, unknown>).contracts ?? []);

    if (IS_DEV && DEBUG_ACTIVE_CONTRACTS) {
      console.debug("[active-contracts]", {
        partyId,
        templateIdStr,
        activeAtOffset,
        responseIsArray: Array.isArray(raw),
        rawKeys: Array.isArray(raw) ? undefined : Object.keys(raw as object),
        listLength: Array.isArray(list) ? list.length : 0,
        firstItem: Array.isArray(list) && list[0] ? list[0] : undefined,
        raw: raw,
      });
    }

    const results: unknown[] = [];
    const items = Array.isArray(list) ? list : [];
    for (const item of items) {
      const rec = item as Record<string, unknown>;
      const jsActive =
        rec?.contractEntry != null
          ? ((rec.contractEntry as Record<string, unknown>)?.JsActiveContract as Record<string, unknown> | undefined)
          : undefined;
      const entry = jsActive?.createdEvent as Record<string, unknown> | undefined;
      let contractId = entry?.contractId ?? entry?.contract_id ?? rec.contractId ?? rec.contract_id;
      // Some APIs return workflowId at top level; never use it as contractId (exercise would fail with CONTRACT_NOT_FOUND).
      const workflowId = rec.workflowId as string | undefined;
      if (typeof contractId === "string" && typeof workflowId === "string" && contractId === workflowId) {
        contractId = entry?.contractId ?? entry?.contract_id ?? undefined;
      }
      const payload =
        entry?.createArgument ??
        entry?.create_argument ??
        rec.createArgument ??
        rec.create_argument ??
        rec.payload ??
        {};
      const createdEventBlob =
        (entry?.createdEventBlob as string | undefined) ?? (entry?.created_event_blob as string | undefined);
      const synchronizerId =
        (jsActive?.synchronizerId as string | undefined) ?? (jsActive?.synchronizer_id as string | undefined);
      if (contractId && typeof contractId === "string") {
        results.push({
          contractId,
          contract_id: contractId,
          payload: payload as Record<string, unknown>,
          contract: payload as Record<string, unknown>,
          createdEventBlob,
          synchronizerId,
        });
      }
    }
    return results;
  }

  /**
   * Prepare and execute in one call. Only works for participant-hosted parties (participant signs).
   * For external / self-custody parties, use `prepare()` here + sign/execute via the wallet.
   */
  async submitTransaction(params: PrepareExecuteParams): Promise<{ hash: string }> {
    const prepared = await this.prepare(params);
    const result = await this.execute({
      preparedTransaction: prepared.preparedTransaction,
      hashingSchemeVersion: prepared.hashingSchemeVersion,
    });
    if (result.error) {
      throw new Error(`Transaction failed: ${result.error}`);
    }
    const hash = result.updateId || result.commandId || result.transactionId || "";
    return { hash };
  }
}

function getLedgerBaseUrl(): string {
  return PARTICIPANT_PROXY_URL;
}

/**
 * Get participant config. Requests go to the same-origin ledger proxy, which mints
 * and attaches the Keycloak Bearer token server-side — so no token is fetched here
 * (the browser never holds Keycloak credentials).
 */
export function getParticipantConfig(): CantonParticipantConfig {
  return {
    baseUrl: getLedgerBaseUrl(),
    getToken: async () => null,
  };
}

/**
 * Create a participant client with default config.
 */
export function createParticipantClient(): CantonParticipantClient {
  return new CantonParticipantClient(getParticipantConfig());
}
