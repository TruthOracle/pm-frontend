import { useCantonWallet } from "@/wallets";
import { WalletSelector } from "./WalletSelector";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { useAuth } from "@/auth/AuthContext";
import { Link, useLocation } from "react-router-dom";
import { useToast } from "@chakra-ui/react";
import { cn } from "@/lib/utils";
import { Coins, Info, LogIn, Menu, Search, TrendingUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const NAV_ITEMS = [
  { to: "/marketplace", label: "Markets" },
  { to: "/news", label: "News" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/rewards", label: "Rewards" },
];
const TOPICS = ["Trending", "Politics", "Sports", "Crypto", "Business", "Culture", "Science", "World"];

/**
 * Account control next to the wallet selector. Nothing at all when the deployment has
 * no accounts backend (the app then looks exactly as it did before accounts) or while
 * the first probe is still in flight (no "Sign in" flash for someone who is signed in).
 * A backend that exists but does not answer shows a disabled "Sign in" — the button is
 * the affordance that says accounts exist here; AuthProvider retries on its own.
 * The dialog itself is rendered once by AuthProvider, so this can appear twice
 * (desktop bar + mobile menu) without doubling it.
 */
function AuthControl() {
  const { status, openLogin } = useAuth();
  if (status === "authenticated") return <AccountMenu />;
  if (status === "unreachable") {
    return (
      <button
        type="button"
        disabled
        title="The accounts service is not reachable right now; retrying automatically."
        className="header-utility inline-flex cursor-not-allowed opacity-60"
      >
        <LogIn className="h-3.5 w-3.5" /> Sign in
      </button>
    );
  }
  if (status !== "anonymous") return null;
  return (
    <button type="button" onClick={() => openLogin("login")} className="header-utility inline-flex">
      <LogIn className="h-3.5 w-3.5" /> Sign in
    </button>
  );
}

export function Header() {
  const { account } = useCantonWallet();
  const location = useLocation();
  const toast = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMobileMenuOpen(false), [location.pathname]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!searchQuery.trim() && !searchRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [searchOpen, searchQuery]);

  const handleGetCantonCoin = (e: React.MouseEvent) => {
    e.preventDefault();
    toast({
      title: account ? "Canton Coin" : "Connect wallet first",
      description: account ? "Use the network faucet or transfer to get Canton Coin on testnet." : "Connect your wallet to receive Canton Coin.",
      status: "info", duration: 4000, isClosable: true,
    });
  };
  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <header className="site-header">
      <div className="page-container">
        <div className="flex h-[4.25rem] items-center gap-4">
          <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="TruthOracle home">
            <div className="brand-mark"><img src="/logonobg.svg" alt="" className="h-4 w-4" /></div>
            <span className="text-base font-extrabold tracking-[-0.04em] text-slate-950">Truth<span className="text-primary">Oracle</span></span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map(({ to, label }) => <Link key={to} to={to} className={cn("product-nav-link", isActive(to) && "product-nav-link-active")}>{label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {searchOpen ? (
              <div ref={searchRef} className="search-inline hidden md:flex" role="search">
                <Search className="h-4 w-4 shrink-0 text-primary" />
                <input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search markets" aria-label="Search markets" />
                <button type="button" onClick={() => { setSearchQuery(""); setSearchOpen(false); }} aria-label="Close search"><X className="h-4 w-4 text-slate-400 hover:text-slate-700" /></button>
              </div>
            ) : (
              <button className="search-trigger hidden md:flex" onClick={() => setSearchOpen(true)} aria-label="Search markets"><Search className="h-4 w-4" /><span>Search markets</span><kbd>/</kbd></button>
            )}
            <button onClick={handleGetCantonCoin} className="header-utility hidden xl:inline-flex"><Coins className="h-3.5 w-3.5" /> Get CC</button>
            <div className="header-wallet"><WalletSelector /></div>
            <div className="hidden sm:flex"><AuthControl /></div>
            <button className="mobile-menu-button lg:hidden" onClick={() => setMobileMenuOpen((open) => !open)} aria-label="Toggle menu">{mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        <div className="category-rail"><div className="flex min-w-max items-center gap-6">
          {TOPICS.map((topic, index) => <Link key={topic} to={`/marketplace?category=${topic.toLowerCase()}`} className={cn("topic-link", index === 0 && "topic-link-active")}>{index === 0 && <TrendingUp className="h-3.5 w-3.5" />}{topic}</Link>)}
          <Link to="/faq" className="topic-link !font-semibold !text-emerald-700 hover:!text-emerald-800"><Info className="h-3.5 w-3.5" /> How it works</Link>
        </div></div>
        {mobileMenuOpen && <div className="mobile-menu lg:hidden"><div className="grid gap-1">{NAV_ITEMS.map(({ to, label }) => <Link key={to} to={to} className={cn("mobile-nav-link", isActive(to) && "text-primary")}>{label}</Link>)}</div><div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"><WalletSelector /><AuthControl /></div></div>}
      </div>
    </header>
  );
}
