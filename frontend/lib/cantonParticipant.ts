/**
 * Canton Participant Interactive Submission API client.
 * Calls /v2/interactive-submission/prepare and /v2/interactive-submission/execute
 * for direct transaction submission to the participant.
 * Uses Bearer token from VITE_CANTON_PARTICIPANT_TOKEN for Ledger API authentication.
 */

import type { PrepareExecuteParams } from "./cantonDapp";

export interface CantonParticipantConfig {
  /** Base URL of the participant Ledger API (e.g. "http://localhost:5003" or "https://participant.example.com") */
  baseUrl: string;
  /** Optional static bearer token (overrides getToken if set) */
  authToken?: string;
  /** Optional async token getter (e.g. Keycloak); used when authToken is not set */
  getToken?: () => Promise<string | null>;
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

  /** Resolve Bearer token: static authToken or getToken() (e.g. Keycloak). */
  private async resolveAuthToken(): Promise<string | null> {
    if (this.config.authToken) return this.config.authToken;
    if (this.config.getToken) return await this.config.getToken();
    return null;
  }

  /**
   * Prepare a transaction using /v2/interactive-submission/prepare.
   * Returns the prepared transaction (base64) and metadata.
   */
  async prepare(params: PrepareExecuteParams): Promise<PrepareResponse> {
    const url = `${this.config.baseUrl}/v2/interactive-submission/prepare`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = await this.resolveAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const body = {
      commands: params.commands || [],
      act_as: params.actAs || [],
      read_as: params.readAs || [],
      disclosed_contracts: params.disclosedContracts || [],
      package_id_selection_preference: params.packageIdSelectionPreference || [],
      // Optional: command_id, workflow_id, synchronizer_id, min_ledger_time_abs, etc.
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = await this.resolveAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

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
   * Uses POST /v2/query (JSON Ledger API) - no Loop/cantonloop.com calls.
   */
  async queryActiveContracts(
    partyId: string,
    templateId: { packageId: string; moduleName: string; entityName: string }
  ): Promise<unknown[]> {
    const url = `${this.config.baseUrl}/v2/interactive-submission/prepare`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = await this.resolveAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const body = {
      template_ids: [templateId],
      query: {},
      read_as: [partyId],
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Query active contracts failed (${response.status}): ${text}`);
    }

    const data = await response.json();
    const results = data.result ?? data.results ?? data;
    return Array.isArray(results) ? results : [];
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

/**
 * Get participant config from environment or defaults.
 */
export function getParticipantConfig(): CantonParticipantConfig {
  const authToken = import.meta.env.VITE_CANTON_PARTICIPANT_TOKEN;
  return {
    baseUrl:
      import.meta.env.VITE_CANTON_PARTICIPANT_URL ||
      "https://api.validator.dev.digik.cantor8.tech/api/ledger",
    authToken: authToken || undefined,
  };
}

/**
 * Create a participant client with default config.
 */
export function createParticipantClient(): CantonParticipantClient {
  return new CantonParticipantClient(getParticipantConfig());
}
