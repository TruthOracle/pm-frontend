import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAllPredictionMarkets, type PredictionMarketRecord } from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import MarketRangeGraph from "./MarketRangeGraph";
import { Activity, ArrowLeft, ArrowRight, BadgeCheck, BarChart3, Loader2, Shield, TrendingUp, Users, Zap } from "lucide-react";

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
];

function Homepage() {
  const [markets, setMarkets] = useState<PredictionMarketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveIndex, setLiveIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);

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
    let mounted = true;
    const refreshMarkets = () => {
      fetchAllPredictionMarkets()
        .then((nextMarkets) => {
          if (mounted) setMarkets(nextMarkets);
        })
        .finally(() => {
          if (mounted) setLoading(false);
        });
    };

    refreshMarkets();
    const refreshTimer = window.setInterval(refreshMarkets, 30_000);
    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
    };
  }, []);

  const liveMarkets = markets.filter((market) => market.status === "Trading");
  const featured = liveMarkets.slice(0, 3);
  const liveMarket = liveMarkets[liveIndex % Math.max(liveMarkets.length, 1)];

  useEffect(() => {
    if (liveMarkets.length < 2) return;
    const rotationTimer = window.setInterval(() => {
      setLiveIndex((index) => (index + 1) % liveMarkets.length);
    }, 6_000);
    return () => window.clearInterval(rotationTimer);
  }, [liveMarkets.length]);

  const moveLiveMarket = (direction: number) => {
    if (liveMarkets.length < 2) return;
    setLiveIndex((index) => (index + direction + liveMarkets.length) % liveMarkets.length);
  };

  const handleLiveMarketTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleLiveMarketTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current == null || liveMarkets.length < 2) return;
    const distance = event.changedTouches[0]?.clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 40) return;
    moveLiveMarket(distance < 0 ? 1 : -1);
  };

  const formatVolume = (value: number) => {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return value.toFixed(1);
  };

  return (
    <div className="relative overflow-hidden">
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
              TruthOracle is a decentralized prediction market on Canton. Trade Yes/No shares on real-world events with
              transparent settlement, real-time odds, and community intelligence.
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
                { label: "Active Markets", value: loading ? "—" : liveMarkets.length },
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
            {liveMarket ? (
              <div
                className="min-h-[480px] rounded-lg border border-border/80 bg-white p-5 shadow-2xl shadow-slate-300/40"
                onTouchStart={handleLiveMarketTouchStart}
                onTouchEnd={handleLiveMarketTouchEnd}
              >
                <div className="mb-3 flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Live market {liveMarket.category ? `· ${liveMarket.category}` : ""}
                    </p>
                    <Link
                      to={`/market/${liveMarket.marketId}`}
                      className="mt-1 block line-clamp-2 text-base font-extrabold leading-snug text-slate-950 hover:text-primary"
                    >
                      {liveMarket.question}
                    </Link>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-oracle-yes">
                    <Activity className="h-3.5 w-3.5" />
                    Active
                  </div>
                </div>

                <MarketRangeGraph market={liveMarket} compact className="mb-5" />

                <div className="grid grid-cols-2 gap-3">
                  <Link
                    to={`/market/${liveMarket.marketId}?side=yes`}
                    className="rounded-md border border-emerald-200 bg-emerald-50 p-3 transition-colors hover:border-emerald-400"
                  >
                    <p className="text-xs font-semibold text-emerald-700">YES</p>
                    <p className="mt-1 text-2xl font-bold text-emerald-700">{Math.round(liveMarket.currentPrice * 100)}c</p>
                  </Link>
                  <Link
                    to={`/market/${liveMarket.marketId}?side=no`}
                    className="rounded-md border border-rose-200 bg-rose-50 p-3 transition-colors hover:border-rose-400"
                  >
                    <p className="text-xs font-semibold text-rose-700">NO</p>
                    <p className="mt-1 text-2xl font-bold text-rose-700">{Math.round((1 - liveMarket.currentPrice) * 100)}c</p>
                  </Link>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "Volume", value: `${formatVolume(liveMarket.totalVolumeCC)} CC` },
                    { label: "Liquidity", value: `${liveMarket.liquidityL.toFixed(1)} L` },
                    { label: "Expires", value: new Date(liveMarket.expiresAt * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border border-slate-200 bg-white p-2.5">
                      <p className="text-[11px] text-slate-500">{item.label}</p>
                      <p className="mt-1 truncate text-xs font-bold text-slate-950">{item.value}</p>
                    </div>
                  ))}
                </div>

                {liveMarkets.length > 1 && (
                  <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3">
                    <div className="flex items-center gap-1.5" aria-label="Live market carousel position">
                      {liveMarkets.map((market, index) => (
                        <button
                          key={market.contractId}
                          type="button"
                          aria-label={`Show market ${index + 1}`}
                          onClick={() => setLiveIndex(index)}
                          className={`h-1.5 rounded-full transition-all ${index === liveIndex % liveMarkets.length ? "w-5 bg-primary" : "w-1.5 bg-slate-300"}`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Previous live market" onClick={() => moveLiveMarket(-1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-950">
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label="Next live market" onClick={() => moveLiveMarket(1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-950">
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-[380px] items-center justify-center rounded-lg border border-dashed border-border bg-white/80 p-8 text-center shadow-xl shadow-slate-200/40">
                <div>
                  <Activity className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                  <p className="font-semibold text-foreground">{loading ? "Loading live markets..." : "No live markets yet"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Active markets will appear here automatically.</p>
                </div>
              </div>
            )}
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
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
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
