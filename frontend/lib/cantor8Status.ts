/**
 * Direct probes against the Cantor8 wallet backend
 * (https://wallet-backend.dev.digik.cantor8.tech/openapi.json — devnet,
 * https://wallet-backend.main.cantor8.tech for mainnet).
 *
 * Why this exists: the bundled @cantor8/wallet-connect-sdk polls
 * `/api/transfer/status?command_id=...` which only knows about *transfers* — for a
 * Daml `Trade` (which is submitted via `/api/external/execute`) the right status
 * endpoint is `/api/command/{command_id}/status`. These helpers call the real
 * endpoints from the OpenAPI spec so the dApp can confirm a Trade committed.
 *
 * Endpoints (all require Bearer auth except /healthz):
 *   GET /healthz                              — liveness
 *   GET /api/balance                          — party_id + holdings (auth proof)
 *   GET /api/command/{command_id}/status      — generic command status (works for Trade)
 *   GET /api/transfer/status?command_id=...   — transfer-only status (404s for Trade)
 *   GET /api/transfer/history?limit=10        — recent transfers (deprecated but functional)
 */

import { APP_NETWORK, DEBUG_WALLET_STATUS } from "@/config";

/** Devnet/mainnet wallet backend URL — mirrors the SDK's `origin → backend` switch. */
function getWalletBackendUrl(): string {
  const network = APP_NETWORK.toLowerCase().trim();
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

/** Generic command status — works for Trade and other /api/external/execute commands. */
export async function getWalletCommandStatus(_partyId: string, commandId: string): Promise<WalletApiResult> {
  return callWalletApi(`/api/command/${encodeURIComponent(commandId)}/status`);
}

/** Transfer-only status — 404s for non-transfer commands like Trade; kept for parity logging. */
export async function getWalletTransferStatus(_partyId: string, commandId: string): Promise<WalletApiResult> {
  return callWalletApi(`/api/transfer/status?command_id=${encodeURIComponent(commandId)}`);
}

/** Liveness probe — no auth required. */
export async function getWalletHealth(): Promise<WalletApiResult> {
  return callWalletApi(`/healthz`);
}

/**
 * Auth/account proof. The OpenAPI spec has no per-party `/accounts/{id}` endpoint; the
 * authenticated `/api/balance` call returns the bearer-token's `party_id` + holdings,
 * which serves the same diagnostic purpose (confirms auth works for this party).
 */
export async function getWalletAccount(_partyId: string): Promise<WalletApiResult> {
  return callWalletApi(`/api/balance`);
}

/** Recent transfers — `/api/transfer/history?limit=N`. Marked deprecated in the spec but still functional. */
export async function getWalletTransferHistory(_partyId: string): Promise<WalletApiResult> {
  return callWalletApi(`/api/transfer/history?limit=10`);
}

/**
 * Probe wallet command status. Was broken (401) because we read the bearer
 * token via localStorage and the SDK has its own session manager. Now disabled
 * by default — set `VITE_DEBUG_WALLET_STATUS=true` to re-enable for debugging.
 *
 * The actual trade flow doesn't depend on this; it's diagnostic logging only.
 * For real "did the trade commit" checks, poll the participant for
 * UserMarketData (see `waitForPositionUpdate` in MarketView).
 */
export async function probeWalletStatusEndpoints(partyId: string, commandId: string): Promise<void> {
  if (!DEBUG_WALLET_STATUS) return;
  console.log(
    `[wallet-status] probing for commandId=${commandId} party=${partyId.slice(0, 24)}… (enable VITE_DEBUG_WALLET_STATUS=true to see this)`,
  );
  const cmdRes = await getWalletCommandStatus(partyId, commandId);
  console.log("[wallet-status]", { command: cmdRes });
}
