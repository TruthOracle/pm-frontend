import { useCantonWallet } from "@/wallets";
import { Copy, LogOut, X } from "lucide-react";
import { useCallback, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/use-toast";
import { getCantonCoinHoldings, type AmuletHoldings } from "@/view-functions/getAccountBalance";
import { useQuery } from "@tanstack/react-query";
import Pusher from "pusher-js";
import { MODULE_ADDRESS, PUSHER_CLUSTER, PUSHER_KEY, WALLET_DISPLAY_NAME } from "@/config";

function truncatePartyId(partyId: string, chars = 6): string {
  if (!partyId || partyId.length <= chars * 2) return partyId;
  return `${partyId.slice(0, chars)}...${partyId.slice(-chars)}`;
}

let pusher: Pusher | null = null;
try {
  if (PUSHER_KEY && PUSHER_CLUSTER) {
    pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER, enabledTransports: ["ws", "wss"] });
  }
} catch {
  // ignore
}

interface AccountEvent {
  version: number;
  event_type: string;
  event_data: any;
  timestamp: number;
}

export function WalletSelector() {
  const { account, disconnect, connected, connect } = useCantonWallet();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [events, setEvents] = useState<any[]>([]);

  const { data: holdings } = useQuery<AmuletHoldings>({
    queryKey: ["canton-coin-holdings", account?.address],
    refetchInterval: 10_000,
    queryFn: () => getCantonCoinHoldings(),
    enabled: !!account?.address,
  });

  useEffect(() => {
    if (connected && account && pusher) {
      if (pusher.connection.state === "connected") setWsStatus("connected");
      else setWsStatus("connecting");
      const channel = pusher.subscribe("account-events");
      channel.bind("account-event", (data: any) => {
        setEvents((prev) => [data, ...prev].slice(0, 10));
      });
      pusher.connection.bind("state_change", (states: any) => {
        if (states.current === "connected") setWsStatus("connected");
        else if (states.current === "disconnected" || states.current === "failed") setWsStatus("disconnected");
        else if (states.current === "connecting") setWsStatus("connecting");
      });
      return () => {
        channel.unbind_all();
        channel.unsubscribe();
        setWsStatus("disconnected");
      };
    }
  }, [connected, account]);

  const formatEvent = (event: AccountEvent) => {
    const date = new Date(event.timestamp * 1000);
    const timeString = date.toLocaleTimeString();
    switch (event.event_type) {
      case `${MODULE_ADDRESS}::truthoracle::MarketCreated`:
        return `${timeString} - Created market: ${event.event_data.market_id}`;
      case `${MODULE_ADDRESS}::truthoracle::buy_shares`:
        return `${timeString} - Bought shares: ${event.event_data.amount} for market ${event.event_data.market_id}`;
      case `${MODULE_ADDRESS}::truthoracle::withdraw_payout`:
        return `${timeString} - Withdrew payout: ${event.event_data.amount} from market ${event.event_data.market_id}`;
      default:
        return `${timeString} - ${event.event_type}`;
    }
  };

  const closeDialog = useCallback(() => setIsDialogOpen(false), []);

  const handleConnect = useCallback(async () => {
    try {
      await connect();
      closeDialog();
    } catch (err: any) {
      const msg = err?.details ?? err?.message ?? "Could not connect to Canton wallet";
      const isNetworkError = /failed to fetch|network|NetworkError/i.test(String(msg));
      toast({
        variant: "destructive",
        title: "Connection failed",
        description: isNetworkError
          ? "Could not reach Loop wallet. Check your connection and try again."
          : msg,
      });
    }
  }, [connect, closeDialog, toast]);

  return connected ? (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button className="rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          {account ? truncatePartyId(account.address) : "Unknown"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" style={{ zIndex: 1101 }}>
        <div className="px-4 py-2">
          <p className="text-sm font-medium">{WALLET_DISPLAY_NAME} wallet · Canton Coin</p>
          <p className="text-2xl font-bold">
            {(holdings?.balance ?? 0).toFixed(2)} CC
          </p>
          <p className="text-xs text-gray-400">
            ≈ ${(holdings?.balanceUsd ?? 0).toFixed(2)} USD
          </p>
          {(holdings?.lockedBalance ?? 0) > 0 && (
            <p className="text-xs text-amber-400 mt-1">
              Locked: {(holdings?.lockedBalance ?? 0).toFixed(2)} CC (≈ ${(holdings?.lockedBalanceUsd ?? 0).toFixed(2)})
            </p>
          )}
          <p className="text-xs text-gray-500 mt-2">
            Balance in your connected {WALLET_DISPLAY_NAME} wallet. Trading spends your in-app
            wallet balance — deposit from here to top it up.
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            navigator.clipboard.writeText(account?.address || "");
            toast({ title: "Address copied", description: "Your party ID has been copied to clipboard" });
          }}
          className="flex gap-2"
        >
          <Copy className="h-4 w-4" /> Copy party ID
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-4 py-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Recent Activity</p>
            <span
              className={`text-xs px-2 py-1 rounded ${
                wsStatus === "connected" ? "bg-green-100 text-green-800" : wsStatus === "connecting" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"
              }`}
            >
              {wsStatus}
            </span>
          </div>
          <div className="max-h-32 overflow-y-auto">
            {events.length > 0 ? (
              events.map((event, index) => (
                <p key={index} className="text-sm text-muted-foreground py-1 border-b last:border-0">
                  {formatEvent(event.data)}
                </p>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No recent activity</p>
            )}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={disconnect} className="gap-2">
          <LogOut className="h-4 w-4" /> Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <>
      <Button onClick={() => setIsDialogOpen(true)} className="rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
        Connect Wallet
      </Button>
      {isDialogOpen && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-white/35 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsDialogOpen(false); }}>
          <div className="relative grid w-full max-w-lg gap-4 rounded-lg border bg-background p-6 shadow-lg" role="dialog" aria-modal="true" aria-labelledby="connect-wallet-title">
            <button type="button" onClick={() => setIsDialogOpen(false)} className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
            <h2 id="connect-wallet-title" className="text-center text-lg font-semibold leading-snug">Connect to Cantor8 Network</h2>
            <div className="flex flex-col gap-4 pt-4">
              <p className="text-center text-sm text-muted-foreground">Connect your Cantor8 wallet (e.g. Splice Wallet) to use TruthOracle.</p>
              <Button size="lg" onClick={handleConnect} className="w-full">Connect Cantor8 Wallet</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
