const GOOGLE_NEWS_RSS = "https://news.google.com/rss";

async function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { "user-agent": "TruthOracle/1.0" } });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeXml(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function isPlatformPage(item) {
  const value = `${item.source} ${item.url}`.toLowerCase();
  return value.includes("polymarket.com") || value.includes("kalshi.com");
}

async function fetchNewsFeed() {
  const url = new URL(GOOGLE_NEWS_RSS);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const response = await fetchWithTimeout(url);
  if (!response.ok) return [];
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, item]) => ({
    title: readTag(item, "title"),
    url: readTag(item, "link"),
    source: readTag(item, "source") || "Google News",
    seendate: readTag(item, "pubDate"),
  })).filter((item) => item.title && item.url);
}

async function fetchMarketNews() {
  const results = await fetchNewsFeed().catch(() => []);
  const seen = new Set();
  const unique = results.filter((item) => {
    if (isPlatformPage(item)) return false;
    const key = item.url || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(b.seendate).getTime() - new Date(a.seendate).getTime());
  return unique;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end(JSON.stringify({ error: "Only GET is supported" }));
    return;
  }
  try {
    const articles = await fetchMarketNews();
    if (!articles.length) throw new Error("No current market news found");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ articles }));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "News service unavailable" }));
  }
}
