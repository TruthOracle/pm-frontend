export type MarketNewsItem = { tag: string; source: string; time: string; title: string; url: string };

export const FALLBACK_MARKET_NEWS: MarketNewsItem[] = [
  { tag: "Market brief", source: "TruthOracle Research", time: "Latest", title: "The week ahead: five questions markets are watching", url: "" },
  { tag: "Explainer", source: "Canton Network", time: "Latest", title: "Why transparent settlement changes the way we forecast", url: "" },
  { tag: "Learn", source: "Oracle desk", time: "Latest", title: "Reading probability: a practical guide to Yes and No", url: "" },
];

type NewsApiArticle = { title?: string; url?: string; domain?: string; seendate?: string };

function formatDate(value?: string) {
  if (!value) return "Latest";
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  const parsed = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Latest" : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export async function fetchMarketNews(): Promise<MarketNewsItem[]> {
  const response = await fetch(`/api/news?refresh=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Live news is temporarily unavailable");
  const data = (await response.json()) as { articles?: NewsApiArticle[] };
  return (data.articles ?? []).filter((item) => item.title && item.url).slice(0, 6).map((item) => ({
    tag: "Live market news", source: item.domain || "Hacker News", time: formatDate(item.seendate),
    title: item.title as string, url: item.url as string,
  }));
}
