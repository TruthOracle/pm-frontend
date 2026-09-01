/**
 * GET /api/admin/me — who, if anyone, is signed in.
 *
 * The frontend gate calls this instead of deciding locally. It is a convenience for
 * rendering, never a security boundary: the proxies re-verify the cookie on every
 * privileged call, so spoofing this response only produces a UI that 401s.
 */

import { currentOperator, isConfigured } from "../_lib/adminSession.mjs";

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const operator = currentOperator(req);
  res.statusCode = 200;
  res.end(
    JSON.stringify({
      configured: isConfigured(),
      authenticated: Boolean(operator),
      partyId: operator?.partyId ?? null,
      expiresAt: operator?.expiresAt ?? null,
    }),
  );
}
