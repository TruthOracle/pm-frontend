import { useCantonWallet } from "@/wallets";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchAllPredictionMarkets,
  type PredictionMarketRecord,
} from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import { Search, Loader2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "active" | "resolved";

const isSettled = (m: PredictionMarketRecord) =>
  m.status === "Resolved" || m.status === "Voided";

const Marketplace = () => {
  const { account } = useCantonWallet();
  const [searchParams] = useSearchParams();
  const [markets, setMarkets] = useState<PredictionMarketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [category, setCategory] = useState<string>("All");

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      setMarkets(await fetchAllPredictionMarkets());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets, account]);

  useEffect(() => {
    (window as { refreshMarketplace?: () => void }).refreshMarketplace = fetchMarkets;
    return () => {
      delete (window as { refreshMarketplace?: () => void }).refreshMarketplace;
    };
  }, [fetchMarkets]);

  const categories = useMemo(() => {
    const set = new Set(markets.map((m) => m.category).filter(Boolean));
    return ["All", ...Array.from(set)];
  }, [markets]);

  const active = useMemo(() => markets.filter((m) => !isSettled(m)), [markets]);
  const resolved = useMemo(() => markets.filter(isSettled), [markets]);

  const filtered = useMemo(() => {
    const base = tab === "active" ? active : resolved;
    return base.filter(
      (m) =>
        m.question.toLowerCase().includes(search.toLowerCase()) &&
        (category === "All" || m.category === category),
    );
  }, [tab, active, resolved, search, category]);

  return (
    <div className="page-container py-10">
      {/* Page header */}
      <div className="mb-8">
        <div className="mb-2 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="section-title">All markets</h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Follow live probabilities, compare liquidity and trade real-world outcomes through TruthOracle&apos;s dynamic pm-AMM.
        </p>
      </div>

      <div className="mb-8 flex gap-2 overflow-x-auto border-b border-slate-200 pb-3 text-sm font-medium text-slate-500">
        {['Trending', 'Politics', 'Crypto', 'Sports', 'World', 'Technology', 'News'].map((topic, index) => <span key={topic} className={cn('whitespace-nowrap px-2', index === 0 && 'font-bold text-primary')}>{topic}</span>)}
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          <button
            className={cn("tab-pill", tab === "active" ? "tab-pill-active" : "tab-pill-inactive")}
            onClick={() => setTab("active")}
          >
            Active ({active.length})
          </button>
          <button
            className={cn("tab-pill", tab === "resolved" ? "tab-pill-active" : "tab-pill-inactive")}
            onClick={() => setTab("resolved")}
          >
            Settled ({resolved.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search markets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>
      </div>

      {/* Category filter */}
      {categories.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                category === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {search
              ? "No markets match your search."
              : tab === "active"
                ? "No active markets yet."
                : "No settled markets yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m) => (
            <MarketCard key={m.contractId} market={m} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
