import { Link } from "react-router-dom";
import { ArrowRight, Newspaper, TrendingUp } from "lucide-react";

const LATEST_NEWS = [
  {
    title: "Bitcoin markets heat up before the next macro print",
    summary: "Traders are watching whether crypto momentum can carry BTC-linked prediction markets into the next risk window.",
    meta: "Crypto · Latest",
    href: "/marketplace?search=BTC",
  },
  {
    title: "Iran ceasefire odds move as traders price new headlines",
    summary: "Geopolitical markets continue to react as new updates shift near-term probabilities across related outcomes.",
    meta: "Politics · Live",
    href: "/marketplace?search=Iran",
  },
  {
    title: "Policy markets watch September rate expectations",
    summary: "Macro traders are tracking Fed-related markets as probabilities adjust around the next policy decision.",
    meta: "Economy · Today",
    href: "/marketplace?search=Fed",
  },
  {
    title: "Canton prediction markets add fresh pm-AMM liquidity",
    summary: "TruthOracle markets use dynamic pm-AMM pricing to keep Yes/No quotes responsive as participation changes.",
    meta: "Platform · Update",
    href: "/marketplace?search=Canton",
  },
];

const News = () => {
  return (
    <div className="page-container py-10">
      <section className="mb-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
          <Newspaper className="h-3.5 w-3.5 text-primary" />
          Latest News
        </div>
        <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
          News moving TruthOracle markets
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Follow the headlines, market context, and pm-AMM liquidity updates that traders are watching right now.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {LATEST_NEWS.map((item) => (
          <Link key={item.title} to={item.href} className="news-card min-h-[190px]">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              {item.meta}
            </span>
            <span className="mt-3 block text-lg font-extrabold leading-6 text-slate-950">{item.title}</span>
            <span className="mt-2 block text-sm leading-6 text-slate-600">{item.summary}</span>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
              Open related markets <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
};

export default News;
