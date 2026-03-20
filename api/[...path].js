const LEDGER_UPSTREAM_BASE_URL =
  "https://api.validator.dev.digik.cantor8.tech/api/ledger";

function stripPrefix(pathname, prefix) {
  if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  return pathname;
}

async function readRequestBody(req) {
  const contentType = req.headers?.["content-type"] || "";
  const isJson = String(contentType).toLowerCase().includes("application/json");

  // If Vercel/Next already parsed JSON, `req.body` may exist.
  if (typeof req.body !== "undefined") {
    if (isJson && typeof req.body === "object") return JSON.stringify(req.body);
    return req.body;
  }

  return await new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve(undefined);
      if (isJson) {
        // Keep JSON as string; upstream expects JSON.
        try {
          JSON.parse(raw);
          resolve(raw);
        } catch {
          // If JSON parse fails, forward raw anyway.
          resolve(raw);
        }
      } else {
        resolve(raw);
      }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname; // e.g. /api/ledger/v2/state/ledger-end

    const apiPath = stripPrefix(pathname, "/api/"); // ledger/v2/state/ledger-end
    const segments = apiPath.split("/").filter(Boolean);

    if (!segments.length || segments[0] !== "ledger") {
      res.status(404).send("Not Found");
      return;
    }

    const upstreamPath = segments.slice(1).join("/");
    const upstreamUrl = `${LEDGER_UPSTREAM_BASE_URL}/${upstreamPath}${url.search}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      const k = key.toLowerCase();
      if (k === "host" || k === "connection") continue;
      if (k === "content-length") continue;
      if (typeof value === "undefined") continue;
      headers.set(key, String(value));
    }

    const method = (req.method || "GET").toUpperCase();
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await readRequestBody(req);

    const upstreamRes = await fetch(upstreamUrl, {
      method,
      headers,
      body,
    });

    res.status(upstreamRes.status);
    for (const [key, value] of upstreamRes.headers.entries()) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      res.setHeader(key, value);
    }

    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res
      .status(500)
      .json({ error: "ledger-proxy-failed", message: String(e?.message || e) });
  }
};

