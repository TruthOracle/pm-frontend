/**
 * GET /api/admin/nonce — issue a login challenge.
 *
 * Public by design: a nonce is worthless without a signature from a pinned operator
 * key, and requiring auth to start an auth flow would be circular.
 */

import { isConfigured, issueNonce } from "../_lib/adminSession.mjs";

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  if (!isConfigured()) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "admin auth is not configured on this deployment" }));
    return;
  }

  const { nonce, expiresAt } = issueNonce();
  res.statusCode = 200;
  res.end(JSON.stringify({ nonce, expiresAt }));
}
