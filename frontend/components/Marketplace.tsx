import { useCantonWallet } from "@/wallets";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  fetchAllPredictionMarkets,
  fetchAllResolvedMarkets,
  type PredictionMarketRecord,
  type ResolvedMarketRecord,
} from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import { Search, Loader2, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "active" | "resolved";

const Marketplace = () => {
  const { account } = useCantonWallet();
  const [active, setActive] = useState<PredictionMarketRecord[]>([]);
  const [resolved, setResolved] = useState<ResolvedMarketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("active");
  const [search, setSearch] = useState("");

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const [act, res] = await Promise.all([
        fetchAllPredictionMarkets(),
        fetchAllResolvedMarkets(),
      ]);
      setActive(act);
      setResolved(res);
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

  const filteredActive = useMemo(
    () =>
      active.filter((m) =>
        m.question.toLowerCase().includes(search.toLowerCase())
      ),
    [active, search]
  );

  const filteredResolved = useMemo(
    () =>
      resolved.filter((m) =>
        m.question.toLowerCase().includes(search.toLowerCase())
      ),
    [resolved, search]
  );

  const markets = tab === "active" ? filteredActive : filteredResolved;

  return (
    <div className="page-container py-8">
      {/* Page header */}
      <div className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="section-title">Markets</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Trade on real-world outcomes. Buy Yes or No shares on any market.
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
            Resolved ({resolved.length})
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

      {/* Grid */}
      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : markets.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {search
              ? "No markets match your search."
              : tab === "active"
                ? "No active markets yet."
                : "No resolved markets yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tab === "active"
            ? filteredActive.map((m) => (
                <MarketCard
                  key={m.contractId}
                  id={m.marketId}
                  question={m.question}
                  imageUrl={m.imageUrl}
                  status={0}
                  yesShares={m.yesShares}
                  noShares={m.noShares}
                  liquidityParam={m.liquidityParam}
                />
              ))
            : filteredResolved.map((m) => (
                <MarketCard
                  key={m.contractId}
                  id={m.marketId}
                  question={m.question}
                  imageUrl=""
                  status={1}
                  result={m.result}
                />
              ))}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
