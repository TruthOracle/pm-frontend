/**
 * Direct probes against the v1 Cantor8 wallet API for command/transfer status.
 *
 * Why this exists: the bundled @cantor8/wallet-connect-sdk@0.2.0-alpha.3 polls a
 * legacy `/api/transfer/status?command_id=...` path that's not in the v1 OpenAPI
 * spec, returning 404 for non-transfer commands. The current spec defines:
 *   GET /api/v1/command/{partyId}/{commandId}   — generic command status
 *   GET /api/v1/transfer/{partyId}/{commandId}  — transfer-only status
 * These helpers call those endpoints directly so we can confirm which one returns
 * useful data for a Daml `Trade` command.
 */

/** Devnet/mainnet wallet backend URL — mirrors the SDK's `origin → backend` switch. */
function getWalletBackendUrl(): string {
  const network = String(import.meta.env.VITE_APP_NETWORK ?? "devnet").toLowerCase().trim();
  if (network === "mainnet") return "https://wallet-backend.main.cantor8.tech";
  return "https://wallet-backend.dev.digik.cantor8.tech";
}

/**
 * The Cantor8 SDK persists the bearer token to localStorage under "c8-session" as
 * `{ authToken, partyIds }` (see SessionManager in @cantor8/wallet-connect-sdk).
 * Reading it here is intentionally coupled to that key.
 */
function getCantor8BearerToken(): string | null {
  try {
    const raw = localStorage.getItem("c8-session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { authToken?: string };
    return typeof parsed?.authToken === "string" && parsed.authToken ? parsed.authToken : null;
  } catch {
    return null;
  }
}

export interface WalletApiResult {
  ok: boolean;
  status: number;
  url: string;
  body: unknown;
}

async function callWalletApi(path: string): Promise<WalletApiResult> {
  const url = `${getWalletBackendUrl()}${path}`;
  const token = getCantor8BearerToken();
  const headers: Record<string, string> = { "x-feat-decimals": "1" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(url, { method: "GET", headers });
    let body: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { ok: res.ok, status: res.status, url, body };
  } catch (e) {
    return { ok: false, status: 0, url, body: e instanceof Error ? e.message : String(e) };
  }
}

export async function getWalletCommandStatus(partyId: string, commandId: string): Promise<WalletApiResult> {
  return callWalletApi(`/api/v1/command/${encodeURIComponent(partyId)}/${encodeURIComponent(commandId)}`);
}

export async function getWalletTransferStatus(partyId: string, commandId: string): Promise<WalletApiResult> {
  return callWalletApi(`/api/v1/transfer/${encodeURIComponent(partyId)}/${encodeURIComponent(commandId)}`);
}

/** Liveness probe — no auth required per the v1 spec. */
export async function getWalletHealth(): Promise<WalletApiResult> {
  return callWalletApi(`/health`);
}

/** Account details — proves the bearer token works and the partyId is valid. */
export async function getWalletAccount(partyId: string): Promise<WalletApiResult> {
  return callWalletApi(`/api/v1/accounts/${encodeURIComponent(partyId)}`);
}

/** Recent transfers — does the wallet record this party's activity at all? */
export async function getWalletTransferHistory(partyId: string): Promise<WalletApiResult> {
  return callWalletApi(`/api/v1/transfer/${encodeURIComponent(partyId)}?limit=10`);
}

/**
 * Probe both v1 status endpoints at several timestamps so the developer can see in
 * the console which one actually returns data for our `Trade` commandId, and watch
 * the status transition (pending → success/failed). Fire-and-forget; never throws.
 */
export async function probeWalletStatusEndpoints(partyId: string, commandId: string): Promise<void> {
  console.log(
    `[wallet-status] probing for commandId=${commandId} party=${partyId.slice(0, 24)}…`,
  );

  // Run once at start: confirm the v1 API is live, our auth works, and whether
  // the wallet has any history at all for this party.
  const [health, account, history] = await Promise.all([
    getWalletHealth(),
    getWalletAccount(partyId),
    getWalletTransferHistory(partyId),
  ]);
  console.log("[wallet-status] preflight:", {
    "GET /health": { status: health.status, body: health.body },
    "GET /api/v1/accounts/{partyId}": { status: account.status, body: account.body },
    "GET /api/v1/transfer/{partyId}?limit=10": { status: history.status, body: history.body },
  });

  // Then poll the per-command endpoints over ~30s to catch status transitions.
  const checkpoints = [0, 2000, 5000, 15000, 30000];
  for (const delay of checkpoints) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const [cmdRes, xferRes] = await Promise.all([
      getWalletCommandStatus(partyId, commandId),
      getWalletTransferStatus(partyId, commandId),
    ]);
    console.log(
      `[wallet-status] t+${delay}ms\n` +
        `  GET /api/v1/command/{partyId}/{commandId}  → ${cmdRes.status}\n` +
        `  GET /api/v1/transfer/{partyId}/{commandId} → ${xferRes.status}`,
      { command: cmdRes, transfer: xferRes },
    );
  }
}
