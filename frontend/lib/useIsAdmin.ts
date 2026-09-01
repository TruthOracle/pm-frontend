/**
 * Admin gate, backed by the server session.
 *
 * The previous version compared the connected wallet's partyId to
 * VITE_ENTERPRISE_WALLET_PARTY_ID. That had two problems: it was purely cosmetic
 * (nothing on the server checked it), and it was unsatisfiable in practice — the
 * enterprise wallet's admin party is created through the wallet API and has no
 * passkey, so no browser can ever connect AS it.
 *
 * Now the operator signs in as themselves (a party they really can connect with, on
 * the ADMIN_OPERATORS allowlist) and the server issues a session. The signing party
 * and the admin party are deliberately different things: the operator authorises the
 * action, the enterprise wallet still signs it.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchAdminSession, type AdminSession } from "@/lib/adminSession";

const PENDING: AdminSession = {
  configured: false,
  authenticated: false,
  partyId: null,
  expiresAt: null,
};

export function useAdminSession(): {
  session: AdminSession;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [session, setSession] = useState<AdminSession>(PENDING);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await fetchAdminSession();
    setSession(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchAdminSession();
      if (!cancelled) {
        setSession(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { session, loading, refresh };
}

/**
 * True once the server confirms an admin session. Returns false while the check is
 * in flight, so callers that gate a route should prefer `useAdminSession` and treat
 * `loading` separately — otherwise a signed-in operator sees a redirect flash.
 */
export function useIsAdmin(): boolean {
  const { session } = useAdminSession();
  return session.authenticated;
}
