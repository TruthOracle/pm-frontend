/**
 * Fetch the connected Cantor8 wallet's Amulet (Canton Coin) holdings from the
 * Cantor8 wallet backend. Returns balance in whole CC units plus the USD
 * equivalent the validator surfaces alongside it.
 */

import { LOOP_NETWORK } from "@/config";
import { debugWarn } from "@/lib/debugLog";

function getWalletBackendUrl(): string {
  if (LOOP_NETWORK === "mainnet") return "https://wallet-backend.main.digik.cantor8.tech";
  return "https://wallet-backend.dev.digik.cantor8.tech";
}

/**
 * Cantor8 SDK persists the session bearer to localStorage under `c8-session`
 * as `{ authToken, partyIds }`. The wallet-backend's `/api/balance` derives
 * the party from this token (no path/query param needed).
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

export interface AmuletHoldings {
  /** Canton Coin balance, whole CC units (e.g. 597.5). */
  balance: number;
  /** USD equivalent surfaced by the validator (e.g. 77.675). */
  balanceUsd: number;
  /** Locked CC (e.g. in flight transfers). */
  lockedBalance: number;
  /** USD equivalent of locked CC. */
  lockedBalanceUsd: number;
}

const EMPTY: AmuletHoldings = {
  balance: 0,
  balanceUsd: 0,
  lockedBalance: 0,
  lockedBalanceUsd: 0,
};

/**
 * Hit wallet-backend `/api/balance` and parse holdings.Amulet. Returns zeros on
 * failure (no token, network error, missing Amulet entry) so callers can render
 * a 0 instead of breaking the UI.
 */
export async function getCantonCoinHoldings(): Promise<AmuletHoldings> {
  const token = getCantor8BearerToken();
  if (!token) return EMPTY;
  try {
    const res = await fetch(`${getWalletBackendUrl()}/api/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-feat-decimals": "1",
      },
    });
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as {
      holdings?: Record<
        string,
        {
          balance?: string | number;
          balance_usd?: string | number;
          locked_balance?: string | number;
          locked_balance_usd?: string | number;
        }
      >;
    };
    const amulet = data.holdings?.Amulet;
    if (!amulet) return EMPTY;
    const num = (v: string | number | undefined): number => {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      }
      return 0;
    };
    return {
      balance: num(amulet.balance),
      balanceUsd: num(amulet.balance_usd),
      lockedBalance: num(amulet.locked_balance),
      lockedBalanceUsd: num(amulet.locked_balance_usd),
    };
  } catch (e) {
    debugWarn("getCantonCoinHoldings", e);
    return EMPTY;
  }
}
