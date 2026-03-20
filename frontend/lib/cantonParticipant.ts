/**
 * Canton Participant client for the JSON Ledger API.
 * Uses Bearer JWT for all requests per OpenAPI (httpAuth).
 * Tokens come from Keycloak client_credentials (VITE_KEYCLOAK_*), cached until expiry (~900s),
 * then refreshed automatically.
 */

import type { PrepareExecuteParams } from "./cantonDapp";

/** In-memory cache for OAuth2 client_credentials access token (Keycloak). */
let keycloakTokenCache: { accessToken: string; expiresAt: number } | null = null;

/** Cache synchronizerId from GET /v2/state/connected-synchronizers (per baseUrl). */
let synchronizerIdCache: { baseUrl: string; synchronizerId: string } | null = null;

/** Refresh token 60s before expiry to avoid using an expired token. */
const TOKEN_REFRESH_MARGIN_SEC = 60;

/**
 * Fetch access token from Keycloak using client_credentials.
 * Caches the token and returns it until (expires_in - margin) has passed, then fetches a new one.
 * Token endpoint: POST .../realms/{realm}/protocol/openid-connect/token
 */
/** In dev, use same-origin proxy to avoid CORS when Keycloak is on a different origin. */
function getKeycloakBaseUrl(): string {
  const url = import.meta.env.VITE_KEYCLOAK_URL;
  if (!url) return "";
  // In development, proxy Keycloak through Vite so the browser doesn't hit CORS.
  if (
    import.meta.env.DEV &&
    (url.includes("auth.dev.digik.cantor8.tech") || url.startsWith("https://auth."))
  ) {
    return "/api/keycloak";
  }
  return url.replace(/\/$/, "");
}

