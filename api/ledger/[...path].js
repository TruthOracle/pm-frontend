const UPSTREAM_LEDGER_BASE_URL =
  "https://api.validator.dev.digik.cantor8.tech/api/ledger";

function getUpstreamPath(req) {
  // Derive from URL path so we don't depend on Vercel's query/params shape.
  // Example incoming: /api/ledger/v2/state/ledger-end
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const prefix = "/api/ledger";
  if (pathname === prefix) return "";
  if (pathname.startsWith(prefix + "/")) return pathname.slice(prefix.length + 1);
  // Fallback: if mounted differently, return full pathname without leading "/"
  return pathname.replace(/^\//, "");
}

function isJsonContentType(contentType) {
  return typeof contentType === "string" && contentType.toLowerCase().includes("application/json");
}

async function handler(req, res) {
  try {
    const upstreamPath = getUpstreamPath(req);
    const upstreamUrl = `${UPSTREAM_LEDGER_BASE_URL}/${upstreamPath}${new URL(req.url, "http://localhost").search}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (key === "host") continue;
      if (key === "connection") continue;
      if (key === "content-length") continue;
      if (typeof value === "undefined") continue;
      headers.set(key, String(value));
    }

    let body;
    if (req.method && req.method.toUpperCase() !== "GET" && req.method.toUpperCase() !== "HEAD") {
      const contentType = req.headers?.["content-type"];
      if (isJsonContentType(contentType)) {
        // Vercel typically parses JSON body into an object.
        body = req.body ?? undefined;
        if (body && typeof body === "object" && !(body instanceof Buffer)) {
          body = JSON.stringify(body);
        }
      } else if (typeof req.body !== "undefined") {
        // Forward non-JSON bodies as-is.
        body = req.body;
      }
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    });

    // Mirror upstream status + headers.
    res.status(upstreamRes.status);
    for (const [key, value] of upstreamRes.headers.entries()) {
      // Vercel/Next may dislike certain hop-by-hop headers; skip common ones.
      if (key.toLowerCase() === "transfer-encoding") continue;
      if (key.toLowerCase() === "content-encoding") {
        // Keep as-is; Vercel should handle decompression already.
      }
      res.setHeader(key, value);
    }

    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(500).json({
      error: "ledger-proxy-failed",
      message: e?.message ? String(e.message) : String(e),
    });
  }
}

module.exports = handler;

