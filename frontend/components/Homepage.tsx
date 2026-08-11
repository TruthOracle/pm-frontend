import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAllPredictionMarkets, type PredictionMarketRecord } from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import { Activity, ArrowLeft, ArrowRight, BadgeCheck, BarChart3, ChevronRight, Loader2, Newspaper, Shield, TrendingUp, Users, Zap } from "lucide-react";

const FEATURES = [
  {
    icon: Shield,
    title: "On-chain & Transparent",
    desc: "Every trade is recorded on the Canton Network ledger — fully auditable.",
  },
  {
    icon: Zap,
    title: "Instant Settlement",
    desc: "LMSR pricing ensures fair, real-time odds with low slippage.",
  },
  {
    icon: Users,
    title: "Community Intelligence",
    desc: "Harness collective wisdom to forecast politics, sports, and more.",
  },
  {
    icon: BarChart3,
    title: "Dynamic pm-AMM",
    desc: "Real-time liquidity and probability-based pricing keep every market responsive and transparent.",
  },
];

const NEWS_ITEMS = [
  {
    title: "Bitcoin markets heat up before the next macro print",
    meta: "Crypto · Latest",
    href: "/marketplace?search=BTC",
  },
  {
    title: "Iran ceasefire odds move as traders price new headlines",
    meta: "Politics · Live",
    href: "/marketplace?search=Iran",
  },
  {
    title: "Policy markets watch September rate expectations",
    meta: "Economy · Today",
    href: "/marketplace?search=Fed",
  },
  {
    title: "Canton prediction markets add fresh pm-AMM liquidity",
    meta: "Platform · Update",
    href: "/marketplace?search=Canton",
  },
];

