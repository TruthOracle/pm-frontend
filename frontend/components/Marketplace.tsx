import { useCantonWallet } from "@/wallets";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  fetchAllPredictionMarkets,
  type PredictionMarketRecord,
} from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import { Search, Loader2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPrefetchedMarkets } from "@/utils/marketPrefetch";

type Tab = "active" | "resolved";

const isSettled = (m: PredictionMarketRecord) =>
  m.status === "Resolved" || m.status === "Voided";

const Marketplace = () => {
  const { account } = useCantonWallet();
  const [markets, setMarkets] = useState<PredictionMarketRecord[]>(() => getPrefetchedMarkets() ?? []);
  const [loading, setLoading] = useState(() => markets.length === 0);
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("All");

  const fetchMarkets = useCallback(async () => {
    if (markets.length > 0) return;
    setLoading(true);
    try {
      setMarkets(await fetchAllPredictionMarkets());
    } finally {
      setLoading(false);
    }
  }, [markets.length]);

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
    <div className="page-container py-8">
      {/* Page header */}
      <div className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="section-title">Markets</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Trade on real-world outcomes through the dynamic pm-AMM. Buy Yes or No shares on any market.
        </p>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Tabs */}
        <div className="flex gap-1 rounded-full bg-secondary p-1">
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
        <div className="relative w-full sm:w-72">
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m) => (
            <MarketCard key={m.contractId} market={m} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
