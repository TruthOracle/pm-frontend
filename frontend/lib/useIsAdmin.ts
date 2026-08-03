import { useCantonWallet } from "@/wallets";
import { ENTERPRISE_WALLET_PARTY_ID } from "@/config";

/**
 * True only when the connected wallet's partyId matches VITE_ENTERPRISE_WALLET_PARTY_ID.
 * Used to gate admin-only UI (Create Market tab, /admin route).
 */
export function useIsAdmin(): boolean {
  const { account } = useCantonWallet();
  if (!ENTERPRISE_WALLET_PARTY_ID || !account?.partyId) return false;
  return account.partyId === ENTERPRISE_WALLET_PARTY_ID;
}
