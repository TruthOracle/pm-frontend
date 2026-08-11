import { useCantonWallet } from "@/wallets";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { WalletSelector } from "./WalletSelector";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useToast } from "@chakra-ui/react";
import { cn } from "@/lib/utils";
import { Briefcase, ChevronRight, Coins, Gift, HelpCircle, Menu, Newspaper, PlusCircle, Search, TrendingUp, X } from "lucide-react";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { to: "/marketplace", label: "Markets", icon: TrendingUp },
  { to: "/portfolio", label: "Portfolio", icon: Briefcase },
  { to: "/rewards", label: "Rewards", icon: Gift },
  { to: "/faq", label: "FAQ", icon: HelpCircle },
  { to: "/news", label: "News", icon: Newspaper },
];

const TOPICS = ["Trending", "Combos", "Perps", "Breaking", "News", "Politics", "Sports", "Crypto", "Esports", "Iran", "Finance", "Geopolitics", "Tech", "Culture", "Economy", "Weather"];

export function Header() {
  const { account } = useCantonWallet();
  const isAdmin = useIsAdmin();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

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

  const isActive = (path: string) => (path === "/" ? location.pathname === "/" : location.pathname.startsWith(path));

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(search.trim() ? `/marketplace?search=${encodeURIComponent(search.trim())}` : "/marketplace");
  };

  return (
    <header className="glass-header">
      <div className="page-container relative flex h-[4.35rem] items-center justify-between gap-4">
        {/* Logo */}
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <div className="brand-mark flex h-9 w-9 items-center justify-center rounded-md shadow-sm ring-1 ring-slate-950/10">
            <img src="/logonobg.svg" alt="TruthOracle" className="h-6 w-6" />
          </div>
          <span className="hidden text-base font-extrabold tracking-tight text-slate-950 sm:block">
            Truth<span className="text-primary">Oracle</span>
          </span>
        </Link>

        {/* Nav */}
        <form className="header-search hidden lg:flex" onSubmit={submitSearch}>
          <Search className="h-4 w-4 shrink-0" />
          <input aria-label="Search markets, topics or news" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search markets, topics or news" />
          <kbd>/</kbd>
        </form>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "nav-link rounded-md px-3 py-2",
                isActive(to) && "nav-link-active bg-slate-100 text-primary",
              )}
            >
              {label}
            </Link>
          ))}
          {isAdmin && (
            <Link
              to="/admin"
              className={cn(
                "nav-link flex items-center gap-1.5 rounded-md px-3 py-2",
                isActive("/admin") && "nav-link-active bg-emerald-50 text-primary ring-1 ring-emerald-100",
              )}
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Create Market
            </Link>
          )}
        </nav>

        {/* Actions */}
        <div className="hidden items-center gap-2 md:flex lg:gap-3">
          <button
            onClick={handleGetCantonCoin}
            className="hidden items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:border-primary/40 hover:text-primary xl:flex"
          >
            <Coins className="h-3.5 w-3.5" />
            Get CC
          </button>
          <WalletSelector />
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:border-primary/30 hover:text-primary md:hidden"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label="Open navigation menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        {mobileMenuOpen && (
          <div className="absolute left-4 right-4 top-full mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-300/60 md:hidden">
            <nav className="divide-y divide-slate-100">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-emerald-50 hover:text-primary",
                    isActive(to) && "bg-emerald-50 text-primary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
              {isAdmin && (
                <Link
                  to="/admin"
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-emerald-50 hover:text-primary",
                    isActive("/admin") && "bg-emerald-50 text-primary",
                  )}
                >
                  <PlusCircle className="h-4 w-4" />
                  Create Market
                </Link>
              )}
            </nav>
            <div className="space-y-3 border-t border-slate-100 bg-slate-50/70 p-4">
              <button
                onClick={(event) => {
                  handleGetCantonCoin(event);
                  setMobileMenuOpen(false);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
              >
                <Coins className="h-4 w-4" />
                Get CC
              </button>
              <div className="flex justify-center">
                <WalletSelector />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="header-topic-row">
        <div className="page-container flex h-10 items-center gap-5 overflow-hidden whitespace-nowrap">
          {TOPICS.map((topic, index) => (
            <Link key={topic} to={topic === "News" ? "/news" : `/marketplace?category=${encodeURIComponent(topic)}`} className={cn("header-topic", index === 0 && "header-topic-active")}>
              {index === 0 && <TrendingUp className="h-3.5 w-3.5" />}{topic}
            </Link>
          ))}
          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400" />
        </div>
      </div>
    </header>
  );
}
