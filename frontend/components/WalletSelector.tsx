import { useCantonWallet } from "@/wallets";
import { Copy, LogOut } from "lucide-react";
import { useCallback, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

function truncatePartyId(partyId: string, chars = 6): string {
  if (!partyId || partyId.length <= chars * 2) return partyId;
  return `${partyId.slice(0, chars)}...${partyId.slice(-chars)}`;
}

let pusher: Pusher | null = null;
try {
  const pusherKey = process.env.NEXT_PUBLIC_PUSHER_KEY || "5c9c8369bdc5cdcb8b7c";
  const pusherCluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "ap2";
  if (pusherKey && pusherCluster) {
    pusher = new Pusher(pusherKey, { cluster: pusherCluster, enabledTransports: ["ws", "wss"] });
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
    const moduleAddress = process.env.NEXT_PUBLIC_MODULE_ADDRESS || "0xbde9b5978954614b28adf8e8c71d919271ccad89a878d4d914249444a31f2b49";
    switch (event.event_type) {
      case `${moduleAddress}::truthoracle::MarketCreated`:
        return `${timeString} - Created market: ${event.event_data.market_id}`;
      case `${moduleAddress}::truthoracle::buy_shares`:
        return `${timeString} - Bought shares: ${event.event_data.amount} for market ${event.event_data.market_id}`;
      case `${moduleAddress}::truthoracle::withdraw_payout`:
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>{account ? truncatePartyId(account.address) : "Unknown"}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" style={{ zIndex: 1101 }}>
        <div className="px-4 py-2">
          <p className="text-sm font-medium">Canton Coin</p>
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
            Native validator balance. Separate from your TruthOracle trading balance (Portfolio page).
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
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button className="font-jbm text-xl">Connect a Wallet</Button>
      </DialogTrigger>
      <DialogContent className="max-h-screen overflow-auto">
        <DialogHeader>
          <DialogTitle style={{ zIndex: 1 }} className="flex flex-col text-center leading-snug">
            Connect to Cantor8 Network
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-4">
          <p className="text-sm text-muted-foreground text-center">
            Connect your Cantor8 wallet (e.g. Splice Wallet) to use TruthOracle.
          </p>
          <Button size="lg" onClick={handleConnect} className="w-full">
            Connect Cantor8 Wallet
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}




