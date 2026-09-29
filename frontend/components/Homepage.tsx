import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PredictionMarketRecord } from "@/utils/activeContracts";
import { marketSource } from "@/lib/marketsApi";
import MarketCard from "./MarketCard";
import EventCard from "./EventCard";
import TrendingEventBoard, { TrendingEventBoardEmpty, TrendingEventBoardSkeleton } from "./TrendingEventBoard";
import PriceChart from "@/components/charts/PriceChart";
import { useEventsList } from "@/lib/marketQueries";
import { compactCC, formatPercent, priceDelta } from "@/lib/chartData";
import { ArrowRight, Clock3, Loader2, Newspaper, Radio, ShieldCheck, Sparkles, TrendingUp, Zap } from "lucide-react";
import { getPrefetchedMarkets } from "@/utils/marketPrefetch";
import { fetchMarketNews, getNewsThumbnail, getTickerHeadline, NEWS_REFRESH_INTERVAL_MS, type MarketNewsItem } from "@/lib/marketNews";

function Homepage() {
  const [markets, setMarkets] = useState<PredictionMarketRecord[]>(() => getPrefetchedMarkets() ?? []);
  const [loading, setLoading] = useState(() => markets.length === 0);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [news, setNews] = useState<MarketNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsIsLive, setNewsIsLive] = useState(false);
  const [newsUpdatedAt, setNewsUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      marketSource
        .all()
        .then(({ markets: nextMarkets }) => {
          if (active) setMarkets(nextMarkets);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (markets.length < 2) return;
    const timer = window.setInterval(
      () => setFeaturedIndex((index) => (index + 1) % Math.min(markets.length, 4)),
      6500,
    );
    return () => window.clearInterval(timer);
  }, [markets.length]);
  useEffect(() => {
    let active = true;
    const refreshNews = () => {
      setNewsLoading(true);
      void fetchMarketNews().then((liveNews) => {
        if (active && liveNews.length) { setNews(liveNews); setNewsIsLive(true); setNewsUpdatedAt(new Date()); }
      }).catch(() => { if (active) setNewsIsLive(false); }).finally(() => { if (active) setNewsLoading(false); });
    };
    refreshNews();
    const refreshTimer = window.setInterval(() => {
      refreshNews();
    }, NEWS_REFRESH_INTERVAL_MS);
    return () => { active = false; window.clearInterval(refreshTimer); };
  }, []);
  const latestHeadlines = news.map((item) => getTickerHeadline(item.title));
  const tickerHeadlines = [...latestHeadlines, ...latestHeadlines];
  // Trending = the most traded open markets over the last day (falls back to the newest).
  const featured = [...markets]
    .filter((m) => m.status === "Trading")
    .sort((a, b) => (b.volume24hCC ?? 0) - (a.volume24hCC ?? 0) || b.marketId - a.marketId)
    .slice(0, 4);
  const lead = featured[featured.length ? featuredIndex % featured.length : 0];
  const yesPct = lead ? Math.round(lead.currentPrice * 100) : 0;
  const leadDelta = lead ? priceDelta(lead.currentPrice, lead.previousPrice ?? null) : null;
  // Trending events for the grid below the hero (index only; the ledger fallback shows markets).
  const indexed = markets.some((m) => m.seriesTicker !== undefined);
  const trendingEvents = useEventsList({ withNestedMarkets: true, sort: "trending", status: "all", limit: 6 }, indexed);
  // The board carries the three most traded events (each with at least one live market)
  // whenever the index is there; the single-market hero below is the ledger-only fallback.
  const boardEvents = indexed ? (trendingEvents.data?.items ?? []).filter((e) => (e.markets ?? []).some((m) => !m.archived)).slice(0, 3) : [];

  return (
    <div className="pb-20">
      <div className="announcement-bar">
        <span className="live-dot" /> Live markets settle transparently on Canton{" "}
        <Link to="/faq">
          Learn how it works <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <section className="page-container pt-5 sm:pt-7">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div className="max-w-2xl">
            <p className="eyebrow">
              <Sparkles className="h-3.5 w-3.5" /> The future, priced in real time
            </p>
            <h1 className="display-heading">
              Forecast the Future.
              <br />
              <span className="text-primary">Reap the Profits.</span>
            </h1>
            <p className="mt-5 max-w-xl pl-1 text-[15px] leading-[21px] text-slate-500 sm:text-base sm:leading-[24px]">
              TruthOracle is a decentralized prediction market on Canton. Trade Yes/No shares on real-world events with
              transparent settlement, real-time odds, and community intelligence.
            </p>
          </div>
          <Link to="/marketplace" className="primary-button">
            Explore all markets <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className={indexed ? "featured-grid featured-grid-board" : "featured-grid"}>
          {indexed ? (
            trendingEvents.isLoading && !trendingEvents.data ? (
              <TrendingEventBoardSkeleton />
            ) : boardEvents.length ? (
              <TrendingEventBoard events={boardEvents} />
            ) : (
              <TrendingEventBoardEmpty />
            )
          ) : lead ? (
            <div className="featured-market-card">
              <div key={lead.marketId} className="market-swap">
                <div className="flex items-center justify-between">
                  <div className="eyebrow !mb-0">
                    <span className="live-dot" /> Trending market
                  </div>
                  <span className="soft-badge -mr-1 sm:-mr-2">{lead.category || "Trending"}</span>
                </div>
                <Link to={`/market/${lead.ticker ?? lead.marketId}`} className="group/title block">
                  <h2 className="mt-3 max-w-xl text-2xl font-bold tracking-[-0.04em] text-slate-950 transition-colors group-hover/title:text-primary group-active/title:text-primary sm:text-3xl">
                    {lead.question}
                  </h2>
                </Link>
                <div className="my-auto grid gap-5 pt-6 sm:grid-cols-[1fr_1.2fr] sm:items-end">
                  <div>
                    <p className="text-sm font-medium text-slate-500">Chance of Yes</p>
                    <p className="k-num mt-1 text-5xl font-bold tracking-[-0.07em] text-slate-950">{yesPct}%</p>
                    {leadDelta && <p className={`k-num mt-1 text-sm font-semibold ${leadDelta.direction === "up" ? "delta-up" : leadDelta.direction === "down" ? "delta-down" : "delta-flat"}`}>{leadDelta.text} pts today</p>}
                    <div className="mt-3 prob-bar h-2">
                      <div className="prob-bar-yes" style={{ width: `${yesPct}%` }} />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Link to={`/markets/${lead.ticker || lead.marketId}?side=yes`} className="pill-yes pill-lg flex-1">Yes {formatPercent(lead.currentPrice)}</Link>
                      <Link to={`/markets/${lead.ticker || lead.marketId}?side=no`} className="pill-no pill-lg flex-1">No {formatPercent(1 - lead.currentPrice)}</Link>
                    </div>
                  </div>
                  <PriceChart marketRef={lead.ticker || lead.marketId} createdAtSec={lead.createdAt} currentPrice={lead.currentPrice} indexed={lead.seriesTicker !== undefined} variant="compact" height={168} defaultTimeframe="1W" className="!p-3" />
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-5 text-xs text-slate-500">
                  <span className="k-num">{lead.volume24hCC !== undefined ? `${compactCC(lead.volume24hCC)} traded in 24h · ${compactCC(lead.totalVolumeCC)} lifetime` : `${compactCC(lead.totalVolumeCC)} market volume`}</span>
                  <Link
                    to={`/market/${lead.ticker ?? lead.marketId}`}
                    className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-primary"
                  >
                    View market <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="featured-market-card featured-market-loading" aria-label="Loading trending event">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span>Loading trending event</span>
            </div>
          )}
          <aside className={indexed ? "signal-panel signal-panel-wide" : "signal-panel"}>
            <div className="flex items-center gap-2">
              <span className="icon-tile">
                <TrendingUp className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Oracle signal</p>
                <p className="font-semibold text-slate-900">Markets are moving</p>
              </div>
            </div>
            <div className="mt-8 space-y-5">
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>Active markets</span>
                  <strong>{loading ? "—" : markets.filter((m) => m.status === "Trading").length}</strong>
                </div>
                <div className="signal-bar">
                  <span style={{ width: "78%" }} />
                </div>
              </div>
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>On-chain settlement</span>
                  <strong>100%</strong>
                </div>
                <div className="signal-bar">
                  <span style={{ width: "100%" }} />
                </div>
              </div>
            </div>
            <div className="latest-news">
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-primary">Latest news</span>
                <span className="live-dot" />
              </div>
              <div className="news-ticker-window">
                <div className="news-ticker-track" style={{ animationDuration: `${Math.max(latestHeadlines.length, 1) * 4.2}s` }}>
                  {tickerHeadlines.map((headline, index) => (
                    <div key={`${headline}-${index}`} className="news-ticker-item">
                      <span className="news-item-dot" />
                      <span className="news-ticker-headline">{headline}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-5 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-primary" /> Every outcome is auditable on Canton
              Network.
            </div>
          </aside>
        </div>
      </section>
      <section className="page-container mt-14">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">
              <TrendingUp className="h-3.5 w-3.5" /> Follow the signal
            </p>
            <h2 className="section-title">Trending markets</h2>
          </div>
          <Link to="/marketplace" className="quiet-link">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : indexed && (trendingEvents.data?.items.length ?? 0) > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trendingEvents.data!.items.slice(0, 6).map((event) => (
              <EventCard key={event.ticker} event={event} />
            ))}
          </div>
        ) : featured.length ? (
          <div className="market-grid">
            {featured.map((market) => (
              <MarketCard key={market.contractId} market={market} />
            ))}
          </div>
        ) : (
          <div className="empty-state">No markets yet. Check back soon.</div>
        )}
      </section>
      <section className="page-container mt-16">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">
              <Newspaper className="h-3.5 w-3.5" /> From the desk
            </p>
            <h2 className="section-title">News &amp; signals</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${newsIsLive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {newsIsLive ? <Radio className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
                {newsIsLive ? "LIVE FROM WEB" : "FALLBACK DATA"}
              </span>
              {newsUpdatedAt && <span>Updated {newsUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
          </div>
          <Link to="/news" className="quiet-link">
            See all stories <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="news-grid mt-5">
          {newsLoading || news.length === 0 ? <div className="col-span-full flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="h-7 w-7 animate-spin text-primary" /><span className="ml-3 text-sm text-slate-500">Waiting for live market news…</span></div> : news.slice(0, 3).map((item) => (
            <article key={item.title} className="news-card">
              <div className="news-art relative overflow-hidden bg-slate-900"><img src={getNewsThumbnail(item)} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" onError={(event) => { event.currentTarget.src = getNewsThumbnail({ ...item, image: undefined }); }} /><div className="absolute inset-0 bg-slate-950/25" /><span className="relative z-10">{item.tag}</span><Newspaper className="relative z-10 h-8 w-8" /></div>
              <div className="p-5">
                <div className="flex items-center gap-2 text-xs text-slate-400"><span>{item.source}</span><span>·</span><span>{item.time}</span></div>
                <h3 className="mt-3 text-lg font-bold leading-6 tracking-[-0.03em] text-slate-950">{item.title}</h3>
                <a href={item.url || "/news"} target={item.url ? "_blank" : undefined} rel={item.url ? "noreferrer" : undefined} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">Read more <ArrowRight className="h-3.5 w-3.5" /></a>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="page-container mt-16">
        <div className="trust-strip">
          <div className="icon-tile">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold text-slate-950">Built for conviction, designed for clarity.</h2>
            <p className="mt-1 text-sm text-slate-500">
              Real-time odds, transparent settlement, and a calm trading experience.
            </p>
          </div>
          <Link to="/faq" className="ml-auto hidden items-center gap-1 text-sm font-semibold text-slate-900 sm:flex">
            How it works <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
export default Homepage;