function Homepage() {
  const [markets, setMarkets] = useState<PredictionMarketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const injectScript = document.createElement("script");
    injectScript.src = "https://cdn.botpress.cloud/webchat/v2.1/inject.js";
    injectScript.async = true;
    document.body.appendChild(injectScript);

    const configScript = document.createElement("script");
    configScript.src = "https://mediafiles.botpress.cloud/43e0165b-15b6-4289-b3bf-0baa7a9a8029/webchat/v2.1/config.js";
    configScript.async = true;
    document.body.appendChild(configScript);

    return () => {
      document.body.removeChild(injectScript);
      document.body.removeChild(configScript);
    };
  }, []);

  useEffect(() => {
    fetchAllPredictionMarkets()
      .then(setMarkets)
      .finally(() => setLoading(false));
  }, []);

  const featured = markets.slice(0, 3);
  const liveMarkets = markets.filter((market) => market.status === "Trading");
  const liveCarouselMarkets = liveMarkets.slice(0, 5);
  const liveCarouselCount = Math.max(liveCarouselMarkets.length, 1);
  const activeMarket = liveCarouselMarkets[activeIndex % liveCarouselCount];
  const liveProbability = activeMarket ? Math.round(activeMarket.currentPrice * 100) : 68;
  const liveVolume = activeMarket ? `${activeMarket.totalVolumeCC.toFixed(1)} CC` : "12.4k";
  const liveExpiry = activeMarket ? new Date(activeMarket.expiresAt * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "Live";
  const chartMonth = new Date().toLocaleString(undefined, { month: "short" });

  useEffect(() => {
    if (liveCarouselMarkets.length < 2) return;
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % liveCarouselMarkets.length), 5500);
    return () => window.clearInterval(timer);
  }, [liveCarouselMarkets.length]);

  return (
    <div className="relative overflow-hidden">
      <div className="market-ticker">
        <div className="ticker-track">
          {[...Array(2)].flatMap(() => [
            { name: "BTC reaches $126k", value: "50%", move: "Live" },
            { name: "Fed decision", value: "68%", move: "+4.2%" },
            { name: "Iran ceasefire", value: "39%", move: "-2.1%" },
            { name: "Canton adoption", value: "74%", move: "+6.4%" },
          ]).map((item, index) => (
            <div className="ticker-item" key={`${item.name}-${index}`}><span className="ticker-dot" /><span className="text-slate-500">{item.name}</span><strong className="text-slate-950">{item.value}</strong><span className={item.move.startsWith("-") ? "text-rose-500" : "text-primary"}>{item.move}</span></div>
          ))}
        </div>
      </div>
      {/* Hero */}
      <section className="page-container relative py-14 sm:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-primary shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-oracle-yes animate-pulse" />
              Live on Canton Network
            </div>

            <h1 className="mb-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-6xl lg:text-68 lg:leading-72">
              Forecast the Future. <span className="gradient-text">Reap the Profits.</span>
            </h1>

            <p className="mb-8 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              TruthOracle is a decentralized prediction market on Canton. Trade Yes/No shares on real-world events with transparent settlement, real-time odds, and community intelligence.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                to="/marketplace"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 hover:shadow-xl hover:shadow-slate-900/25"
              >
                Explore Markets
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/faq"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-950 shadow-sm transition-all hover:border-primary/40 hover:bg-emerald-50"
              >
                How it works
              </Link>
            </div>

            {/* Stats */}
            <div className="mt-10 grid grid-cols-3 gap-3 rounded-lg border border-border/80 bg-white/80 p-3 shadow-xl shadow-slate-200/50 backdrop-blur sm:gap-5 sm:p-5">
              {[
                { label: "Active Markets", value: loading ? "—" : markets.length },
                { label: "Network", value: "Canton" },
                { label: "Settlement", value: "On-chain" },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <div className="text-xl font-bold text-foreground sm:text-2xl">{value}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="live-hero-card rounded-lg border border-border/80 bg-white p-4 shadow-2xl shadow-slate-300/40">
              <div key={activeMarket?.contractId ?? "fallback-live-market"} className="live-market-slide">
              <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Live Market</p>
                  <h2 className="mt-1 line-clamp-2 text-base font-extrabold text-slate-950">{activeMarket?.question ?? "Election outcome forecast"}</h2>
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-oracle-yes">
                  <Activity className="h-3.5 w-3.5" />
                  Active
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                  <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400"><span>Live probability</span><span className="text-primary">pm-AMM curve</span></div>
                  <svg viewBox="0 0 452 148" className="h-36 w-full" role="img" aria-label="Live market probability chart">
                    <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#138b61" stopOpacity=".22" /><stop offset="1" stopColor="#138b61" stopOpacity="0" /></linearGradient></defs>
                    <path d="M0 110H420 M0 83.5H420 M0 57H420 M0 30.5H420 M0 4H420" className="chart-grid" />
                    <path className="chart-fill" d="M0 98 C25 90 30 80 48 86 S78 64 95 72 S120 54 140 64 S165 46 188 54 S220 72 238 47 S262 38 278 48 S302 30 320 40 S344 20 360 32 S390 24 420 10 V110 H0Z" />
                    <path className="chart-line" d="M0 98 C25 90 30 80 48 86 S78 64 95 72 S120 54 140 64 S165 46 188 54 S220 72 238 47 S262 38 278 48 S302 30 320 40 S344 20 360 32 S390 24 420 10" />
                    <circle cx="420" cy="10" r="4" fill="#138b61" />
                    {[100, 75, 50, 25, 0].map((label, index) => (
                      <text key={label} x="430" y={8 + index * 26.5} className="home-chart-axis-label">{label}%</text>
                    ))}
                    <text x="0" y="142" className="home-chart-axis-label">{chartMonth}</text>
                    <text x="398" y="142" className="home-chart-axis-label">Now</text>
                  </svg>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-950">Yes probability</span>
                    <span className="text-2xl font-extrabold text-oracle-yes">{liveProbability}%</span>
                  </div>
                  <div className="prob-bar h-2">
                    <div className="prob-bar-yes" style={{ width: `${liveProbability}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-xs font-semibold text-emerald-700">YES</p>
                    <p className="mt-2 text-2xl font-bold text-emerald-700">{liveProbability}c</p>
                  </div>
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-4">
                    <p className="text-xs font-semibold text-rose-700">NO</p>
                    <p className="mt-2 text-2xl font-bold text-rose-700">{100 - liveProbability}c</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Token volume", value: liveVolume },
                    { label: "Fees", value: activeMarket ? `${(activeMarket.feeBps / 100).toFixed(2)}%` : "0.30%" },
                    { label: "Expiry", value: liveExpiry },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border border-slate-200 bg-white p-3">
                      <p className="text-xs text-slate-500">{item.label}</p>
                      <p className="mt-1 text-sm font-bold text-slate-950">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                <div className="flex items-center gap-1.5">{liveCarouselMarkets.map((market, index) => <button aria-label={`Show market ${index + 1}`} key={market.contractId} onClick={() => setActiveIndex(index)} className={`h-1.5 rounded-full transition-all ${index === activeIndex % liveCarouselCount ? "w-5 bg-primary" : "w-1.5 bg-slate-300"}`} />)}</div>
                <div className="flex gap-1.5"><button aria-label="Previous live market" onClick={() => setActiveIndex((index) => (index - 1 + liveCarouselCount) % liveCarouselCount)} className="carousel-arrow"><ArrowLeft className="h-3.5 w-3.5" /></button><button aria-label="Next live market" onClick={() => setActiveIndex((index) => (index + 1) % liveCarouselCount)} className="carousel-arrow"><ArrowRight className="h-3.5 w-3.5" /></button></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured markets */}
      <section className="page-container pb-16">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Trending Markets</h2>
          </div>
          <Link to="/marketplace" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : featured.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white/70">
            <TrendingUp className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No markets yet. Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((m) => (
              <MarketCard key={m.contractId} market={m} />
            ))}
          </div>
        )}
      </section>

      <section id="news" className="page-container section-rule pb-14 pt-10">
        <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-2"><Newspaper className="h-4 w-4 text-primary" /><h2 className="text-lg font-bold text-foreground">News</h2></div><Link to="/marketplace" className="flex items-center gap-1 text-sm font-semibold text-primary">Latest markets <ChevronRight className="h-4 w-4" /></Link></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {NEWS_ITEMS.map((item) => (
            <Link key={item.title} to={item.href} className="news-card">
              <span className="text-[11px] font-semibold uppercase text-slate-500">{item.meta}</span>
              <span className="mt-2 block text-sm font-bold leading-5 text-slate-950">{item.title}</span>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">Read latest <ChevronRight className="h-3.5 w-3.5" /></span>
            </Link>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/70 bg-white/70 py-16 backdrop-blur">
        <div className="page-container">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm">
              <BadgeCheck className="h-3.5 w-3.5 text-primary" />
              Built for confident trading
            </div>
            <h2 className="text-2xl font-bold text-foreground">Why TruthOracle?</h2>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-lg border border-border/80 bg-card p-6 shadow-lg shadow-slate-200/50 transition-colors hover:border-primary/30"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-1.5 font-semibold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Homepage;
