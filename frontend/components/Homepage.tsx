import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAllPredictionMarkets, type PredictionMarketRecord } from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import { Activity, ArrowRight, BadgeCheck, BarChart3, Loader2, Shield, TrendingUp, Users, Zap } from "lucide-react";

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
            <div className="rounded-lg border border-border/80 bg-white p-4 shadow-2xl shadow-slate-300/40">
              <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Live Market</p>
                  <h2 className="mt-1 text-base font-extrabold text-slate-950">Election outcome forecast</h2>
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-oracle-yes">
                  <Activity className="h-3.5 w-3.5" />
                  Active
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-950">Yes probability</span>
                    <span className="text-2xl font-extrabold text-oracle-yes">68%</span>
                  </div>
                  <div className="prob-bar h-2">
                    <div className="prob-bar-yes" style={{ width: "68%" }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-xs font-semibold text-emerald-700">YES</p>
                    <p className="mt-2 text-2xl font-bold text-emerald-700">68c</p>
                  </div>
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-4">
                    <p className="text-xs font-semibold text-rose-700">NO</p>
                    <p className="mt-2 text-2xl font-bold text-rose-700">32c</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Volume", value: "12.4k" },
                    { label: "Traders", value: "840" },
                    { label: "Latency", value: "Live" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border border-slate-200 bg-white p-3">
                      <p className="text-xs text-slate-500">{item.label}</p>
                      <p className="mt-1 text-sm font-bold text-slate-950">{item.value}</p>
                    </div>
                  ))}
                </div>
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
