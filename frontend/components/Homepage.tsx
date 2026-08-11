import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAllPredictionMarkets, type PredictionMarketRecord } from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import { ArrowRight, ChevronRight, Loader2, Newspaper, ShieldCheck, Sparkles, TrendingUp, Zap } from "lucide-react";

const NEWS = [
  { source: "TruthOracle Research", time: "6 min read", title: "The week ahead: five questions markets are watching", tag: "Market brief" },
  { source: "Canton Network", time: "3 min read", title: "Why transparent settlement changes the way we forecast", tag: "Explainer" },
  { source: "Oracle desk", time: "4 min read", title: "Reading probability: a practical guide to Yes and No", tag: "Learn" },
];

const LATEST_NEWS = [
  "Bitcoin traders are pricing a volatile September",
  "Canton settlement activity reaches a new weekly high",
  "Community conviction is moving into technology markets",
  "New Yes/No markets are now open for trading",
  "Prediction markets see a sharp rise in global participation",
  "Traders are watching the next major crypto catalyst",
  "Sports markets are gaining momentum ahead of the weekend",
  "Transparent settlement is drawing more first-time traders",
  "The oracle desk flags stronger conviction in tech markets",
  "Yes shares climb as the community updates its forecast",
  "New political questions are entering the public market",
  "Canton liquidity remains steady across active markets",
  "Market volume is building around the latest macro signals",
  "Traders are comparing crowd probability with expert forecasts",
  "Community intelligence shifts toward near-term outcomes",
  "A fresh wave of markets is moving into price discovery",
  "Real-time odds react to the latest global headlines",
  "The most active markets are showing tighter spreads today",
  "Forecast confidence rises as more participants join the debate",
  "New culture and science markets are now trending",
  "On-chain activity remains fully auditable on Canton",
  "Oracle signals point to a busy week for market makers",
  "No shares gain attention as traders hedge near-term risk",
  "TruthOracle community forecasts are updating in real time",
];

function trendPoints(seed: number, probability: number) {
  return Array.from({ length: 9 }, (_, index) => {
    const wave = Math.sin((index + seed) * 1.15) * 8;
    const drift = index * (seed % 2 === 0 ? 1.6 : -1.2);
    return { x: index * 12.5, y: 100 - Math.max(12, Math.min(88, probability + wave + drift)) };
  });
}