async function fetchKeycloakAccessToken(): Promise<string> {
  const baseUrl = getKeycloakBaseUrl() || import.meta.env.VITE_KEYCLOAK_URL?.replace(/\/$/, "");
  const realm = import.meta.env.VITE_KEYCLOAK_REALM ?? "master";
  const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID;
  const clientSecret = import.meta.env.VITE_KEYCLOAK_CLIENT_SECRET;

  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error(
      "Keycloak auth requires VITE_KEYCLOAK_URL, VITE_KEYCLOAK_CLIENT_ID, and VITE_KEYCLOAK_CLIENT_SECRET"
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (
    keycloakTokenCache &&
    keycloakTokenCache.expiresAt > nowSec + TOKEN_REFRESH_MARGIN_SEC
  ) {
    return keycloakTokenCache.accessToken;
  }

  const tokenUrl = `${baseUrl}/realms/${realm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Keycloak token request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  const accessToken = data.access_token;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 900;

  if (!accessToken) {
    throw new Error("Keycloak response missing access_token");
  }

  keycloakTokenCache = {
    accessToken,
    expiresAt: nowSec + expiresIn,
  };
  return accessToken;
}

export interface CantonParticipantConfig {
  /** Base URL of the participant Ledger API (e.g. "http://localhost:5003" or "https://participant.example.com") */
  baseUrl: string;
  /** Bearer token (Keycloak client_credentials). Required for authenticated Ledger API. */
  getToken: () => Promise<string | null>;
}

export interface PrepareResponse {
  /** Base64-encoded prepared transaction */
  preparedTransaction: string;
  /** Metadata about the transaction (for signing, validation, etc.) */
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

  /** Resolve Bearer token from Keycloak (getToken). */
  private async resolveAuthToken(): Promise<string> {
    const token = await this.config.getToken();
    if (typeof token === "string" && token.trim()) return token.trim();
    throw new Error(
      "Ledger API requires a Bearer token (Keycloak token fetch failed or empty). Check VITE_KEYCLOAK_URL, VITE_KEYCLOAK_CLIENT_ID, and VITE_KEYCLOAK_CLIENT_SECRET."
    );
  }

  /**
   * Build request headers with Bearer token for Ledger API.
   * Token from Keycloak client_credentials on every Ledger request (ledger-end, active-contracts, prepare, execute).
   */
  private async ledgerHeaders(): Promise<Record<string, string>> {
    const token = await this.resolveAuthToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
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
   * Convert frontend command shape to Ledger API Command (OpenAPI JsPrepareSubmissionRequest).
   * Frontend: { exercise: { templateId: { packageId, moduleName, entityName }, ... } } or { create: { ... } }
   * API: { ExerciseCommand: { templateId: "pkg:mod:ent", ... } } or { CreateCommand: { ... } }
   */
  private normalizeCommand(cmd: unknown): Record<string, unknown> {
    const c = cmd as Record<string, unknown>;
    if (c.exercise && typeof c.exercise === "object") {
      const ex = c.exercise as Record<string, unknown>;
      const tid = ex.templateId;
      const templateIdStr =
        typeof tid === "string"
          ? tid
          : tid && typeof tid === "object" && "packageId" in tid && "moduleName" in tid && "entityName" in tid
            ? `${(tid as Record<string, string>).packageId}:${(tid as Record<string, string>).moduleName}:${(tid as Record<string, string>).entityName}`
            : "";
      return {
        ExerciseCommand: {
          templateId: templateIdStr,
          contractId: ex.contractId,
          choice: ex.choice,
          choiceArgument: ex.choiceArgument ?? ex.choice_argument,
        },
      };
    }
    if (c.create && typeof c.create === "object") {
      const cr = c.create as Record<string, unknown>;
      const tid = cr.templateId;
      const templateIdStr =
        typeof tid === "string"
          ? tid
          : tid && typeof tid === "object" && "packageId" in tid && "moduleName" in tid && "entityName" in tid
            ? `${(tid as Record<string, string>).packageId}:${(tid as Record<string, string>).moduleName}:${(tid as Record<string, string>).entityName}`
            : "";
      return {
        CreateCommand: {
          templateId: templateIdStr,
          createArguments: cr.createArguments ?? cr.create_arguments ?? {},
        },
      };
    }
    return c as Record<string, unknown>;
  }

  /**
   * Prepare a transaction using /v2/interactive-submission/prepare.
   * Request body must match JsPrepareSubmissionRequest: commandId, synchronizerId, actAs (camelCase), etc.
   */
  async prepare(params: PrepareExecuteParams): Promise<PrepareResponse> {
    const url = `${this.config.baseUrl}/v2/interactive-submission/prepare`;
    const headers = await this.ledgerHeaders();

    const rawCommands = params.commands ?? [];
    const commands = Array.isArray(rawCommands)
      ? rawCommands.map((cmd) => this.normalizeCommand(cmd))
      : [this.normalizeCommand(rawCommands)];

    const body = {
      commandId: crypto.randomUUID(),
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
    return {
      preparedTransaction: data.prepared_transaction || data.preparedTransaction || "",
      metadata: data.metadata || data,
    };
  }

  /**
   * Execute a prepared transaction using /v2/interactive-submission/execute.
   * For unsigned execution (participant signs), pass preparedTransaction only.
   * For externally signed, pass signature as well.
   */
  async execute(
    preparedTransaction: string,
    signature?: string
  ): Promise<ExecuteResponse> {
    const url = `${this.config.baseUrl}/v2/interactive-submission/execute`;
    const headers = await this.ledgerHeaders();

    const body: Record<string, unknown> = {
      prepared_transaction: preparedTransaction,
    };
    if (signature) {
      body.signature = signature;
    }

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
   */
  async queryActiveContracts(
    partyId: string,
    templateId: { packageId: string; moduleName: string; entityName: string }
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

    // Template id in package-id reference format: "packageId:moduleName:entityName".
    const templateIdStr = `${templateId.packageId}:${templateId.moduleName}:${templateId.entityName}`;

    // Payload shape: top-level verbose, activeAtOffset as string, eventFormat with filtersByParty and verbose.
    const body = {
      verbose: false,
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
      : (raw as Record<string, unknown>).activeContracts ?? (raw as Record<string, unknown>).contracts ?? [];

    if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_ACTIVE_CONTRACTS === "true") {
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
      const entry =
        rec?.contractEntry != null
          ? (rec.contractEntry as Record<string, unknown>)?.JsActiveContract != null
            ? ((rec.contractEntry as Record<string, unknown>).JsActiveContract as Record<string, unknown>)
                ?.createdEvent
            : undefined
          : undefined;
      let contractId =
        (entry as Record<string, unknown> | undefined)?.contractId ??
        (entry as Record<string, unknown> | undefined)?.contract_id ??
        rec.contractId ??
        rec.contract_id;
      // Some APIs return workflowId at top level; never use it as contractId (exercise would fail with CONTRACT_NOT_FOUND).
      const workflowId = rec.workflowId as string | undefined;
      if (typeof contractId === "string" && typeof workflowId === "string" && contractId === workflowId) {
        contractId = (entry as Record<string, unknown> | undefined)?.contractId ?? (entry as Record<string, unknown> | undefined)?.contract_id ?? undefined;
      }
      const payload =
        (entry as Record<string, unknown> | undefined)?.createArgument ??
        (entry as Record<string, unknown> | undefined)?.create_argument ??
        rec.createArgument ??
        rec.create_argument ??
        rec.payload ??
        {};
      if (contractId && typeof contractId === "string") {
        results.push({
          contractId,
          contract_id: contractId,
          payload: payload as Record<string, unknown>,
          contract: payload as Record<string, unknown>,
        });
      }
    }
    return results;
  }

  /**
   * Prepare and execute in one call (for unsigned transactions where participant signs).
   */
  async submitTransaction(params: PrepareExecuteParams): Promise<{ hash: string }> {
    const prepared = await this.prepare(params);
    const result = await this.execute(prepared.preparedTransaction);
    if (result.error) {
      throw new Error(`Transaction failed: ${result.error}`);
    }
    const hash = result.commandId || result.transactionId || result.updateId || "";
    return { hash };
  }
}

/** In dev, use same-origin /api/ledger so Vite proxies to the ledger and we avoid CORS. */
function getLedgerBaseUrl(): string {
  const url =
    import.meta.env.VITE_CANTON_PARTICIPANT_URL ||
    "https://api.validator.dev.digik.cantor8.tech/api/ledger";
  if (
    import.meta.env.DEV &&
    (url.includes("api.validator.dev.digik.cantor8.tech") ||
      url.includes("validator.dev.digik.cantor8.tech"))
  ) {
    return "/api/ledger";
  }
  return url.replace(/\/$/, "");
}

/**
 * Get participant config from environment or defaults.
 * Auth: Keycloak client_credentials only (cached ~900s). Required for Ledger API calls.
 */
export function getParticipantConfig(): CantonParticipantConfig {
  return {
    baseUrl: getLedgerBaseUrl(),
    getToken: async () => {
      try {
        return await fetchKeycloakAccessToken();
      } catch (e) {
        console.error("Keycloak token fetch failed:", e);
        return null;
      }
    },
  };
}

/**
 * Create a participant client with default config.
 */
export function createParticipantClient(): CantonParticipantClient {
  return new CantonParticipantClient(getParticipantConfig());
}
