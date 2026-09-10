/**
 * "The wallet you just connected is not on your account — link it?"
 *
 * Rendered by AuthProvider only (one prompt for the whole app, once per party per page
 * load). It is a fixed card rather than a modal because the person may have connected
 * the wallet for an anonymous-style action and should not be interrupted; linking is an
 * offer, not a requirement.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@chakra-ui/react";
import { Link2, Wallet, X } from "lucide-react";
import { WALLET_DISPLAY_NAME } from "@/config";
import { shortPartyId } from "@/lib/party";
import { authErrorMessage } from "@/auth/wallet";

export function LinkWalletPrompt({
  partyId,
  onLink,
  onDismiss,
}: {
  partyId: string;
  onLink: () => Promise<void>;
  onDismiss: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keyboard dismissal for a passive card: Escape closes it unless the popup is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onDismiss]);

  const handleLink = async () => {
    setBusy(true);
    setError(null);
    try {
      await onLink();
      toast({
        title: "Wallet linked",
        description: `${shortPartyId(partyId)} is now part of your account.`,
        status: "success",
        duration: 4000,
        isClosable: true,
      });
      onDismiss();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      // A region, not a dialog: nothing modal happens, focus is never moved here, and
      // aria-live announces the offer when it appears.
      role="region"
      aria-live="polite"
      aria-labelledby="link-wallet-prompt-title"
      className="fixed bottom-4 right-4 z-[1050] w-[calc(100vw-2rem)] max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Wallet className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p id="link-wallet-prompt-title" className="text-sm font-semibold text-slate-900">
            Link this wallet to your account?
          </p>
          <p className="mt-1 text-xs text-slate-600">
            The connected {WALLET_DISPLAY_NAME} wallet{" "}
            <code className="break-all font-mono text-slate-800">{shortPartyId(partyId)}</code> is not on your
            account yet. Linking lets deposits from it count towards your balance.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Linked as a second wallet it can deposit only: shares and CC it already holds stay withdrawable with
            this wallet's key but cannot be traded from your account. If it is the wallet you trade from, make it
            the primary instead.
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Your wallet will ask you to approve a short message — a signature, not a transaction.
          </p>
          {error ? (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleLink}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Link2 className="h-3.5 w-3.5" />
              {busy ? "Waiting for your wallet…" : "Link wallet"}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="shrink-0 rounded-sm text-slate-400 opacity-70 transition-opacity hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
