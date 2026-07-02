import { useCantonWallet } from "@/wallets";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { WalletSelector } from "./WalletSelector";
import { Link, useLocation } from "react-router-dom";
import { useToast } from "@chakra-ui/react";
import { cn } from "@/lib/utils";
import { TrendingUp, Gift, HelpCircle, PlusCircle, Coins } from "lucide-react";

const NAV_ITEMS = [
  { to: "/marketplace", label: "Markets", icon: TrendingUp },
  { to: "/portfolio", label: "Portfolio", icon: null },
  { to: "/rewards", label: "Rewards", icon: Gift },
  { to: "/faq", label: "FAQ", icon: HelpCircle },
];

export function Header() {
  const { account } = useCantonWallet();
  const isAdmin = useIsAdmin();
  const location = useLocation();
  const toast = useToast();

  const handleGetCantonCoin = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!account) {
      toast({
        title: "Connect wallet first",
        description: "Connect your wallet to receive Canton Coin.",
        status: "info",
        duration: 4000,
        isClosable: true,
      });
      return;
    }
    toast({
      title: "Canton Coin",
      description: "Use the network faucet or transfer to get Canton Coin on testnet.",
      status: "info",
      duration: 5000,
      isClosable: true,
    });
  };

  const isActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);

  return (
    <header className="glass-header">
      <div className="page-container flex h-16 items-center justify-between gap-4">
        {/* Logo */}
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
            <img src="/logonobg.svg" alt="TruthOracle" className="h-6 w-6" />
          </div>
          <span className="hidden text-base font-bold tracking-tight text-foreground sm:block">
            Truth<span className="text-primary">Oracle</span>
          </span>
        </Link>

        {/* Nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "nav-link rounded-lg px-3 py-2",
                isActive(to) && "nav-link-active bg-secondary"
              )}
            >
              {label}
            </Link>
          ))}
          {isAdmin && (
            <Link
              to="/admin"
              className={cn(
                "nav-link flex items-center gap-1.5 rounded-lg px-3 py-2",
                isActive("/admin") && "nav-link-active bg-secondary"
              )}
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Create Market
            </Link>
          )}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={handleGetCantonCoin}
            className="hidden items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:flex"
          >
            <Coins className="h-3.5 w-3.5" />
            Get CC
          </button>
          <WalletSelector />
        </div>
      </div>
    </header>
  );
}
