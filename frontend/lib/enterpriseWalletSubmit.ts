/**
 * Submit admin transactions via the self-hosted Enterprise Wallet (v0.1.28+):
 * one call to POST /api/v1/external/submit — the wallet prepares + signs + executes
 * with the admin party's key.
 *
 * Cantor8 popup cannot sign for the Enterprise Wallet admin party — keys live in Docker.
 */
import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { normalizeCommands } from "@/utils/normalizeCommand";
import { adminInstanceHeaders } from "@/lib/adminSession";
import {
  ENTERPRISE_WALLET_APP_NAME,
  ENTERPRISE_WALLET_PARTY_ID,
  ENTERPRISE_WALLET_PROXY_URL,
} from "@/config";

// The Enterprise Wallet runs with AUTH_TYPE=keycloak, but the Bearer token is minted
// and attached SERVER-SIDE by the wallet proxy (api/proxy/wallet.mjs + the dev
// middleware). Browser calls go through ENTERPRISE_WALLET_PROXY_URL with no
// credentials, so no Keycloak secret is needed (or present) in the frontend.
//
// The proxy requires an admin session cookie on every path — these commands are
// signed with the treasury key, so they are operator-only. Ordinary user flows never
// come through here: deposit credits and payout settlement are the accounts backend's
// (session-authenticated, amounts derived server-side — see lib/inAppWallet.ts).

export function enterpriseWalletPartyId(): string {
  return ENTERPRISE_WALLET_PARTY_ID;
}

function appName(): string {
  return ENTERPRISE_WALLET_APP_NAME;
}

function walletBaseUrl(): string {
  return ENTERPRISE_WALLET_PROXY_URL;
}

export function isEnterpriseWalletForAdmin(): boolean {
  const party = enterpriseWalletPartyId();
  if (!party) return false;
  return Boolean(ENTERPRISE_WALLET_PROXY_URL);
}

/**
 * Admin txs (CreateMarket, RecordResult): Enterprise Wallet when configured,
 * otherwise fall back to the connected browser wallet.
 */
export async function submitAdminTransaction(
  params: PrepareExecuteParams,
  signAndSubmitTransaction: (p: PrepareExecuteParams) => Promise<{ hash: string }>
): Promise<{ hash: string }> {
  if (isEnterpriseWalletForAdmin()) {
    return submitViaEnterpriseWallet(params);
  }
  return signAndSubmitTransaction(params);
}

export async function submitViaEnterpriseWallet(
  params: PrepareExecuteParams
): Promise<{ hash: string }> {
  const partyId = params.actAs?.[0] ?? enterpriseWalletPartyId();
  if (!partyId) {
    throw new Error(
      "VITE_ENTERPRISE_WALLET_PARTY_ID is not set. Set it in .env (see the enterprise-wallet repository README)."
    );
  }

  const commandId = (params.commandId as string | undefined) ?? `cmd-${Date.now()}-${crypto.randomUUID()}`;
  const body = {
    partyId,
    appName: appName(),
    commandId,
    commands: normalizeCommands(params.commands),
    disclosedContracts: params.disclosedContracts ?? [],
  };

  const res = await fetch(`${walletBaseUrl()}/api/v1/external/submit`, {
    method: "POST",
    // The session cookie plus the in-memory instance header authorise this call;
    // either half alone is rejected (the pair dies with the page load).
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...adminInstanceHeaders() },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      throw new Error(
        "Your admin session has expired or you are not signed in as an operator. " +
          "Reload /admin and sign in again.",
      );
    }
    throw new Error(`Enterprise wallet external/submit failed (${res.status}): ${text}`);
  }

  const text = await res.text();
  if (!text) return { hash: commandId };
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const returnedCommandId = data.commandId ?? data.command_id;
    return { hash: String(returnedCommandId ?? commandId) };
  } catch {
    return { hash: text || commandId };
  }
}
