/**
 * Fetch wrapper for the accounts backend (truthoracle-backend), reached through the
 * same-origin relay at BACKEND_BASE_URL (api/proxy/backend.mjs → BACKEND_URL).
 *
 * Small on purpose and free of React: AuthContext, the account page and the in-app
 * wallet all sit on top of this one function so the session and CSRF conventions from
 * truthoracle-backend/docs/API.md live in exactly one place:
 *   - `credentials: "include"` so the HttpOnly `to_session` cookie rides along;
 *   - `x-requested-with: truthoracle` on every call — together with the browser's own
 *     Origin header this is what the backend's CSRF rule accepts on non-GET requests;
 *   - JSON in, JSON out; failures surface as BackendError carrying the server's
 *     { error, message, details } so callers branch on `code`, never on prose.
 *
 * A deployment without a backend answers 503 backend_unconfigured from the relay. That
 * is a normal state, not a failure: probeBackend() reports it as "unconfigured" and the
 * UI simply shows no sign-in. A backend that exists but does not answer is a different
 * state ("unreachable") and is never cached — see probeBackend. None of the anonymous,
 * wallet-signed flows come through here.
 */

import { BACKEND_BASE_URL } from "@/config";
import type { BackendErrorCode } from "@/auth/types";

export { BACKEND_BASE_URL };

export type BackendMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface BackendFetchInit {
  method?: BackendMethod;
  /** JSON-serialised as the request body. Omit for bodiless requests. */
  body?: unknown;
  signal?: AbortSignal;
  /** Extra request headers the relay forwards (today only `idempotency-key`, the card ramp's retry token). */
  headers?: Record<string, string>;
}

/**
 * The server's error envelope (API.md): HTTP status plus { error, message, details? }.
 * `code` is a `BackendErrorCode` whenever the server behaves; it stays `string` here
 * because the wire is untyped (an unknown code must still be representable).
 */
