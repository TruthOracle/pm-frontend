/**
 * Submit admin transactions via the self-hosted Enterprise Wallet (v0.1.28+):
 * one call to POST /api/v1/external/submit — the wallet prepares + signs + executes
 * with the admin party's key.
 *
 * Cantor8 popup cannot sign for the Enterprise Wallet admin party — keys live in Docker.
 */
import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { normalizeCommands } from "@/utils/normalizeCommand";

export function enterpriseWalletPartyId(): string {
  return String(import.meta.env.VITE_ENTERPRISE_WALLET_PARTY_ID ?? "").trim();
}

function appName(): string {
  return String(import.meta.env.VITE_ENTERPRISE_WALLET_APP_NAME ?? "truthoracle").trim();
}

function walletBaseUrl(): string {
  if (import.meta.env.DEV) {
    return "/__proxy/wallet";
  }
  const raw = String(import.meta.env.VITE_ENTERPRISE_WALLET_URL ?? "http://localhost:8080").trim();
  return raw.replace(/\/$/, "");
}

export function useEnterpriseWalletForAdmin(): boolean {
  const party = enterpriseWalletPartyId();
  if (!party) return false;
  const url = String(import.meta.env.VITE_ENTERPRISE_WALLET_URL ?? "http://localhost:8080").trim();
  return Boolean(url);
}

/**
 * Admin txs (CreateMarket, AddParticipant, RecordResult): Enterprise Wallet when configured,
 * otherwise fall back to the connected browser wallet.
 */
export async function submitAdminTransaction(
  params: PrepareExecuteParams,
  signAndSubmitTransaction: (p: PrepareExecuteParams) => Promise<{ hash: string }>
): Promise<{ hash: string }> {
  if (useEnterpriseWalletForAdmin()) {
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
      "VITE_ENTERPRISE_WALLET_PARTY_ID is not set. Set it in .env (see wallet-deploy/README.md)."
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
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
