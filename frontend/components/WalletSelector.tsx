/**
 * Header wallet chip. One control whose label is always the next click, driven by the
 * same account view (useAccountWallet) as the trade CTA and the in-app wallet card so
 * the three never disagree (ARCHITECTURE §16 states A/B/C):
 *
 *   nothing connected            → "Connect Cantor8 wallet"   (click = connect(), one popup)
 *   connected, not on the account (C) → amber "abc…xyz · Not linked" ▾  menu: "Link wallet to account"
 *                                                              (click = signMessage over the
 *                                                              challenge AuthContext prefetched, one popup)
 *   connected, primary (A)       → green "abc…xyz · Primary" ▾  balance, copy, disconnect
 *   connected, deposit-only (B)  → amber "abc…xyz · Deposit only" ▾  + "Connect <primary> to trade"
 *   connected, no account view   → plain "abc…xyz" ▾           (backend unavailable / unreachable)
 *
 * Every popup-opening handler here calls the SDK first (wallets/cantor8/popupGesture.ts).
 * Rendered by Header's WalletControl only for a signed-in person or a deployment without
 * an accounts backend — connecting a wallet is never a way to sign in.
 */
import { useCallback, useState } from "react";
import { Copy, Link2, LogOut, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { useCantonWallet } from "@/wallets";
import { useAccountWallet, useAuth } from "@/auth/AuthContext";
import { authErrorMessage } from "@/auth/wallet";
import { getCantonCoinHoldings, type AmuletHoldings } from "@/view-functions/getAccountBalance";
import { WALLET_DISPLAY_NAME } from "@/config";
import { shortPartyId } from "@/lib/party";

type Badge = { text: string; tone: "ok" | "warn" } | null;

export function WalletSelector() {
  const { account, connected, connect, disconnect } = useCantonWallet();
  const auth = useAuth();
  const { me, walletState, primaryPartyId } = useAccountWallet();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"connect" | "link" | null>(null);

  const { data: holdings } = useQuery<AmuletHoldings>({
    queryKey: ["canton-coin-holdings", account?.address],
    refetchInterval: 10_000,
    queryFn: () => getCantonCoinHoldings(),
    enabled: !!account?.address,
  });

  // connect() is the first statement: the browser grants one popup per click.
  const handleConnect = useCallback(async () => {
    setBusy("connect");
    try {
      await connect();
    } catch (err) {
      toast({ variant: "destructive", title: "Could not connect the wallet", description: authErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  }, [connect, toast]);

  // The link challenge was prefetched by AuthContext, so the popup is the first await.
  const handleLink = useCallback(async () => {
    setBusy("link");
    try {
      await auth.linkConnectedWallet();
      toast({ title: "Wallet linked", description: `${shortPartyId(account?.address ?? "")} is now on your account.` });
    } catch (err) {
      toast({ variant: "destructive", title: "Could not link the wallet", description: authErrorMessage(err) });
    } finally {
      setBusy(null);
    }
  }, [auth, account?.address, toast]);

  if (!connected || !account) {
    return (
      <Button
        onClick={() => void handleConnect()}
        disabled={busy !== null}
        className="rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        <Wallet className="mr-1.5 h-4 w-4" />
        {busy === "connect" ? "Waiting for your wallet…" : `Connect ${WALLET_DISPLAY_NAME} wallet`}
      </Button>
    );
  }

  // Only a loaded account view can say how this party relates to the account.
  const accountKnown = auth.status === "authenticated" && me !== null;
  const badge: Badge = !accountKnown
    ? null
    : walletState === "primary"
      ? { text: "Primary", tone: "ok" }
      : walletState === "linked"
        ? { text: "Deposit only", tone: "warn" }
        : walletState === "unlinked"
          ? { text: "Not linked", tone: "warn" }
          : null;
  const chipClass =
    badge?.tone === "warn"
      ? "border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
      : badge?.tone === "ok"
        ? "border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
        : "bg-primary text-primary-foreground hover:bg-primary/90";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button className={`rounded-lg px-4 text-sm font-semibold ${chipClass}`} title={badge ? `${WALLET_DISPLAY_NAME} wallet · ${badge.text}` : `${WALLET_DISPLAY_NAME} wallet`}>
          {shortPartyId(account.address)}
          {badge ? <span className="ml-2 text-xs font-bold uppercase tracking-wide opacity-80">· {badge.text}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" style={{ zIndex: 1101 }}>
        {walletState === "unlinked" && accountKnown ? (
          <>
            <div className="px-4 py-2">
              <p className="text-sm font-semibold text-amber-900">This wallet is not on your account yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Link it to deposit from it. Your wallet will ask you to approve a short message — a signature, not a
                transaction.
              </p>
            </div>
            <DropdownMenuItem
              onSelect={() => void handleLink()}
              disabled={busy !== null}
              className="mx-2 mb-1 flex cursor-pointer gap-2 rounded-md bg-primary text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground"
            >
              <Link2 className="h-4 w-4" /> {busy === "link" ? "Waiting for your wallet…" : "Link wallet to account"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <div className="px-4 py-2">
          <p className="text-sm font-medium">{WALLET_DISPLAY_NAME} wallet · Canton Coin</p>
          <p className="text-2xl font-bold">{(holdings?.balance ?? 0).toFixed(2)} CC</p>
          <p className="text-xs text-gray-400">≈ ${(holdings?.balanceUsd ?? 0).toFixed(2)} USD</p>
          {(holdings?.lockedBalance ?? 0) > 0 && (
            <p className="mt-1 text-xs text-amber-400">
              Locked: {(holdings?.lockedBalance ?? 0).toFixed(2)} CC (≈ ${(holdings?.lockedBalanceUsd ?? 0).toFixed(2)})
            </p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            Balance in your connected {WALLET_DISPLAY_NAME} wallet. Trading spends your in-app wallet balance — deposit
            from here to top it up.
          </p>
          {walletState === "linked" && primaryPartyId ? (
            <p className="mt-2 text-xs text-amber-700">
              Deposit-only wallet: connect {shortPartyId(primaryPartyId)} to trade or withdraw.
            </p>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard.writeText(account.address);
            toast({ title: "Address copied", description: "Your party ID has been copied to clipboard" });
          }}
          className="flex gap-2"
        >
          <Copy className="h-4 w-4" /> Copy party ID
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void disconnect()} className="gap-2">
          <LogOut className="h-4 w-4" /> Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
