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

async function fetchHackerNews() {
  const url = new URL(HACKER_NEWS_URL);
  url.searchParams.set("query", "prediction markets");
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", "12");
  const response = await fetchWithTimeout(url, 7000);
  if (!response.ok) throw new Error(`Hacker News returned ${response.status}`);
  const data = await response.json();
  const isMarketStory = (item) => /prediction market|kalshi|polymarket|cftc|forecast market|betting market|financial market|trading market/i.test(item.title || "");
  let hits = (data.hits || []).filter(isMarketStory);
  if (hits.length === 0) {
    url.searchParams.set("query", "financial markets");
    const retry = await fetchWithTimeout(url, 7000);
    if (retry.ok) hits = ((await retry.json()).hits || []).filter(isMarketStory);
  }
  return {
    articles: hits.filter((item) => item.title && (item.url || item.story_url)).map((item) => ({
      title: item.title,
      url: item.url || item.story_url,
      domain: item.url ? new URL(item.url).hostname.replace(/^www\./, "") : "Hacker News",
      seendate: item.created_at,
    })),
  };
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
