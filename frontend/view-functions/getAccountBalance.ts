/**
 * Fetch the connected Cantor8 wallet's Amulet (Canton Coin) holdings. Returns
 * balance in whole CC units plus the USD equivalent the validator surfaces
 * alongside it.
 *
 * Two sources, in order:
 *   1. wallet-backend `/api/balance` (via the same-origin relay) — fresh, and the
 *      only one with the locked-balance breakdown.
 *   2. the holdings the wallet itself last reported to the app (popup at connect
 *      time, session restore, accountChanged). Used when (1) yields nothing, so a
 *      relay/backend hiccup shows the wallet's last known balance instead of a
 *      misleading 0. Read passively — never via the SDK's `getAccounts()`, which
 *      re-polls the backend and destroys the session on a 401.
 */

import { C8_BACKEND_URL } from "@/config";
import { debugWarn } from "@/lib/debugLog";
import { getC8Accounts } from "@/wallets/cantor8/c8Provider";

function getWalletBackendUrl(): string {
  return C8_BACKEND_URL;
}

/**
 * Cantor8 SDK persists the session bearer to localStorage under `c8-session`
 * as `{ authToken, accounts, expireAt }`. The wallet-backend's `/api/balance`
 * derives the party from this token (no path/query param needed).
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

function num(v: string | number | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Each distinct failure is warned once — the header polls this every 10 s. */
const warned = new Set<string>();
function warnOnce(reason: string, ...detail: unknown[]): void {
  if (warned.has(reason)) return;
  warned.add(reason);
  debugWarn(`[balance] ${reason}`, ...detail);
}

/** Source 1: wallet-backend `/api/balance` → holdings.Amulet. Null on any failure. */
async function holdingsFromWalletBackend(): Promise<AmuletHoldings | null> {
  const token = getCantor8BearerToken();
  if (!token) {
    warnOnce("no Cantor8 session token in localStorage (c8-session) — /api/balance skipped");
    return null;
  }
  try {
    const res = await fetch(`${getWalletBackendUrl()}/api/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-feat-decimals": "1",
      },
    });
    if (!res.ok) {
      warnOnce(`wallet-backend /api/balance returned HTTP ${res.status}`, await res.text().catch(() => ""));
      return null;
    }
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
    if (!amulet) {
      warnOnce("wallet-backend /api/balance has no holdings.Amulet entry", data);
      return null;
    }
    return {
      balance: num(amulet.balance),
      balanceUsd: num(amulet.balance_usd),
      lockedBalance: num(amulet.locked_balance),
      lockedBalanceUsd: num(amulet.locked_balance_usd),
    };
  } catch (e) {
    warnOnce("wallet-backend /api/balance request failed", e);
    return null;
  }
}

/**
 * Source 2: the Amulet holding from the accounts payload the wallet last delivered
 * to the app (see c8Provider). No network call, no locked-balance breakdown.
 */
function holdingsFromWalletSdk(): AmuletHoldings | null {
  const amulet = getC8Accounts()[0]?.holdings?.find((h) => h.instrumentId === "Amulet");
  if (!amulet) return null;
  return {
    balance: num(amulet.balance),
    balanceUsd: num(amulet.balanceUsd),
    lockedBalance: 0,
    lockedBalanceUsd: 0,
  };
}

/**
 * Connected-wallet Canton Coin holdings. Returns zeros only when neither the
 * wallet-backend nor the wallet SDK can say, so callers can render a 0 instead of
 * breaking the UI.
 */
export async function getCantonCoinHoldings(): Promise<AmuletHoldings> {
  const fromBackend = await holdingsFromWalletBackend();
  if (fromBackend) return fromBackend;
  return holdingsFromWalletSdk() ?? EMPTY;
}
