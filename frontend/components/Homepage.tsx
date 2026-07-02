import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAllPredictionMarkets, type PredictionMarketRecord } from "@/utils/activeContracts";
import MarketCard from "./MarketCard";
import { ArrowRight, Shield, Zap, Users, TrendingUp, Loader2 } from "lucide-react";

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
    configScript.src =
      "https://mediafiles.botpress.cloud/43e0165b-15b6-4289-b3bf-0baa7a9a8029/webchat/v2.1/config.js";
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
      {/* Hero glow */}
      <div className="hero-glow -top-32 left-1/2 -translate-x-1/2" />
      <div className="hero-glow bottom-0 right-0 translate-x-1/3" style={{ background: "radial-gradient(circle, rgba(22,199,132,0.08) 0%, transparent 70%)" }} />

      {/* Hero */}
      <section className="page-container relative py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-oracle-yes animate-pulse" />
            Live on Canton Network
          </div>

          <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-foreground sm:text-6xl">
            Forecast the Future.{" "}
            <span className="gradient-text">Reap the Profits.</span>
          </h1>

          <p className="mb-8 text-base text-muted-foreground sm:text-lg">
            TruthOracle is a decentralized prediction market on Canton. Trade Yes/No shares
            on real-world events — secure, transparent, and powered by community insight.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/marketplace"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25"
            >
              Explore Markets
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/faq"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-secondary px-6 py-3 text-sm font-semibold text-foreground transition-all hover:border-primary/40"
            >
              How it works
            </Link>
          </div>

          {/* Stats */}
          <div className="mt-12 grid grid-cols-3 gap-4 rounded-xl border border-border bg-card/50 p-4 backdrop-blur sm:gap-8 sm:p-6">
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
      </section>

      {/* Featured markets */}
      <section className="page-container pb-16">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Trending Markets</h2>
          </div>
          <Link
            to="/marketplace"
            className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : featured.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border">
            <TrendingUp className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No markets yet — check back soon.</p>
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
      <section className="border-t border-border bg-secondary/30 py-16">
        <div className="page-container">
          <h2 className="mb-8 text-center text-2xl font-bold text-foreground">
            Why TruthOracle?
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/30"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
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