function Homepage() {
  const [markets, setMarkets] = useState<PredictionMarketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [newsIndex, setNewsIndex] = useState(0);
  useEffect(() => { fetchAllPredictionMarkets().then(setMarkets).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (markets.length < 2) return;
    const timer = window.setInterval(() => setFeaturedIndex((index) => (index + 1) % Math.min(markets.length, 4)), 6500);
    return () => window.clearInterval(timer);
  }, [markets.length]);
  useEffect(() => {
    const timer = window.setInterval(() => setNewsIndex((index) => (index + 1) % LATEST_NEWS.length), 4200);
    return () => window.clearInterval(timer);
  }, []);
  const featured = markets.slice(0, 4);
  const lead = featured[featured.length ? featuredIndex % featured.length : 0];
  const yesPct = lead ? Math.round(lead.currentPrice * 100) : 62;
  const chartPoints = trendPoints(featuredIndex + 1, yesPct);
  const chartPolyline = chartPoints.map(({ x, y }) => `${x},${y}`).join(" ");

  return <div className="pb-20">
    <div className="announcement-bar"><span className="live-dot" /> Live markets settle transparently on Canton <Link to="/faq">Learn how it works <ArrowRight className="h-3 w-3" /></Link></div>
    <section className="page-container pt-12 sm:pt-16">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5"><div className="max-w-2xl"><p className="eyebrow"><Sparkles className="h-3.5 w-3.5" /> The future, priced in real time</p><h1 className="display-heading">Forecast the Future.<br /><span className="text-primary">Reap the Profits.</span></h1><p className="mt-5 max-w-xl text-base leading-7 text-slate-500 sm:text-lg">TruthOracle is a decentralized prediction market on Canton. Trade Yes/No shares on real-world events with transparent settlement, real-time odds, and community intelligence.</p></div><Link to="/marketplace" className="primary-button">Explore all markets <ArrowRight className="h-4 w-4" /></Link></div>
      <div className="featured-grid">
        <div className="featured-market-card"><div key={lead?.marketId || "placeholder"} className="market-swap"><div className="flex items-center justify-between"><div className="eyebrow !mb-0"><span className="live-dot" /> Trending market</div><span className="soft-badge">{lead?.category || "Trending"}</span></div><h2 className="mt-7 max-w-xl text-2xl font-bold tracking-[-0.04em] text-slate-950 sm:text-3xl">{lead?.question || "What will be the next big thing to happen?"}</h2><div className="mt-8 grid gap-6 sm:grid-cols-[1fr_1.2fr] sm:items-end"><div><p className="text-sm font-medium text-slate-500">Probability of Yes</p><p className="mt-1 text-5xl font-bold tracking-[-0.07em] text-slate-950">{yesPct}%</p><div className="mt-4 prob-bar h-2"><div className="prob-bar-yes" style={{ width: `${yesPct}%` }} /></div></div><div className="mini-chart" aria-label="Market probability trend"><div className="chart-y-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div className="chart-plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Live probability trend"><defs><linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#10b981" stopOpacity=".22" /><stop offset="1" stopColor="#10b981" stopOpacity="0" /></linearGradient></defs><polygon points={`0,100 ${chartPolyline} 100,100`} fill="url(#trend-fill)" /><polyline points={chartPolyline} fill="none" stroke="#059669" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />{chartPoints.map(({ x, y }) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill="#ffffff" stroke="#059669" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />)}</svg><div className="chart-x-axis"><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span></div></div></div></div><div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-4 text-xs text-slate-500"><span>{lead ? `${lead.totalVolumeCC.toFixed(1)} CC market volume` : "Live price discovery"}</span><Link to={lead ? `/market/${lead.marketId}` : "/marketplace"} className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-primary">View market <ArrowRight className="h-3.5 w-3.5" /></Link></div></div></div>
        <aside className="signal-panel"><div className="flex items-center gap-2"><span className="icon-tile"><TrendingUp className="h-4 w-4" /></span><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Oracle signal</p><p className="font-semibold text-slate-900">Markets are moving</p></div></div><div className="mt-8 space-y-5"><div><div className="mb-2 flex justify-between text-sm"><span>Active markets</span><strong>{loading ? "—" : markets.length}</strong></div><div className="signal-bar"><span style={{ width: "78%" }} /></div></div><div><div className="mb-2 flex justify-between text-sm"><span>On-chain settlement</span><strong>100%</strong></div><div className="signal-bar"><span style={{ width: "100%" }} /></div></div></div><div className="latest-news"><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Latest news</span><span className="live-dot" /></div><div className="news-ticker-window"><div className="news-ticker-track" style={{ transform: `translate3d(0, -${newsIndex * 40}px, 0)` }}>{LATEST_NEWS.map((headline) => <div key={headline} className="news-ticker-item"><span className="news-item-dot" />{headline}</div>)}</div></div></div><div className="mt-5 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500"><ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-primary" /> Every outcome is auditable on Canton Network.</div></aside>
      </div>
    </section>
    <section className="page-container mt-14"><div className="section-heading-row"><div><p className="eyebrow"><TrendingUp className="h-3.5 w-3.5" /> Follow the signal</p><h2 className="section-title">Trending markets</h2></div><Link to="/marketplace" className="quiet-link">View all <ArrowRight className="h-3.5 w-3.5" /></Link></div>{loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : featured.length ? <div className="market-grid">{featured.map((market) => <MarketCard key={market.contractId} market={market} />)}</div> : <div className="empty-state">No markets yet. Check back soon.</div>}</section>
    <section className="page-container mt-16"><div className="section-heading-row"><div><p className="eyebrow"><Newspaper className="h-3.5 w-3.5" /> From the desk</p><h2 className="section-title">News & signals</h2></div><button className="quiet-link">See all stories <ArrowRight className="h-3.5 w-3.5" /></button></div><div className="news-grid">{NEWS.map((item) => <article key={item.title} className="news-card"><div className="news-art"><span>{item.tag}</span><Newspaper className="h-8 w-8" /></div><div className="p-5"><div className="flex items-center gap-2 text-xs text-slate-400"><span>{item.source}</span><span>·</span><span>{item.time}</span></div><h3 className="mt-3 text-lg font-bold leading-6 tracking-[-0.03em] text-slate-950">{item.title}</h3><Link to="/faq" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">Read more <ChevronRight className="h-4 w-4" /></Link></div></article>)}</div></section>
    <section className="page-container mt-16"><div className="trust-strip"><div className="icon-tile"><Zap className="h-5 w-5" /></div><div><h2 className="font-bold text-slate-950">Built for conviction, designed for clarity.</h2><p className="mt-1 text-sm text-slate-500">Real-time odds, transparent settlement, and a calm trading experience.</p></div><Link to="/faq" className="ml-auto hidden items-center gap-1 text-sm font-semibold text-slate-900 sm:flex">How it works <ArrowRight className="h-4 w-4" /></Link></div></section>
  </div>;
}
export default Homepage;
