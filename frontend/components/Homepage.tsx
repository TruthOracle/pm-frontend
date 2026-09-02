import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { fetchAllPredictionMarkets, type PredictionMarketRecord } from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import { ArrowRight, Clock3, Loader2, Newspaper, Radio, ShieldCheck, Sparkles, TrendingUp, Zap } from "lucide-react";
import { getPrefetchedMarkets } from "@/utils/marketPrefetch";
import { formatChartDate, pointOnProbabilityPath, probabilityHistoryPath, type ProbabilityPoint } from "@/lib/probabilityChart";
import { fetchMarketNews, getNewsThumbnail, getTickerHeadline, NEWS_REFRESH_INTERVAL_MS, type MarketNewsItem } from "@/lib/marketNews";

function Homepage() {
  const [markets, setMarkets] = useState<PredictionMarketRecord[]>(() => getPrefetchedMarkets() ?? []);
  const [loading, setLoading] = useState(() => markets.length === 0);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [news, setNews] = useState<MarketNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsIsLive, setNewsIsLive] = useState(false);
  const [newsUpdatedAt, setNewsUpdatedAt] = useState<Date | null>(null);
  const [priceHistory, setPriceHistory] = useState<Map<number, ProbabilityPoint[]>>(new Map());
  useEffect(() => {
    let active = true;
    const refresh = () => {
      fetchAllPredictionMarkets()
        .then((nextMarkets) => {
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
  const featured = markets.slice(0, 4);
  const lead = featured[featured.length ? featuredIndex % featured.length : 0];
  const yesPct = lead ? Math.round(lead.currentPrice * 100) : 0;
  const nowSecs = Math.floor(Date.now() / 1000);
  const leadHistory = lead ? priceHistory.get(lead.marketId) ?? [{ timestamp: lead.createdAt, probability: 0.5 }] : [];
  const chartCurrentY = lead ? 4 + (1 - lead.currentPrice) * 106 : 57;
  const chartTrendPath = probabilityHistoryPath(leadHistory, lead?.createdAt ?? nowSecs, nowSecs, 410, 110, 4);
  const homeChartPathRef = useRef<SVGPathElement>(null);
  const [hoveredHomePoint, setHoveredHomePoint] = useState<(ProbabilityPoint & { x: number; y: number }) | null>(null);
  const [hoveredHomeX, setHoveredHomeX] = useState<number | null>(null);

  const handleHomePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = ((event.clientX - bounds.left) / bounds.width) * 480;
    const exactX = Math.max(0, Math.min(410, chartX));
    setHoveredHomeX(exactX);
    if (homeChartPathRef.current) setHoveredHomePoint(pointOnProbabilityPath(homeChartPathRef.current, exactX, 410, lead?.createdAt ?? nowSecs, nowSecs, 110, 4));
  };

  useEffect(() => {
    if (!lead) return;
    setPriceHistory((previous) => {
      const existing = previous.get(lead.marketId) ?? [{ timestamp: lead.createdAt, probability: 0.5 }];
      const last = existing.at(-1);
      if (last && Math.abs(last.probability - lead.currentPrice) < 0.0001) return previous;
      const next = new Map(previous);
      next.set(lead.marketId, [...existing, { timestamp: nowSecs, probability: lead.currentPrice }]);
      return next;
    });
  }, [lead, nowSecs]);

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
        <div className="featured-grid">
          {lead ? (
            <div className="featured-market-card">
              <div key={lead.marketId} className="market-swap">
                <div className="flex items-center justify-between">
                  <div className="eyebrow !mb-0">
                    <span className="live-dot" /> Trending market
                  </div>
                  <span className="soft-badge -mr-1 sm:-mr-2">{lead.category || "Trending"}</span>
                </div>
                <Link to={`/market/${lead.marketId}`} className="group/title block">
                  <h2 className="mt-3 max-w-xl text-2xl font-bold tracking-[-0.04em] text-slate-950 transition-colors group-hover/title:text-primary group-active/title:text-primary sm:text-3xl">
                    {lead.question}
                  </h2>
                </Link>
                <div className="my-auto grid gap-5 pt-6 sm:grid-cols-[1fr_1.2fr] sm:items-end">
                  <div>
                    <p className="text-sm font-medium text-slate-500">Probability of Yes</p>
                    <p className="mt-1 text-5xl font-bold tracking-[-0.07em] text-slate-950">{yesPct}%</p>
                    <div className="mt-3 prob-bar h-2">
                      <div className="prob-bar-yes" style={{ width: `${yesPct}%` }} />
                    </div>
                  </div>
                  <div className="mini-chart" aria-label="Market probability trend">
                    <div className="chart-caption">
                      <strong>pm-AMM curve</strong>
                      <span>LIVE PROBABILITY</span>
                    </div>
                    <div className="chart-plot top-8 right-3 bottom-2 left-2">
                      <svg
                        viewBox="0 0 480 148"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label="Live probability trend"
                        onPointerMove={handleHomePointerMove}
                        onPointerLeave={() => { setHoveredHomePoint(null); setHoveredHomeX(null); }}
                      >
                        <defs>
                          <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0" stopColor="#138b61" stopOpacity=".22" />
                            <stop offset="1" stopColor="#138b61" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d="M0 110H430 M0 83.5H430 M0 57H430 M0 30.5H430 M0 4H430" className="chart-grid" />
                        <path className="chart-fill" d={`${chartTrendPath} V110 H0Z`} />
                        <path ref={homeChartPathRef} className="chart-line chart-line-edge-safe" d={chartTrendPath} />
                        <circle cx="410" cy={chartCurrentY} r="4" fill="#138b61" />
                        {hoveredHomePoint && <>
                          <line x1={hoveredHomeX ?? hoveredHomePoint.x} x2={hoveredHomeX ?? hoveredHomePoint.x} y1="4" y2="110" className="chart-crosshair" />
                          <circle cx={hoveredHomePoint.x} cy={hoveredHomePoint.y} r="4" className="chart-hover-dot" />
                        </>}
                        {[100, 75, 50, 25, 0].map((label, index) => (
                          <text key={label} x="442" y={8 + index * 26.5} className="home-chart-axis-label">
                            {label}%
                          </text>
                        ))}
                        <text x="0" y="144" className="home-chart-axis-label">
                          {formatChartDate(lead?.createdAt ?? 0, true)}
                        </text>
                        <text x="405" y="144" className="home-chart-axis-label">
                          Now
                        </text>
                      </svg>
                      {hoveredHomePoint && <div className="chart-tooltip chart-tooltip-home" style={{ left: `${Math.min(80, Math.max(8, ((hoveredHomeX ?? hoveredHomePoint.x) / 410) * 100))}%`, transform: (hoveredHomeX ?? hoveredHomePoint.x) < 410 * .28 ? "translateX(0)" : (hoveredHomeX ?? hoveredHomePoint.x) > 410 * .72 ? "translateX(-100%)" : "translateX(-50%)" }}>
                        <strong>{(hoveredHomePoint.probability * 100).toFixed(2)}% Yes</strong>
                        <span>{new Date(hoveredHomePoint.timestamp * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short" }).toUpperCase()}</span>
                        <span>{new Date(hoveredHomePoint.timestamp * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: false })}</span>
                      </div>}
                    </div>
                  </div>
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-5 text-xs text-slate-500">
                  <span>{`${lead.totalVolumeCC.toFixed(1)} CC market volume`}</span>
                  <Link
                    to={`/market/${lead.marketId}`}
                    className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-primary"
                  >
                    View market <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="featured-market-card featured-market-loading" aria-label="Loading featured market">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span>Loading trending market</span>
            </div>
          )}
          <aside className="signal-panel">
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
                  <strong>{loading ? "—" : markets.length}</strong>
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
