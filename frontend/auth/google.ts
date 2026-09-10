/**
 * Google Identity Services (ID-token flow), loaded as a script tag on demand.
 *
 * The GIS library is a global (`window.google`) with no npm package we would want to
 * bundle, so the loader is promise-cached: every dialog open shares one script tag and
 * one load. The button itself is re-rendered per open because each render carries a
 * fresh single-use nonce (ARCHITECTURE.md §7.1) — the token's `nonce` claim must match
 * one the server still holds.
 */
import { backendFetch } from "@/lib/backend";
import type { GoogleNonceResponse, LoginResult } from "./types";

const GIS_SRC = "https://accounts.google.com/gsi/client";

interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  use_fedcm_for_prompt?: boolean;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GsiButtonConfiguration {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
  locale?: string;
}

/** The slice of GIS we call — kept minimal so the real library can grow without breaking us. */
interface GoogleAccountsId {
  initialize(config: GoogleIdConfiguration): void;
  renderButton(parent: HTMLElement, options: GsiButtonConfiguration): void;
  cancel?(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

let gisLoad: Promise<GoogleAccountsId> | null = null;

/** Resolve the GIS `accounts.id` namespace, loading the script once per page. */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  const ready = window.google?.accounts?.id;
  if (ready) return Promise.resolve(ready);
  if (!gisLoad) {
    gisLoad = new Promise<GoogleAccountsId>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      script.addEventListener(
        "load",
        () => {
          const id = window.google?.accounts?.id;
          if (id) {
            resolve(id);
            return;
          }
          // Same reset as the error branch: a script that ran but left no namespace
          // (blocked by an extension, half-loaded) must not poison every later open.
          gisLoad = null;
          script.remove();
          reject(new Error("Google sign-in loaded but did not initialise."));
        },
        { once: true },
      );
      script.addEventListener(
        "error",
        () => {
          // Drop the cache so a later open retries instead of failing forever on a
          // transient network error.
          gisLoad = null;
          script.remove();
          reject(new Error("Could not load Google sign-in. Check your connection and try again."));
        },
        { once: true },
      );
      document.head.appendChild(script);
    });
  }
  return gisLoad;
}

export interface RenderGoogleButtonOptions {
  clientId: string;
  nonce: string;
  onCredential: (credential: string) => void;
  /** "continue_with" reads better in link mode. */
  text?: GsiButtonConfiguration["text"];
}

/**
 * Render the GIS button into `container`. Returns a cleanup that empties the container,
 * which makes the call StrictMode-safe: mount → cleanup → mount leaves exactly one
 * button. `initialize` is (re)called here rather than once globally because the nonce
 * is per render; GIS treats a repeat call as a config replacement.
 */
export async function renderGoogleButton(
  container: HTMLElement,
  options: RenderGoogleButtonOptions,
): Promise<() => void> {
  const id = await loadGoogleIdentity();
  id.initialize({
    client_id: options.clientId,
    nonce: options.nonce,
    callback: (response) => {
      if (response.credential) options.onCredential(response.credential);
    },
    // We never call prompt() (One Tap); the flag only silences the FedCM migration warning.
    use_fedcm_for_prompt: false,
  });
  container.replaceChildren();
  // GIS wants an explicit pixel width (max 400) or it renders a narrow default.
  const width = Math.max(200, Math.min(400, Math.floor(container.clientWidth || 320)));
  id.renderButton(container, {
    type: "standard",
    theme: "outline",
    size: "large",
    shape: "pill",
    text: options.text ?? "signin_with",
    logo_alignment: "left",
    width,
  });
  return () => container.replaceChildren();
}

/** Step 1 of the login flow: a single-use nonce the ID token must echo. */
export function requestGoogleNonce(): Promise<GoogleNonceResponse> {
  return backendFetch<GoogleNonceResponse>("/api/v1/auth/google/nonce", { method: "POST" });
}

/** Step 3: exchange the GIS credential for a session (or a link, when one exists). */
export function signInWithGoogle(credential: string, nonce: string): Promise<LoginResult> {
  return backendFetch<LoginResult>("/api/v1/auth/google", {
    method: "POST",
    body: { credential, nonce },
  });
}
