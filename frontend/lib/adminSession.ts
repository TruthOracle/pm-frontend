/**
 * Admin session client — the browser half of the signature challenge.
 *
 * The wallet popup proves control of an operator party by signing a server-issued
 * nonce; the server verifies that against a public key pinned in its own env and
 * hands back an HttpOnly cookie. Nothing security-relevant is decided here: this
 * module only drives the handshake and reports what the server said, so tampering
 * with it produces a UI that renders admin controls whose calls then 401.
 */

export interface AdminSession {
  configured: boolean;
  authenticated: boolean;
  partyId: string | null;
  expiresAt: number | null;
}

/**
 * The page-load half of the session credential. Deliberately a plain module variable —
 * NOT localStorage/sessionStorage — so it exists only inside this loaded page. The
 * server pinned its hash into the session cookie at login; privileged calls must echo
 * it via the x-admin-instance header. Reloading or leaving the page destroys it, which
 * is exactly the policy: every new page document requires a fresh wallet signature.
 */
let instanceToken: string | null = null;

function newInstanceToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Header pair for privileged calls; empty when this page has never signed in. */
export function adminInstanceHeaders(): Record<string, string> {
  return instanceToken ? { "x-admin-instance": instanceToken } : {};
}

const UNCONFIGURED: AdminSession = {
  configured: false,
  authenticated: false,
  partyId: null,
  expiresAt: null,
};

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 300) };
  }
}

/**
 * Header, MarketView and AdminGate all gate on the session, so a naive hook would fire
 * three identical requests on every page load. Concurrent callers share one in-flight
 * request; it is dropped as soon as it settles, so the next call still re-checks rather
 * than trusting a stale answer.
 */
let inFlight: Promise<AdminSession> | null = null;

/** Who the server thinks we are. Never throws — a failure reads as "not signed in". */
export function fetchAdminSession(): Promise<AdminSession> {
  if (!inFlight) {
    inFlight = requestAdminSession().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function requestAdminSession(): Promise<AdminSession> {
  try {
    const res = await fetch("/api/admin/me", {
      credentials: "same-origin",
      cache: "no-store",
      // Without the instance header the server reports unauthenticated even when a
      // cookie survives a reload — which is what makes the reload require sign-in.
      headers: adminInstanceHeaders(),
    });
    if (!res.ok) return UNCONFIGURED;
    const data = await readJson(res);
    return {
      configured: Boolean(data.configured),
      authenticated: Boolean(data.authenticated),
      partyId: typeof data.partyId === "string" ? data.partyId : null,
      expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
    };
  } catch {
    return UNCONFIGURED;
  }
}

/**
 * Run the challenge. `signMessage` is the wallet provider's bound method — the popup
 * asks the operator to approve, so this call blocks on a human.
 */
export async function signInAsAdmin(args: {
  partyId: string;
  signMessage: (message: string, partyId?: string) => Promise<string>;
}): Promise<AdminSession> {
  const nonceRes = await fetch("/api/admin/nonce", { credentials: "same-origin", cache: "no-store" });
  const nonceData = await readJson(nonceRes);
  if (!nonceRes.ok || typeof nonceData.nonce !== "string") {
    throw new Error(String(nonceData.error ?? `Could not start admin login (${nonceRes.status})`));
  }

  const signature = await args.signMessage(nonceData.nonce, args.partyId);
  if (!signature) throw new Error("The wallet returned an empty signature.");

  // Fresh binding for this login; replaces any previous one so at most one session
  // per page load is live.
  const freshInstance = newInstanceToken();

  // No publicKey is sent: the server verifies against its own pinned key for this
  // party. Supplying one here would let any caller sign with a key of their choosing.
  const res = await fetch("/api/admin/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partyId: args.partyId,
      nonce: nonceData.nonce,
      signature,
      instanceToken: freshInstance,
    }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(String(data.error ?? `Admin login failed (${res.status})`));
  instanceToken = freshInstance;

  return {
    configured: true,
    authenticated: true,
    partyId: typeof data.partyId === "string" ? data.partyId : args.partyId,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null,
  };
}

export async function signOutAsAdmin(): Promise<void> {
  instanceToken = null;
  try {
    await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // Best effort — dropping the instance token above already killed the session
    // (the cookie is inert without it), and the cookie expires on its own.
  }
}
