/**
 * Wallets: every Canton party linked to the account (§8). One of them is primary — it
 * owns the on-ledger UserWallet the whole account trades from — and that choice is
 * permanent once a deposit exists, which is why the note sits right under the badge.
 */
import { useState } from "react";
import { useToast } from "@chakra-ui/react";
import { Crown, Link2, RefreshCw, Star, Unlink, Wallet as WalletIcon } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import type { MeResponse, Wallet } from "@/auth/types";
import { backendFetch } from "@/lib/backend";
import { useCantonWallet } from "@/wallets";
import { WALLET_DISPLAY_NAME } from "@/config";
import { shortPartyId } from "@/lib/party";
import { creditPendingDeposits, moneyErrorMessage } from "@/lib/inAppWallet";
import { formatMoney } from "@/lib/instruments";
import { authErrorMessage } from "@/auth/wallet";
import { accountErrorMessage, type ErrorSentences } from "@/lib/backendErrors";
import {
  ConfirmDialog,
  CopyButton,
  Pill,
  SectionCard,
  fmtDateTime,
  moneyIsPositive,
  primaryBtn,
  smallBtn,
} from "./accountUi";

const PRIMARY_NOTE = "The primary wallet owns your in-app balance and cannot change once you have deposited.";

/** Shown before a second wallet is linked: only the primary wallet's key trades and withdraws (§8.1). */
const SECOND_WALLET_NOTE =
  "A second wallet is deposit-only: it can fund your in-app balance but cannot trade from it or withdraw it — those need the primary wallet's key. If this is the wallet you trade from, make it the primary instead.";

// Wallets are not sign-in methods (§8.1), so the only refusal is the primary rule (§8.2).
const UNLINK_ERRORS: ErrorSentences = {
  primary_wallet_in_use: "This is your primary wallet: it owns your in-app balance and can't be unlinked.",
};

const PRIMARY_ERRORS: ErrorSentences = {
  primary_wallet_in_use:
    "Your primary wallet can't change once you have deposited or have a withdrawal in progress.",
};

type PendingAction = { kind: "unlink" | "primary"; wallet: Wallet };

