import { useCantonWallet } from "@/wallets";

/**
 * True only when the connected wallet's partyId matches VITE_ENTERPRISE_WALLET_PARTY_ID.
 * Used to gate admin-only UI (Create Market tab, /admin route).
 */
export function useIsAdmin(): boolean {
  const { account } = useCantonWallet();
  const adminParty = String(import.meta.env.VITE_ENTERPRISE_WALLET_PARTY_ID ?? "").trim();
  if (!adminParty || !account?.partyId) return false;
  return account.partyId === adminParty;
}
