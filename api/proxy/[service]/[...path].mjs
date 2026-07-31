const TARGET_ENV = {
  keycloak: ["KEYCLOAK_PROXY_TARGET_URL", "VITE_KEYCLOAK_URL"],
  ledger: ["CANTON_LEDGER_PROXY_TARGET_URL", "VITE_CANTON_PARTICIPANT_URL"],
};

function absoluteTarget(value) {
  const trimmed = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function targetFor(service) {
  for (const name of TARGET_ENV[service] || []) {
    const target = absoluteTarget(process.env[name]);
    if (target) return target;
  }
  return "";
}

function headersForUpstream(req) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  return headers;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const service = String(req.query.service || "");
  const target = targetFor(service);
  if (!target) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      error: `Missing proxy target for ${service}`,
      expectedEnv: TARGET_ENV[service] || [],
    }));
    return;
  }

  const parts = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  const path = parts.map((part) => encodeURIComponent(String(part))).join("/");
  const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const body = ["GET", "HEAD"].includes(req.method || "") ? undefined : await readBody(req);
  const upstream = await fetch(`${target}/${path}${query}`, {
    method: req.method,
    headers: headersForUpstream(req),
    body,
    redirect: "manual",
  });

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!["content-encoding", "content-length", "transfer-encoding"].includes(lower)) {
      res.setHeader(key, value);
    }
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
