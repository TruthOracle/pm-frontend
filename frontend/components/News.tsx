import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, Loader2, Newspaper, Radio, RefreshCw, X } from "lucide-react";
import { fetchMarketNews, getNewsThumbnail, NEWS_REFRESH_INTERVAL_MS, type MarketNewsItem } from "@/lib/marketNews";

function NewsDetail({ item, onClose }: { item: MarketNewsItem; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="news-detail-title" onClick={onClose}>
    <article className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">{item.tag}</p><h2 id="news-detail-title" className="mt-2 text-2xl font-bold leading-tight text-slate-950">{item.title}</h2></div><button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Close news details"><X className="h-5 w-5" /></button></div>
      <div className="mt-5 flex items-center gap-2 text-sm text-slate-500"><span>{item.source}</span><span>·</span><span>{item.time}</span></div>
      <p className="mt-6 text-base leading-7 text-slate-600">This is the latest live market coverage. Open the source below to read the complete story, analysis, and publisher context.</p>
      {item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="primary-button mt-6 inline-flex items-center gap-2">Read full article <ExternalLink className="h-4 w-4" /></a> : <p className="mt-6 text-sm text-slate-500">Live article link is not available for this fallback story.</p>}
    </article>
  </div>;
}

export default function News() {
  const [news, setNews] = useState<MarketNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [selected, setSelected] = useState<MarketNewsItem | null>(null);
  const loadNews = async () => {
    setLoading(true);
    try { const liveNews = await fetchMarketNews(); setNews(liveNews); setLive(liveNews.length > 0); setLastUpdatedAt(new Date()); }
    catch { setLive(false); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    void loadNews();
    const refreshTimer = window.setInterval(() => void loadNews(), NEWS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(refreshTimer);
  }, []);
  return <section className="page-container pb-20 pt-12 sm:pt-16">
    <div className="section-heading-row"><div><p className="eyebrow"><Newspaper className="h-3.5 w-3.5" /> From the desk</p><h1 className="section-title">News &amp; signals</h1><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${live ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{live && <Radio className="h-3 w-3" />}{live ? "LIVE FROM WEB" : "WAITING FOR LIVE DATA"}</span><span className="text-slate-500">Google News market coverage</span>{lastUpdatedAt && <span className="text-slate-400">Updated {lastUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}</div></div><button type="button" onClick={() => void loadNews()} disabled={loading} className="quiet-link inline-flex items-center gap-2 disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{loading ? "Fetching live news…" : "Refresh live news"}</button></div>
    <div className="news-grid mt-5">{loading || news.length === 0 ? <div className="col-span-full flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="h-8 w-8 animate-spin text-primary" /><span className="ml-3 text-sm text-slate-500">Waiting for live market news…</span></div> : news.map((item) => <article key={`${item.title}-${item.url}`} className="news-card"><div className="news-art relative overflow-hidden bg-slate-900"><img src={getNewsThumbnail(item)} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" onError={(event) => { event.currentTarget.src = getNewsThumbnail({ ...item, image: undefined }); }} /><div className="absolute inset-0 bg-slate-950/25" /><span className="relative z-10">{item.tag}</span><Newspaper className="relative z-10 h-8 w-8" /></div><div className="p-5"><div className="flex items-center gap-2 text-xs text-slate-400"><span>{item.source}</span><span>·</span><span>{item.time}</span></div><h2 className="mt-3 text-lg font-bold leading-6 tracking-[-0.03em] text-slate-950">{item.title}</h2><button type="button" onClick={() => setSelected(item)} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">Read more <ArrowRight className="h-3.5 w-3.5" /></button></div></article>)}</div>
    {selected && <NewsDetail item={selected} onClose={() => setSelected(null)} />}
  </section>;
}
