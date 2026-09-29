/**
 * The marketplace, Kalshi's browse page: filter chips (Trending · New · Closing soon · Volume),
 * the header rail's category and a search box narrowing a grid of event cards; each card shows
 * its top outcomes with live prices. With the backend index the events come from the catalog
 * (`GET /events?withNestedMarkets=true&sort=…`) and the cards' sparklines from
 * `GET /markets?withSparkline=true`; on a ledger-only deployment only a market grid exists.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Flame, Loader2, Search, Sparkles, Timer, TrendingUp } from "lucide-react";
import EventCard from "./EventCard";
import MarketCard from "./MarketCard";
import { cn } from "@/lib/utils";
import { marketSource, type MarketSourceKind } from "@/lib/marketsApi";
import { useEventsList, useMarketsList } from "@/lib/marketQueries";
import type { ApiEvent, ApiSparkline, EventSort } from "@/lib/marketsTypes";
import type { PredictionMarketRecord } from "@/utils/activeContracts";
import { getPrefetchedMarkets } from "@/utils/marketPrefetch";

type Tab = "active" | "settled";

const SORTS: Array<{ key: EventSort; label: string; icon: typeof Flame }> = [
  { key: "trending", label: "Trending", icon: Flame },
  { key: "newest", label: "New", icon: Sparkles },
  { key: "closing", label: "Closing soon", icon: Timer },
  { key: "volume", label: "Volume", icon: TrendingUp },
];

const isSettled = (m: PredictionMarketRecord) => m.status === "Resolved" || m.status === "Voided";

function EventGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="k-card space-y-3 p-4">
          <div className="flex gap-3">
            <div className="skeleton h-11 w-11 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3 w-1/3" />
              <div className="skeleton h-4 w-5/6" />
            </div>
          </div>
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

const Marketplace = () => {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const seriesFilter = params.get("series") ?? "";
  const search = params.get("q") ?? "";
  const sort = (params.get("sort") as EventSort | null) ?? "trending";
  const [tab, setTab] = useState<Tab>("active");
  const [source, setSource] = useState<MarketSourceKind | null>(null);
  const [ledgerMarkets, setLedgerMarkets] = useState<PredictionMarketRecord[]>(() => getPrefetchedMarkets() ?? []);

  // Which source answers decides the page: the catalog (events) or the bare market grid.
  useEffect(() => {
    let active = true;
    marketSource.all().then((res) => {
      if (!active) return;
      setSource(res.source);
      setLedgerMarkets(res.markets);
    });
    (window as { refreshMarketplace?: () => void }).refreshMarketplace = () => {
      void marketSource.all().then((res) => {
        if (active) setLedgerMarkets(res.markets);
      });
    };
    return () => {
      active = false;
      delete (window as { refreshMarketplace?: () => void }).refreshMarketplace;
    };
  }, []);

  const indexed = source === "index";
  const q = search.trim();
  const events = useEventsList(
    { withNestedMarkets: true, sort, status: tab === "active" ? "all" : "settled", category: category || undefined, series: seriesFilter || undefined, q: q || undefined, limit: 100 },
    indexed,
  );
  const sparkMarkets = useMarketsList({ withSparkline: true, status: "active", limit: 100 }, indexed);
  const sparklines = useMemo(() => {
    const map = new Map<string, ApiSparkline | null>();
    for (const m of sparkMarkets.data?.items ?? []) map.set(m.ticker, m.sparkline ?? null);
    return map;
  }, [sparkMarkets.data]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const shownEvents: ApiEvent[] = useMemo(() => {
    const items = events.data?.items ?? [];
    return tab === "active" ? items.filter((e) => e.status !== "settled") : items;
  }, [events.data, tab]);

  const shownMarkets = useMemo(() => {
    const lower = q.toLowerCase();
    return ledgerMarkets.filter(
      (m) =>
        (tab === "active" ? !isSettled(m) : isSettled(m)) &&
        (!category || m.category.toLowerCase() === category.toLowerCase()) &&
        (!lower || m.question.toLowerCase().includes(lower) || m.ticker.toLowerCase().includes(lower) || m.eventTicker.toLowerCase().includes(lower)),
    );
  }, [ledgerMarkets, tab, category, q]);

  const heading = seriesFilter ? `Series ${seriesFilter}` : category ? category : "Markets";
  const loading = source === null || (indexed && events.isLoading && !events.data);

  return (
    <div className="page-container py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-slate-950 sm:text-[28px]">{heading}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {indexed ? `${shownEvents.length} event${shownEvents.length === 1 ? "" : "s"} · prices are live pm-AMM quotes` : "Every market on the ledger"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs font-bold text-slate-500">
            {(["active", "settled"] as Tab[]).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1.5 capitalize transition-colors", tab === t ? "bg-white text-slate-950 shadow-sm" : "hover:text-slate-950")}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "none" }}>
          {indexed &&
            SORTS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setParam("sort", key === "trending" ? null : key)} className={cn("k-chip", sort === key && "k-chip-active")}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          {(category || seriesFilter) && (
            <button type="button" onClick={() => { setParam("category", null); setParam("series", null); }} className="k-chip">
              {seriesFilter ? `Series ${seriesFilter}` : category} ×
            </button>
          )}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Search events and markets"
            value={search}
            onChange={(e) => setParam("q", e.target.value || null)}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-950 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
      </div>

      {loading ? (
        <EventGridSkeleton />
      ) : indexed ? (
        events.isError ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-500">Could not load the events. Retrying…</div>
        ) : shownEvents.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200">
            <p className="text-sm font-semibold text-slate-700">{q ? "No events match your search." : tab === "active" ? "No open events yet." : "No settled events yet."}</p>
            <p className="text-xs text-slate-500">{q ? "Try a ticker, an outcome or a topic." : "Markets appear here as soon as an operator lists them."}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shownEvents.map((e) => (
              <EventCard key={e.ticker} event={e} sparklines={sparklines} />
            ))}
          </div>
        )
      ) : shownMarkets.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200">
          {source === null ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <p className="text-sm text-slate-500">{q ? "No markets match your search." : tab === "active" ? "No active markets yet." : "No settled markets yet."}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shownMarkets.map((m) => (
            <MarketCard key={m.contractId} market={m} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
