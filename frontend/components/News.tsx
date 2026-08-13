import { ArrowRight, Newspaper } from "lucide-react";

const NEWS = [
  { tag: "Market brief", source: "TruthOracle Research", time: "6 min read", title: "The week ahead: five questions markets are watching" },
  { tag: "Explainer", source: "Canton Network", time: "3 min read", title: "Why transparent settlement changes the way we forecast" },
  { tag: "Learn", source: "Oracle desk", time: "4 min read", title: "Reading probability: a practical guide to Yes and No" },
  { tag: "Crypto", source: "TruthOracle Markets", time: "5 min read", title: "Bitcoin traders are pricing a volatile September" },
  { tag: "Network", source: "Canton Network", time: "3 min read", title: "Canton settlement activity reaches a new weekly high" },
  { tag: "Community", source: "TruthOracle Research", time: "4 min read", title: "Community conviction is moving into technology markets" },
];

export default function News() {
  return <section className="page-container pb-20 pt-12 sm:pt-16">
    <div className="section-heading-row">
      <div><p className="eyebrow"><Newspaper className="h-3.5 w-3.5" /> From the desk</p><h1 className="section-title">News &amp; signals</h1></div>
    </div>
    <div className="news-grid mt-5">
      {NEWS.map((item) => <article key={item.title} className="news-card">
        <div className="news-art"><span>{item.tag}</span><Newspaper className="h-8 w-8" /></div>
        <div className="p-5"><div className="flex items-center gap-2 text-xs text-slate-400"><span>{item.source}</span><span>·</span><span>{item.time}</span></div><h2 className="mt-3 text-lg font-bold leading-6 tracking-[-0.03em] text-slate-950">{item.title}</h2><button type="button" className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">Read more <ArrowRight className="h-3.5 w-3.5" /></button></div>
      </article>)}
    </div>
  </section>;
}
