import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, Layers, Loader2, Search } from "lucide-react";
import MarketCard from "./MarketCard";
import EventCard from "./EventCard";
import { cn } from "@/lib/utils";
import { fetchEvents, fetchSeriesList, marketSource, type MarketSourceKind } from "@/lib/marketsApi";
import type { ApiEvent, ApiSeries } from "@/lib/marketsTypes";
import type { PredictionMarketRecord } from "@/utils/activeContracts";
import { getPrefetchedMarkets } from "@/utils/marketPrefetch";

type Tab = "active" | "resolved";
type View = "events" | "markets";

const isSettled = (m: PredictionMarketRecord) => m.status === "Resolved" || m.status === "Voided";

/**
 * The marketplace, laid out like an exchange: events (a question with its markets) first,
 * every market second, filtered by the series' category. With the backend index the events
 * and categories come from the catalog; on a ledger-only deployment only the market grid and
 * the markets' own free-text categories exist.
 */
const Marketplace = () => {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "All";
  const seriesFilter = params.get("series");
  const search = params.get("q") ?? "";
  const [view, setView] = useState<View>("events");
  const [tab, setTab] = useState<Tab>("active");
  const [markets, setMarkets] = useState<PredictionMarketRecord[]>(() => getPrefetchedMarkets() ?? []);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [series, setSeries] = useState<ApiSeries[]>([]);
  const [source, setSource] = useState<MarketSourceKind | null>(null);
  const [loading, setLoading] = useState(() => markets.length === 0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await marketSource.all();
        if (!active) return;
        setMarkets(res.markets);
        setSource(res.source);
        if (res.source === "index") {
          const [ev, se] = await Promise.all([
            fetchEvents({ status: "all", withNestedMarkets: true, limit: 100 }),
            fetchSeriesList({ status: "active" }),
          ]);
          if (!active) return;
          setEvents(ev.items);
          setSeries(se.items);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    (window as { refreshMarketplace?: () => void }).refreshMarketplace = () => {
      void marketSource.all().then((res) => setMarkets(res.markets));
    };
    return () => {
      delete (window as { refreshMarketplace?: () => void }).refreshMarketplace;
    };
  }, []);

  useEffect(() => {
    if (source === "ledger") setView("markets");
  }, [source]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of series) if (s.category) set.add(s.category);
    for (const m of markets) if (m.category) set.add(m.category);
    return ["All", ...Array.from(set).sort()];
  }, [series, markets]);

  const setCategory = (c: string) => {
    const next = new URLSearchParams(params);
    if (c === "All") next.delete("category");
    else next.set("category", c);
    next.delete("series");
    setParams(next, { replace: true });
  };
  const setSearch = (q: string) => {
    const next = new URLSearchParams(params);
    if (q) next.set("q", q);
    else next.delete("q");
    setParams(next, { replace: true });
  };

  const matchesCategory = (c: string) => category === "All" || c.toLowerCase() === category.toLowerCase();
  const q = search.trim().toLowerCase();

  const filteredMarkets = useMemo(() => {
    const base = markets.filter((m) => (tab === "active" ? !isSettled(m) : isSettled(m)));
    return base.filter(
      (m) =>
        matchesCategory(m.category) &&
        (!seriesFilter || m.seriesTicker === seriesFilter) &&
        (!q || m.question.toLowerCase().includes(q) || (m.ticker ?? "").toLowerCase().includes(q) || (m.eventTicker ?? "").toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets, tab, category, seriesFilter, q]);

  const filteredEvents = useMemo(() => {
    return events.filter(
      (e) =>
        (tab === "active" ? e.status !== "settled" : e.status === "settled") &&
        matchesCategory(e.category) &&
        (!seriesFilter || e.seriesTicker === seriesFilter) &&
        (!q || e.title.toLowerCase().includes(q) || e.ticker.toLowerCase().includes(q) || (e.markets ?? []).some((m) => m.question.toLowerCase().includes(q))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, tab, category, seriesFilter, q]);

  const activeCount = view === "events" ? events.filter((e) => e.status !== "settled").length : markets.filter((m) => !isSettled(m)).length;
  const settledCount = view === "events" ? events.filter((e) => e.status === "settled").length : markets.filter(isSettled).length;

  return (
    <div className="page-container py-8">
      <div className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h1 className="section-title">Markets</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Trade on real-world outcomes through the dynamic pm-AMM. An event groups the markets on one question; buy Yes or No shares on any of them.
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {source === "index" && (
            <div className="flex gap-1 rounded-full bg-secondary p-1">
              <button className={cn("tab-pill", view === "events" ? "tab-pill-active" : "tab-pill-inactive")} onClick={() => setView("events")}>
                <Layers className="mr-1 inline h-3.5 w-3.5" />
                Events
              </button>
              <button className={cn("tab-pill", view === "markets" ? "tab-pill-active" : "tab-pill-inactive")} onClick={() => setView("markets")}>
                Markets
              </button>
            </div>
          )}
          <div className="flex gap-1 rounded-full bg-secondary p-1">
            <button className={cn("tab-pill", tab === "active" ? "tab-pill-active" : "tab-pill-inactive")} onClick={() => setTab("active")}>
              Active ({activeCount})
            </button>
            <button className={cn("tab-pill", tab === "resolved" ? "tab-pill-active" : "tab-pill-inactive")} onClick={() => setTab("resolved")}>
              Settled ({settledCount})
            </button>
          </div>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search markets, tickers, events…" value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-9" />
        </div>
      </div>

      {categories.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                category.toLowerCase() === c.toLowerCase() ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
          {seriesFilter && (
            <button onClick={() => setCategory("All")} className="rounded-full bg-oracle-purple/10 px-3 py-1 text-xs font-medium text-oracle-purple">
              Series {seriesFilter} ×
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : view === "events" && source === "index" ? (
        filteredEvents.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border">
            <Layers className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{q ? "No events match your search." : tab === "active" ? "No open events yet." : "No settled events yet."}</p>
            {markets.length > 0 && (
              <button className="quiet-link text-xs" onClick={() => setView("markets")}>
                Show every market instead
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((e) => (
              <EventCard key={e.ticker} event={e} />
            ))}
          </div>
        )
      ) : filteredMarkets.length === 0 ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border">
          <BarChart3 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{q ? "No markets match your search." : tab === "active" ? "No active markets yet." : "No settled markets yet."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMarkets.map((m) => (
            <MarketCard key={m.contractId} market={m} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Marketplace;
