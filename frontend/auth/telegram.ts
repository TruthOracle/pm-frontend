/**
 * Telegram sign-in — the Login Widget (script tag) and the OIDC redirect.
 *
 * The widget script reads its configuration from data-attributes at execution time and
 * inserts an iframe next to itself, so it cannot be promise-cached like GIS: each mount
 * appends a fresh script and each cleanup removes both nodes. The widget calls the
 * GLOBAL `window.onTelegramAuth(user)` named in `data-onauth`, which is why the handler
 * is registered before the script is appended — a fast redirect-return would otherwise
 * find nothing to call.
 */
import { BACKEND_BASE_URL, backendFetch } from "@/lib/backend";
import type { LoginMode, LoginResult, TelegramWidgetUser } from "./types";

const WIDGET_SRC = "https://telegram.org/js/telegram-widget.js?22";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramWidgetUser) => void;
  }
}

export interface MountTelegramWidgetOptions {
  botUsername: string;
  onAuth: (user: TelegramWidgetUser) => void;
}

/**
 * Append the Login Widget into `container`. Returns a cleanup that removes the script
 * and the iframe it inserted and unregisters the global handler (only if it is still
 * ours — a second mount may already have replaced it, StrictMode-style).
 */
export function mountTelegramWidget(container: HTMLElement, options: MountTelegramWidgetOptions): () => void {
  const handler = (user: TelegramWidgetUser) => options.onAuth(user);
  window.onTelegramAuth = handler;

  const script = document.createElement("script");
  script.src = WIDGET_SRC;
  script.async = true;
  script.setAttribute("data-telegram-login", options.botUsername);
  script.setAttribute("data-size", "large");
  script.setAttribute("data-userpic", "false");
  script.setAttribute("data-request-access", "write");
  script.setAttribute("data-onauth", "onTelegramAuth(user)");
  container.appendChild(script);

  return () => {
    // The widget inserts its iframe as a sibling of the script; the container is
    // dedicated to the widget, so clearing every child is the same as removing both
    // and also covers a script that has not executed yet.
    script.remove();
    for (const node of Array.from(container.querySelectorAll("iframe"))) node.remove();
    container.replaceChildren();
    if (window.onTelegramAuth === handler) delete window.onTelegramAuth;
  };
}

/** Widget callback → session. The body is the widget's user object as-is. */
export function signInWithTelegramWidget(user: TelegramWidgetUser): Promise<LoginResult> {
  return backendFetch<LoginResult>("/api/v1/auth/telegram/widget", { method: "POST", body: user });
}

/**
 * OIDC (Authorization Code + PKCE). The backend sets the `to_oidc` state cookie on the
 * redirect response, so this must be a top-level navigation through the same-origin
 * proxy — a fetch would not carry the 302 back to the browser's address bar. The
 * callback lands on `returnTo?auth=ok|error&code=…`, handled by AuthProvider.
 */
export function startTelegramOidc(mode: LoginMode, returnTo: string): void {
  // Same-origin path only (the server enforces the same rule); anything else → "/".
  const safeReturnTo = /^\/(?!\/)/.test(returnTo) ? returnTo : "/";
  const url =
    `${BACKEND_BASE_URL}/api/v1/auth/telegram/oidc/start` +
    `?mode=${encodeURIComponent(mode)}&returnTo=${encodeURIComponent(safeReturnTo)}`;
  let target: Window = window;
  try {
    if (window.top) target = window.top;
  } catch {
    // Cross-origin frame: window.top is inaccessible; navigate ourselves.
  }
  target.location.assign(url);
}
