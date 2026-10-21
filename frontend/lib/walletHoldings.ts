/**
 * The connected Cantor8 wallet's own balances, read from the Cantor8 wallet backend
 * (`GET /api/balance`, bearer = the SDK's session token). The backend keys holdings by its
 * own token ids (`Amulet` for Canton Coin, `cBYN`, `TRO`, …) and reports every token the
 * party holds, so this read returns ONE row per token and never singles one out: the UI
 * picks the row for the instrument it is showing (`holdingFor`) and labels it through the
 * instrument catalog's `walletInstrumentId` (lib/instruments.ts `instrumentForWalletId`),
 * never by a literal. Failures (no session, network, unknown shape) read as "no holdings"
 * so a chip or a position box renders a 0 instead of breaking.
 */

import { C8_BACKEND_URL } from "@/config";
import { debugWarn } from "@/lib/debugLog";

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

export interface WalletHolding {
  /** The id the wallet backend lists this token under; resolve it against the catalog for a symbol. */
  walletInstrumentId: string;
  /** Balance in whole token units (e.g. 597.5). */
  balance: number;
  /** USD equivalent surfaced by the validator (e.g. 77.675). */
  balanceUsd: number;
  /** Locked balance (e.g. in-flight transfers). */
  lockedBalance: number;
  /** USD equivalent of the locked balance. */
  lockedBalanceUsd: number;
}

interface RawHolding {
  balance?: string | number;
  balance_usd?: string | number;
  locked_balance?: string | number;
  locked_balance_usd?: string | number;
}

function num(v: string | number | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Every holding the wallet backend reports for the connected party, one row per token id,
 * in the backend's order. Empty when there is no session or the call fails.
 */
export async function fetchWalletHoldings(): Promise<WalletHolding[]> {
  const token = getCantor8BearerToken();
  if (!token) return [];
  try {
    const res = await fetch(`${C8_BACKEND_URL}/api/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-feat-decimals": "1",
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { holdings?: Record<string, RawHolding> };
    const holdings = data.holdings && typeof data.holdings === "object" ? data.holdings : {};
    return Object.entries(holdings).map(([walletInstrumentId, h]) => ({
      walletInstrumentId,
      balance: num(h?.balance),
      balanceUsd: num(h?.balance_usd),
      lockedBalance: num(h?.locked_balance),
      lockedBalanceUsd: num(h?.locked_balance_usd),
    }));
  } catch (e) {
    debugWarn("fetchWalletHoldings", e);
    return [];
  }
}

/** The row for one wallet token id, or null when the wallet reports none for it. */
export function holdingFor(
  holdings: readonly WalletHolding[] | null | undefined,
  walletInstrumentId: string,
): WalletHolding | null {
  return (holdings ?? []).find((h) => h.walletInstrumentId === walletInstrumentId) ?? null;
}
