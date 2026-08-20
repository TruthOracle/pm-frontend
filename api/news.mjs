const HACKER_NEWS_URL = "https://hn.algolia.com/api/v1/search_by_date";

async function fetchWithTimeout(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchArticleImage(articleUrl) {
  try {
    const response = await fetchWithTimeout(articleUrl, 2500);
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("text/html")) return undefined;
    const html = await response.text();
    const match = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    if (!match?.[1]) return undefined;
    return new URL(match[1], articleUrl).href;
  } catch {
    return undefined;
  }
}

async function fetchHackerNews() {
  const queries = ["prediction markets", "financial markets", "crypto markets", "market research", "market regulation"];
  const results = await Promise.all(queries.map(async (query) => {
    const url = new URL(HACKER_NEWS_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("tags", "story");
    url.searchParams.set("hitsPerPage", "8");
    const response = await fetchWithTimeout(url, 7000);
    if (!response.ok) return [];
    const data = await response.json();
    return data.hits || [];
  }));
  const isMarketStory = (item) => /prediction market|kalshi|polymarket|cftc|forecast market|betting market|financial market|trading market|crypto|bitcoin|ethereum|market research|market regulation/i.test(item.title || "");
  const seen = new Set();
  const hits = results.flat().filter((item) => {
    const key = item.url || item.story_url || item.title;
    if (!item.title || !key || seen.has(key) || !isMarketStory(item)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()).slice(0, 12);
  const articles = hits.map((item) => ({
      title: item.title,
      url: item.url || item.story_url,
      domain: item.url ? new URL(item.url).hostname.replace(/^www\./, "") : "Hacker News",
      seendate: item.created_at,
    }));
  return { articles: await Promise.all(articles.map(async (article) => ({ ...article, image: await fetchArticleImage(article.url) }))) };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end(JSON.stringify({ error: "Only GET is supported" }));
    return;
  }
  try {
    const data = await fetchHackerNews();
    if (!data.articles.length) throw new Error("No market-related articles found");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.end(JSON.stringify(data));
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "News service unavailable" }));
  }
}
