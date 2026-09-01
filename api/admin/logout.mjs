/** POST /api/admin/logout — drop the admin session cookie. */

import { clearedCookie } from "../_lib/adminSession.mjs";

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json");
  res.setHeader("set-cookie", clearedCookie());
  res.statusCode = req.method === "POST" ? 200 : 405;
  res.end(JSON.stringify(req.method === "POST" ? { ok: true } : { error: "method not allowed" }));
}
