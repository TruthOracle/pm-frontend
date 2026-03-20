const UPSTREAM_LEDGER_BASE_URL =
  "https://api.validator.dev.digik.cantor8.tech/api/ledger";

function getPathSegments(req) {
  // Vercel passes catch-all params as `req.query.path`.
  const p = req.query?.path;
  if (!p) return [];
  return Array.isArray(p) ? p : [String(p)];
}

function isJsonContentType(contentType) {
  return typeof contentType === "string" && contentType.toLowerCase().includes("application/json");
}

async function handler(req, res) {
  try {
    const segments = getPathSegments(req);
    const upstreamUrl = `${UPSTREAM_LEDGER_BASE_URL}/${segments.join("/")}${new URL(req.url, "http://localhost").search}`;

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

