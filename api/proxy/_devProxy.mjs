/**
 * Dev-only glue so `npm run dev` (plain Vite, where the serverless functions under
 * api/proxy/*.mjs do NOT run) gets the SAME server-side token injection as Vercel.
 *
 * It maps a connect/Vite middleware request onto the Vercel-style (req, res) handler:
 * Vercel routes `/__proxy/ledger/:path*` -> the handler with `req.query.path=:path*`,
 * so here we derive `path` from the URL and delegate to the real handler. Result:
 * one code path for dev and prod, and the Keycloak secret never reaches the browser
 * in either.
 */

export function proxyMiddleware(prefix, handler) {
  return (req, res, next) => {
    const rawUrl = req.url || "";
    if (rawUrl !== prefix && !rawUrl.startsWith(`${prefix}/`) && !rawUrl.startsWith(`${prefix}?`)) {
      return next();
    }
    const url = new URL(rawUrl, "http://localhost");
    const path = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length).replace(/^\//, "")
      : "";
    req.query = { ...(req.query || {}), path };
    Promise.resolve(handler(req, res)).catch((err) => next(err));
  };
}
