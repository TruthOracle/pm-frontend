import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAllPredictionMarkets, type PredictionMarketRecord } from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import { ArrowRight, Loader2, ShieldCheck, Sparkles, TrendingUp, Zap } from "lucide-react";

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

function Homepage() {
  const [markets, setMarkets] = useState<PredictionMarketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [newsIndex, setNewsIndex] = useState(0);
  useEffect(() => {
    fetchAllPredictionMarkets()
      .then(setMarkets)
      .finally(() => setLoading(false));
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
    const timer = window.setInterval(() => setNewsIndex((index) => (index + 1) % LATEST_NEWS.length), 4200);
    return () => window.clearInterval(timer);
  }, []);
  const featured = markets.slice(0, 4);
  const lead = featured[featured.length ? featuredIndex % featured.length : 0];
  const yesPct = lead ? Math.round(lead.currentPrice * 100) : 0;
  const chartMonth = new Date().toLocaleString(undefined, { month: "short" });

  return (
    <div className="pb-20">
      <div className="announcement-bar">
        <span className="live-dot" /> Live markets settle transparently on Canton{" "}
        <Link to="/faq">
          Learn how it works <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <section className="page-container pt-12 sm:pt-16">
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
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-500 sm:text-lg">
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
                  <span className="soft-badge">{lead.category || "Trending"}</span>
                </div>
                <Link to={`/market/${lead.marketId}`} className="group/title block">
                  <h2 className="mt-7 max-w-xl text-2xl font-bold tracking-[-0.04em] text-slate-950 transition-colors group-hover/title:text-primary group-active/title:text-primary sm:text-3xl">
                    {lead.question}
                  </h2>
                </Link>
                <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_1.2fr] sm:items-end">
                  <div>
                    <p className="text-sm font-medium text-slate-500">Probability of Yes</p>
                    <p className="mt-1 text-5xl font-bold tracking-[-0.07em] text-slate-950">{yesPct}%</p>
                    <div className="mt-4 prob-bar h-2">
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
                      >
                        <defs>
                          <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0" stopColor="#138b61" stopOpacity=".22" />
                            <stop offset="1" stopColor="#138b61" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path d="M0 110H430 M0 83.5H430 M0 57H430 M0 30.5H430 M0 4H430" className="chart-grid" />
                        <path
                          className="chart-fill"
                          d="M0 98 C25 90 30 80 48 86 S78 64 95 72 S120 54 140 64 S165 46 188 54 S220 72 238 47 S262 38 278 48 S302 30 320 40 S344 20 360 32 S390 24 410 10 V110 H0Z"
                        />
                        <path
                          className="chart-line"
                          d="M0 98 C25 90 30 80 48 86 S78 64 95 72 S120 54 140 64 S165 46 188 54 S220 72 238 47 S262 38 278 48 S302 30 320 40 S344 20 360 32 S390 24 410 10"
                        />
                        <circle cx="410" cy="10" r="4" fill="#138b61" />
                        {[100, 75, 50, 25, 0].map((label, index) => (
                          <text key={label} x="442" y={8 + index * 26.5} className="home-chart-axis-label">
                            {label}%
                          </text>
                        ))}
                        <text x="0" y="144" className="home-chart-axis-label">
                          {chartMonth}
                        </text>
                        <text x="405" y="144" className="home-chart-axis-label">
                          Now
                        </text>
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-4 text-xs text-slate-500">
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
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Latest news</span>
                <span className="live-dot" />
              </div>
              <div className="news-ticker-window">
                <div className="news-ticker-track" style={{ transform: `translate3d(0, -${newsIndex * 40}px, 0)` }}>
                  {LATEST_NEWS.map((headline) => (
                    <div key={headline} className="news-ticker-item">
                      <span className="news-item-dot" />
                      {headline}
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
