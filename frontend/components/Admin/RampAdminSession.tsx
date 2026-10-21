/**
 * The ramp console's operator context (truthoracle-backend docs/RAMP.md §6.5, §12.2): who the
 * backend operator session is — party, person and roles from `GET /admin/session` — and the
 * decision signer. It sits inside BackendOperatorProvider and loads once that session is ready.
 * Panels read the roles to offer only what the operator may ask (the backend enforces them), and
 * sign approval decisions through the same Cantor8 `signMessage` path the admin sign-in uses
 * (lib/backendAdmin.ts signInAsBackendAdmin): one popup per click, the signature first.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCantonWallet } from "@/wallets";
import { WALLET_DISPLAY_NAME } from "@/config";
import { fetchAdminSessionInfo } from "@/lib/backendAdmin";
import { makeDecisionSigner, makeMessageSigner, type DecisionSigner, type MessageSigner } from "@/lib/rampAdmin";
import { rampAdminErrorMessage } from "@/lib/rampAdminErrors";
import type { ApiAdminSession } from "@/lib/rampAdminTypes";
import { useBackendOperator } from "./BackendOperatorSession";

interface RampAdminState {
  /** null until loaded, and when the backend has no `GET /admin/session` (roles unknown). */
  session: ApiAdminSession | null;
  loadError: string | null;
  /** The backend operator session's party (the provider's), for when `session` is unknown. */
  operatorParty: string | null;
  /** Decisions carry a wallet signature unless the backend says signatures are off (dev). */
  signaturesRequired: boolean;
  /**
   * The signature for a decision, or undefined when signatures are off. Must be the FIRST thing a
   * click awaits: it opens the wallet popup, and a browser grants one popup per click.
   */
  signDecision: DecisionSigner;
  /**
   * The signature over a message the backend asked for (C23: a releasing single-control request,
   * after its 400). Same rule: the FIRST thing its click awaits.
   */
  signRequest: MessageSigner;
  reload: () => Promise<void>;
}

const Ctx = createContext<RampAdminState | null>(null);

export function RampAdminSessionProvider({ children }: { children: ReactNode }) {
  const { ready, session: backendSession } = useBackendOperator();
  const { account, signMessage } = useCantonWallet();
  const [session, setSession] = useState<ApiAdminSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSession(await fetchAdminSessionInfo());
      setLoadError(null);
    } catch (e) {
      setSession(null);
      setLoadError(rampAdminErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (!ready) {
      setSession(null);
      return;
    }
    void reload();
  }, [ready, reload]);

  const operatorParty = session?.party ?? backendSession?.partyId ?? null;
  const signaturesRequired = session?.approvalSignatures !== false;

  // Synchronous checks only before the popup: nothing is awaited ahead of signMessage.
  const signDecision = useMemo<DecisionSigner>(
    () =>
      makeDecisionSigner({
        required: signaturesRequired,
        walletParty: account?.partyId,
        operatorParty,
        walletName: WALLET_DISPLAY_NAME,
        signMessage,
      }),
    [signaturesRequired, account?.partyId, operatorParty, signMessage],
  );
  const signRequest = useMemo<MessageSigner>(
    () => makeMessageSigner({ walletParty: account?.partyId, operatorParty, walletName: WALLET_DISPLAY_NAME, signMessage }),
    [account?.partyId, operatorParty, signMessage],
  );

  const value = useMemo<RampAdminState>(
    () => ({ session, loadError, operatorParty, signaturesRequired, signDecision, signRequest, reload }),
    [session, loadError, operatorParty, signaturesRequired, signDecision, signRequest, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRampAdmin(): RampAdminState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRampAdmin must be used within RampAdminSessionProvider");
  return ctx;
}