export class BackendError extends Error {
  readonly status: number;
  readonly code: BackendErrorCode | string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BackendError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Narrowing helper for catch blocks: `isBackendError(e, "kyc_required")`. */
export function isBackendError(error: unknown, code?: string): error is BackendError {
  return error instanceof BackendError && (code === undefined || error.code === code);
}

interface ErrorEnvelope {
  error?: unknown;
  message?: unknown;
  details?: unknown;
}

/**
 * A non-JSON error body is almost always a platform page (Vercel's 404 when the
 * rewrite is missing, Railway's 502) — its HTML is noise, not a message for the user.
 */
function fallbackMessage(status: number, text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<")) return `Backend request failed (${status}).`;
  return trimmed.slice(0, 300);
}

export async function backendFetch<T>(path: string, init: BackendFetchInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {
    ...init.headers,
    accept: "application/json",
    "x-requested-with": "truthoracle",
  };
  let body: string | undefined;
  if (init.body !== undefined && method !== "GET") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_BASE_URL}${path}`, {
      method,
      headers,
      body,
      credentials: "include",
      cache: "no-store",
      signal: init.signal,
    });
  } catch (error) {
    // An abort is the caller's own doing — hand back the AbortError they asked for.
    if (init.signal?.aborted) throw error;
    throw new BackendError(0, "network_error", "Could not reach the accounts backend.");
  }

  const text = await res.text();
  let data: unknown;
  let parsed = false;
  if (text) {
    try {
      data = JSON.parse(text);
      parsed = true;
    } catch {
      parsed = false;
    }
  }

  if (!res.ok) {
    const envelope: ErrorEnvelope = parsed && data && typeof data === "object" ? (data as ErrorEnvelope) : {};
    const code = typeof envelope.error === "string" && envelope.error ? envelope.error : `http_${res.status}`;
    const message =
      typeof envelope.message === "string" && envelope.message ? envelope.message : fallbackMessage(res.status, text);
    const error = new BackendError(res.status, code, message, envelope.details);
    // A revoked / expired session shows up as a 401 on whatever call came next. Tell
    // AuthProvider so the header and the account page stop claiming a signed-in state
    // instead of waiting for the expiresAt timer (up to seven days away).
    if (res.status === 401 && code === "unauthenticated") notifyUnauthenticated(error);
    throw error;
  }
  if (text && !parsed) {
    throw new BackendError(res.status, "invalid_response", "The accounts backend returned a non-JSON response.");
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Session-loss hook
// ---------------------------------------------------------------------------

type UnauthenticatedListener = (error: BackendError) => void;
let unauthenticatedListener: UnauthenticatedListener | null = null;

/**
 * Register the one listener (AuthProvider) that re-probes the session when any call
 * answers 401 unauthenticated. Returns the unregister function. The listener is
 * invoked at most once per failing response; it is its own job to coalesce.
 */
export function onUnauthenticated(listener: UnauthenticatedListener): () => void {
  unauthenticatedListener = listener;
  return () => {
    if (unauthenticatedListener === listener) unauthenticatedListener = null;
  };
}

function notifyUnauthenticated(error: BackendError): void {
  try {
    unauthenticatedListener?.(error);
  } catch {
    // A listener bug must never turn a 401 into an uncaught exception in the caller.
  }
}

// ---------------------------------------------------------------------------
// Availability probe
// ---------------------------------------------------------------------------

/**
 *  ok            /health answered 200 — accounts exist and the backend is up.
 *  unconfigured  the relay answered 503 backend_unconfigured — no backend on this
 *                deployment (§4.1); the app is the pre-accounts app.
 *  unreachable   a backend is configured but did not answer (502 backend_unreachable,
 *                network error, a Railway cold start, any 5xx). Transient by nature.
 */
export type BackendAvailability = "ok" | "unconfigured" | "unreachable";

/**
 * One probe per page load for the DEFINITIVE answers ("ok", "unconfigured"), shared by
 * every caller so AuthContext, the header and the wallet cards do not each fire their
 * own on mount. "unreachable" is never cached: the promise is dropped as soon as it
 * settles so the next refresh() re-probes — "no backend" hides the Sign-in button and
 * the money controls for good, while an outage must keep offering them (paused) and
 * recover on its own. Never throws.
 */
let availability: Promise<BackendAvailability> | null = null;

export function probeBackend(): Promise<BackendAvailability> {
  if (!availability) {
    availability = backendFetch<unknown>("/health")
      .then((): BackendAvailability => "ok")
      .catch((error: unknown): BackendAvailability => {
        if (isBackendError(error, "backend_unconfigured")) return "unconfigured";
        availability = null;
        return "unreachable";
      });
  }
  return availability;
}

/** Test / recovery hook: forget the cached answer so the next probe hits the relay again. */
export function resetBackendAvailability(): void {
  availability = null;
}

// ---------------------------------------------------------------------------
// File downloads (operator exports: the bank payout file, CSV reports)
// ---------------------------------------------------------------------------

/** A file the backend answered with. */
export interface BackendDownload {
  blob: Blob;
  filename: string;
  contentType: string;
}

/**
 * The file name a `Content-Disposition` header names — the RFC 5987 `filename*` form first, then
 * `filename` — reduced to a safe basename (no path, no control characters). `fallback` when the
 * header names none.
 */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  const value = String(header ?? "");
  let name = "";
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(value);
  if (extended) {
    const raw = extended[1].trim().replace(/^"(.*)"$/, "$1");
    const encoded = raw.includes("''") ? raw.slice(raw.indexOf("''") + 2) : raw;
    try {
      name = decodeURIComponent(encoded);
    } catch {
      name = "";
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(value);
    if (plain) name = (plain[2] ?? plain[1]).trim();
  }
  // eslint-disable-next-line no-control-regex
  const visible = name.replace(/[\u0000-\u001f\u007f]/g, "");
  const safe = visible.split(/[\\/]/).pop()?.trim() ?? "";
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

/**
 * Fetch a file from the backend. POST by default: an export is audited and may change state (the
 * first export of a payout batch), so it is never a GET a cross-site navigation could trigger. The
 * same session and CSRF conventions as backendFetch; a failure is the usual JSON envelope and throws
 * BackendError, a success is the raw bytes plus the file name the server chose.
 */
export async function backendDownload(
  path: string,
  init: BackendFetchInit & { fallbackName?: string } = {},
): Promise<BackendDownload> {
  const method = init.method ?? "POST";
  const headers: Record<string, string> = {
    ...init.headers,
    accept: "text/csv, application/octet-stream, application/json;q=0.5",
    "x-requested-with": "truthoracle",
  };
  let body: string | undefined;
  if (init.body !== undefined && method !== "GET") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_BASE_URL}${path}`, {
      method,
      headers,
      body,
      credentials: "include",
      cache: "no-store",
      signal: init.signal,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new BackendError(0, "network_error", "Could not reach the accounts backend.");
  }

  if (!res.ok) {
    const text = await res.text();
    let envelope: ErrorEnvelope = {};
    try {
      const data: unknown = JSON.parse(text);
      if (data && typeof data === "object") envelope = data as ErrorEnvelope;
    } catch {
      envelope = {};
    }
    const code = typeof envelope.error === "string" && envelope.error ? envelope.error : `http_${res.status}`;
    const message =
      typeof envelope.message === "string" && envelope.message ? envelope.message : fallbackMessage(res.status, text);
    const error = new BackendError(res.status, code, message, envelope.details);
    if (res.status === 401 && code === "unauthenticated") notifyUnauthenticated(error);
    throw error;
  }

  const blob = await res.blob();
  return {
    blob,
    filename: filenameFromDisposition(res.headers.get("content-disposition"), init.fallbackName ?? "download"),
    contentType: res.headers.get("content-type") ?? blob.type ?? "application/octet-stream",
  };
}