export default function WalletsSection({ me }: { me: MeResponse }) {
  const auth = useAuth();
  const toast = useToast();
  const { account, connect } = useCantonWallet();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Connecting and linking are two clicks on purpose: each opens a wallet popup, and the
  // browser allows one popup per click (wallets/cantor8/popupGesture.ts). Once connected
  // the wallet shows as unlinked and the "Link connected wallet" button takes over.
  const connectWallet = async () => {
    setConnecting(true);
    try {
      await connect();
    } catch (e) {
      toast({ title: "Could not connect the wallet", description: authErrorMessage(e), status: "error", duration: 8000, isClosable: true });
    } finally {
      setConnecting(false);
    }
  };
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = account?.address ?? null;
  const primaryParty = me.capabilities.primaryPartyId ?? me.user.partyId;
  const hasDeposit = me.wallets.some((w) => w.isPrimary && w.credits.some((c) => moneyIsPositive(c.credited)));
  const hasWallets = me.wallets.some((w) => w.status === "active");
  const wallets = [...me.wallets].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(a.status === "revoked") - Number(b.status === "revoked"));

  const linkConnected = async () => {
    setLinking(true);
    try {
      await auth.linkConnectedWallet();
      toast({ title: "Wallet linked", description: connected ? shortPartyId(connected) : undefined, status: "success", duration: 4000, isClosable: true });
    } catch (e) {
      toast({
        title: "Could not link wallet",
        description: authErrorMessage(e),
        status: "error",
        duration: 8000,
        isClosable: true,
      });
    } finally {
      setLinking(false);
    }
  };

  /**
   * Re-run the §8.3 reconcile without moving any tokens — the way out when a transfer
   * reached the treasury but its credit never showed (an index that lagged, an expired
   * session mid-deposit). Deliberately unconditional: the only cheap signal that
   * something is owed lives in GET /in-app-wallet's attribution, which this page does
   * not run on load. Reconciles the default collateral; the wallet card reconciles the
   * instrument it is showing.
   */
  const creditPending = async () => {
    setCrediting(true);
    try {
      const res = await creditPendingDeposits({ windowMs: 10_000 });
      if (res.status === "nothing_outstanding") {
        toast({ title: "Nothing outstanding", description: "Every transfer the treasury has recorded from your wallets is already credited.", status: "info", duration: 6000, isClosable: true });
      } else {
        toast({
          title: res.status === "confirmed" ? "Deposit credited" : "Credit submitted",
          description: `${formatMoney(res.credited, res.instrument)} ${res.status === "confirmed" ? "credited to" : "being credited to"} your in-app balance.`,
          status: "success",
          duration: 6000,
          isClosable: true,
        });
        await auth.refresh();
      }
    } catch (e) {
      toast({ title: "Could not credit deposits", description: moneyErrorMessage(e), status: "error", duration: 8000, isClosable: true });
    } finally {
      setCrediting(false);
    }
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === "unlink") {
        await backendFetch<{ ok: true }>(`/api/v1/wallets/${encodeURIComponent(pending.wallet.id)}`, { method: "DELETE" });
      } else {
        await backendFetch<{ wallet: Wallet }>(`/api/v1/wallets/${encodeURIComponent(pending.wallet.id)}/primary`, {
          method: "POST",
        });
      }
      await auth.refresh();
      setPending(null);
      toast({
        title: pending.kind === "unlink" ? "Wallet unlinked" : "Primary wallet updated",
        description: shortPartyId(pending.wallet.partyId),
        status: "success",
        duration: 4000,
        isClosable: true,
      });
    } catch (e) {
      setError(accountErrorMessage(e, pending.kind === "unlink" ? UNLINK_ERRORS : PRIMARY_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      icon={<WalletIcon className="h-4 w-4" />}
      title="Wallets"
      description={`${WALLET_DISPLAY_NAME} parties linked to this account. Deposits from any of them credit the primary wallet's in-app balance.`}
      action={
        <div className="flex flex-wrap gap-2">
          {hasWallets && primaryParty && (
            <button
              type="button"
              onClick={() => void creditPending()}
              disabled={crediting}
              title="Re-check the treasury for transfers from your wallets that are not credited yet (moves no tokens)"
              className={smallBtn}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${crediting ? "animate-spin" : ""}`} /> {crediting ? "Checking…" : "Credit pending deposits"}
            </button>
          )}
          {connected === null ? (
            <button
              type="button"
              onClick={() => void connectWallet()}
              disabled={connecting}
              title={`Open the ${WALLET_DISPLAY_NAME} wallet to choose the party to link`}
              className={primaryBtn}
            >
              <WalletIcon className="h-4 w-4" /> {connecting ? "Waiting for your wallet…" : `Connect ${WALLET_DISPLAY_NAME} wallet`}
            </button>
          ) : auth.connectedWalletState === "unlinked" ? (
            <button
              type="button"
              onClick={() => void linkConnected()}
              disabled={linking}
              title={hasWallets ? SECOND_WALLET_NOTE : "Link the connected wallet to this account"}
              className={primaryBtn}
            >
              <Link2 className="h-4 w-4" /> {linking ? "Waiting for your wallet…" : "Link connected wallet"}
            </button>
          ) : null}
        </div>
      }
    >
      {auth.connectedWalletState === "unlinked" && connected && hasWallets && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          {SECOND_WALLET_NOTE}
        </p>
      )}
      {wallets.length === 0 ? (
        <p className="text-sm text-slate-500">
          No wallet linked yet. Connect your {WALLET_DISPLAY_NAME} wallet and link it to deposit and trade.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {wallets.map((w) => {
            const revoked = w.status === "revoked";
            const isConnected = connected !== null && w.partyId === connected;
            return (
              <li key={w.id} className={`flex flex-wrap items-start gap-3 py-3 ${revoked ? "opacity-60" : ""}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                  {w.isPrimary ? <Crown className="h-4 w-4 text-primary" /> : <WalletIcon className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-slate-900" title={w.partyId}>
                      {shortPartyId(w.partyId)}
                    </span>
                    <CopyButton value={w.partyId} label="Copy party id" />
                    <Pill tone="neutral">{w.kind === "cantor8" ? "Cantor8" : w.kind}</Pill>
                    {w.isPrimary && (
                      <Pill tone="ok" title={PRIMARY_NOTE}>
                        <Star className="h-3 w-3" /> Primary
                      </Pill>
                    )}
                    {isConnected && <Pill tone="info">Connected</Pill>}
                    {revoked && <Pill tone="neutral">Unlinked</Pill>}
                  </div>
                  {w.label && <div className="text-xs text-slate-600">{w.label}</div>}
                  {w.isPrimary && <p className="mt-1 text-[11px] leading-4 text-slate-500">{PRIMARY_NOTE}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                    <span title="Deposits from this wallet credited to the account's in-app balance, per instrument">
                      Credited {w.credits.length === 0 ? "nothing yet" : w.credits.map((c) => formatMoney(c.credited, c.instrument)).join(" · ")}
                    </span>
                    {w.ownLedgerWallets
                      .filter((lw) => moneyIsPositive(lw.balance))
                      .map((lw) => (
                        <span
                          key={lw.contractId}
                          className="text-slate-700"
                          title="This party has its own on-ledger wallet, separate from the account's balance. Contact support to have it folded into the account."
                        >
                          Own on-ledger balance {formatMoney(lw.balance, lw.instrument)}
                        </span>
                      ))}
                    <span>Linked {fmtDateTime(w.verifiedAt)}</span>
                  </div>
                </div>
                {!revoked && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {!w.isPrimary && (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setPending({ kind: "primary", wallet: w });
                        }}
                        disabled={hasDeposit}
                        title={hasDeposit ? PRIMARY_ERRORS.primary_wallet_in_use : "Make this the primary wallet"}
                        className={smallBtn}
                      >
                        <Star className="h-3.5 w-3.5" /> Make primary
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setPending({ kind: "unlink", wallet: w });
                      }}
                      disabled={w.isPrimary && w.partyId === primaryParty}
                      title={
                        w.isPrimary && w.partyId === primaryParty
                          ? UNLINK_ERRORS.primary_wallet_in_use
                          : "Unlink this wallet"
                      }
                      className={smallBtn}
                    >
                      <Unlink className="h-3.5 w-3.5" /> Unlink
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending?.kind === "unlink"
            ? "Unlink this wallet?"
            : `Make ${pending ? shortPartyId(pending.wallet.partyId) : ""} the primary wallet?`
        }
        description={
          pending?.kind === "unlink"
            ? `${shortPartyId(pending.wallet.partyId)} will no longer deposit into this account. It stays reserved for this account and can be re-linked later; how you sign in does not change.`
            : `${PRIMARY_NOTE} Make sure this is the wallet you will use to withdraw.`
        }
        confirmLabel={pending?.kind === "unlink" ? "Unlink" : "Make primary"}
        destructive={pending?.kind === "unlink"}
        busy={busy}
        error={error}
        onConfirm={() => void run()}
      />
    </SectionCard>
  );
}
