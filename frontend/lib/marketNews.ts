export type MarketNewsItem = { tag: string; source: string; time: string; title: string; url: string; image?: string };

const CATEGORY_THUMBNAILS: Record<string, string> = {
  "Prediction markets": "https://images.unsplash.com/photo-1559526324-593bc073d938?auto=format&fit=crop&w=900&q=80",
  Regulation: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=900&q=80",
  "Crypto markets": "https://images.unsplash.com/photo-1621416894569-0f39ed31d247?auto=format&fit=crop&w=900&q=80",
  "Market research": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=80",
  "Market update": "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=900&q=80",
  "Market brief": "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=900&q=80",
  Explainer: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=900&q=80",
  Learn: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=900&q=80",
};

export function getNewsThumbnail(item: MarketNewsItem) {
  return item.image || CATEGORY_THUMBNAILS[item.tag] || CATEGORY_THUMBNAILS["Market update"];
}

export const FALLBACK_MARKET_NEWS: MarketNewsItem[] = [
  { tag: "Market brief", source: "TruthOracle Research", time: "Latest", title: "The week ahead: five questions markets are watching", url: "" },
  { tag: "Explainer", source: "Canton Network", time: "Latest", title: "Why transparent settlement changes the way we forecast", url: "" },
  { tag: "Learn", source: "Oracle desk", time: "Latest", title: "Reading probability: a practical guide to Yes and No", url: "" },
];

type NewsApiArticle = { title?: string; url?: string; domain?: string; seendate?: string; image?: string };

function formatDate(value?: string) {
  if (!value) return "Latest";
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  const parsed = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Latest" : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getNewsTag(title: string, source: string) {
  const text = `${title} ${source}`.toLowerCase();
  if (text.includes("cftc") || text.includes("regulat") || text.includes("lawsuit")) return "Regulation";
  if (text.includes("kalshi") || text.includes("polymarket") || text.includes("prediction market")) return "Prediction markets";
  if (text.includes("crypto") || text.includes("bitcoin") || text.includes("ethereum")) return "Crypto markets";
  if (text.includes("research") || text.includes("paper") || text.includes("microstructure")) return "Market research";
  return "Market update";
}

export async function fetchMarketNews(): Promise<MarketNewsItem[]> {
  const response = await fetch(`/api/news?refresh=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Live news is temporarily unavailable");
  const data = (await response.json()) as { articles?: NewsApiArticle[] };
  const mapped = (data.articles ?? []).filter((item) => item.title && item.url).slice(0, 12).map((item) => ({
    tag: getNewsTag(item.title as string, item.domain || ""), source: item.domain || "Hacker News", time: formatDate(item.seendate),
    title: item.title as string, url: item.url as string, image: item.image,
  }));
  const categoryOrder = ["Prediction markets", "Regulation", "Crypto markets", "Market research", "Market update"];
  const categoryFirst = categoryOrder.map((category) => mapped.find((item) => item.tag === category)).filter(Boolean) as MarketNewsItem[];
  const remaining = mapped.filter((item) => !categoryFirst.some((selected) => selected.url === item.url));
  return [...categoryFirst, ...remaining].slice(0, 6);
}
