export type MarketNewsItem = { tag: string; source: string; time: string; title: string; url: string; image?: string };
export const NEWS_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const CATEGORY_THUMBNAILS: Record<string, string> = {
  "Prediction markets": "https://images.unsplash.com/photo-1559526324-593bc073d938?auto=format&fit=crop&w=900&q=80",
  Regulation: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=900&q=80",
  "Crypto markets": "https://images.unsplash.com/photo-1621416894569-0f39ed31d247?auto=format&fit=crop&w=900&q=80",
  "Market research": "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=80",
  "Market update": "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=900&q=80",
  "DAML / Canton": "https://images.unsplash.com/photo-1639322537228-f710d846310a?auto=format&fit=crop&w=900&q=80",
  "Market brief": "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=900&q=80",
  Explainer: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=900&q=80",
  Learn: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=900&q=80",
};

export function getNewsThumbnail(item: MarketNewsItem) {
  return item.image || CATEGORY_THUMBNAILS[item.tag] || CATEGORY_THUMBNAILS["Market update"];
}

export function getTickerHeadline(title: string) {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  if (cleanTitle.length <= 64) return cleanTitle;
  const shortened = cleanTitle.slice(0, 64).replace(/\s+\S*$/, "").trim();
  return `${shortened}…`;
}

type NewsApiArticle = { title?: string; url?: string; domain?: string; source?: string; seendate?: string; image?: string; topic?: string };

function formatDate(value?: string) {
  if (!value) return "Latest";
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  const parsed = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Latest" : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getNewsTag(title: string, source: string, topic?: string) {
  if (topic) return topic;
  const text = `${title} ${source}`.toLowerCase();
  if (text.includes("daml") || text.includes("canton") || text.includes("cantor8")) return "DAML / Canton";
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
    tag: getNewsTag(item.title as string, item.domain || item.source || "", item.topic), source: item.domain || item.source || "Google News", time: formatDate(item.seendate),
    title: item.title as string, url: item.url as string, image: item.image,
  }));
  return mapped.slice(0, 6);
}
