/**
 * Access policy for the credential-injecting proxies.
 *
 * Both proxies attach a server-minted token that carries real authority — the wallet's
 * admin signing key, and a ledger client holding ParticipantAdmin. Whoever can reach
 * them wields that authority, so the policy here is deny-by-default: a request is
 * forwarded only if it matches an explicit read-only allowlist, or the caller presents
 * a valid admin session.
 *
 * The allowlists below are derived from what the browser actually calls (see
 * frontend/lib/cantonParticipant.ts). Adding a path here grants it to the entire
 * internet — check that the upstream endpoint is safe in anonymous hands first.
 */

import { currentOperator, isConfigured } from "./adminSession.mjs";

/**
 * Ledger endpoints safe to expose unauthenticated.
 *
 * The reads are public data — this is a public prediction market, and the same
 * contracts are visible to any observer party. `interactive-submission/*` is included
 * because it is self-authorising: `prepare` only builds an unsigned transaction, and
 * `execute` is rejected by the participant unless it carries a valid signature from
 * the acting party, whose key we do not hold. Notably ABSENT: /v2/users/* (which would
 * let anyone grant themselves rights on the participant) and /v2/parties.
 */
const LEDGER_PUBLIC_PATHS = new Set([
  "v2/state/active-contracts",
  "v2/state/ledger-end",
  "v2/state/connected-synchronizers",
  "v2/interactive-submission/prepare",
  "v2/interactive-submission/execute",
]);

/**
 * The wallet proxy has NO public surface. Every one of its endpoints either signs with
 * the admin key or discloses treasury state. The two flows ordinary users need with a
 * treasury signature — crediting a deposit and settling a payout — live in the accounts
 * backend (truthoracle-backend), behind a user session, and derive their amounts from
 * upstream state instead of trusting the caller.
 */
const WALLET_PUBLIC_PATHS = new Set();

function normalise(path) {
  return String(path || "").split("?")[0].replace(/^\/+|\/+$/g, "");
}

/**
 * CSRF fence for the session-authorised branch. The cookie is already SameSite=Strict,
 * so a compliant browser never attaches it cross-site; this rejects the request even
 * if it somehow arrives with one (an old browser, a future cookie-attribute slip).
 * A missing Origin header passes — browsers always send it on cross-site fetches, and
 * non-browser clients don't hold the HttpOnly cookie to begin with.
 */
function crossOrigin(req) {
  const origin = req.headers?.origin;
  if (typeof origin !== "string" || !origin || origin === "null") {
    return origin === "null";
  }
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const ownHost = String(req.headers?.["x-forwarded-host"] ?? req.headers?.host ?? "")
    .split(",")[0]
    .trim();
  return !ownHost || originHost !== ownHost;
}

/**
 * @returns {{allow: true, operator: object|null} | {allow: false, status: number, error: string}}
 */
export function authorise({ req, path, kind }) {
  const publicPaths = kind === "ledger" ? LEDGER_PUBLIC_PATHS : WALLET_PUBLIC_PATHS;
  const cleaned = normalise(path);

  // Read-only allowlist entries are GET-or-POST because the JSON Ledger API models
  // queries as POST bodies; the path itself is what constrains the capability.
  if (publicPaths.has(cleaned)) return { allow: true, operator: null };

  if (!isConfigured()) {
    // Fail CLOSED. An unconfigured deployment previously meant "wide open", which is
    // exactly the state this module exists to prevent.
    return {
      allow: false,
      status: 503,
      error:
        "This endpoint requires an admin session, but ADMIN_SESSION_SECRET is not set " +
        "on this deployment. See ADMIN_AUTH.md.",
    };
  }

  if (crossOrigin(req)) {
    return { allow: false, status: 403, error: "cross-origin request rejected" };
  }

  const operator = currentOperator(req);
  if (!operator) {
    return { allow: false, status: 401, error: "admin session required" };
  }
  return { allow: true, operator };
}
