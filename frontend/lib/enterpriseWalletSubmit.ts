/**
 * Submit admin transactions via the self-hosted Enterprise Wallet (same hybrid flow as
 * scripts/create-contract.ts): prepare on the participant, sign+execute on the wallet.
 *
 * Cantor8 popup cannot sign for the Enterprise Wallet admin party — keys live in Docker.
 */
import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { createParticipantClient } from "@/lib/cantonParticipant";

export function enterpriseWalletPartyId(): string {
  return String(import.meta.env.VITE_ENTERPRISE_WALLET_PARTY_ID ?? "").trim();
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

  const client = createParticipantClient();
  const commandId = `cmd-${Date.now()}-${crypto.randomUUID()}`;
  const prepared = await client.prepare(params, commandId);

  if (!prepared.preparedTransactionHash) {
    throw new Error("Prepare did not return preparedTransactionHash (required by Enterprise Wallet)");
  }

  const res = await fetch(`${walletBaseUrl()}/api/v1/transaction/sign_and_execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partyId,
      preparedTxB64: prepared.preparedTransaction,
      hashingSchemeVersion: prepared.hashingSchemeVersion,
      hashB64: prepared.preparedTransactionHash,
      commandId: prepared.commandId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Enterprise wallet sign_and_execute failed (${res.status}): ${text}`);
  }

  const text = await res.text();
  if (!text) return { hash: prepared.commandId };
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const hash =
      data.transactionId ?? data.transaction_id ?? data.updateId ?? data.update_id ?? prepared.commandId;
    return { hash: String(hash) };
  } catch {
    return { hash: text || prepared.commandId };
  }
}
