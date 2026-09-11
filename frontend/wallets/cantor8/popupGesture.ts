/**
 * Popup-gesture rules for the Cantor8 wallet, and the SDK failure they produce.
 *
 * The Cantor8 wallet is a browser popup (`window.open`). Browsers grant ONE popup per
 * user click: opening a popup consumes the click's transient activation (HTML "window
 * open steps" → "consume user activation"; Chrome, Firefox and WebKit all do this), and
 * the activation itself expires 5 s after the click. A second `window.open` in the same
 * gesture returns `null`. The wallet popup also closes itself after every approval, so
 * every SDK call that needs the wallet's approval (connect, signMessage, send,
 * signAndExecute) opens a fresh popup.
 *
 * Two consequences every caller must respect:
 *
 *  1. ONE POPUP PER CLICK. Never chain `connect()` and `signMessage()` (or a transfer)
 *     inside one handler. Give each its own button.
 *  2. THE SDK CALL IS THE FIRST THING THE CLICK DOES. Fetch challenges / nonces BEFORE
 *     the click and pass them in; do not `await` a network round trip between the click
 *     and the SDK call. Chrome and Firefox tolerate a short await (5 s activation
 *     window), WebKit forwards the gesture only through `fetch()` itself and not through
 *     `response.json()`, so the safe rule is: nothing awaited in front of the SDK call.
 *
 * When the rule is broken (or the person runs a strict popup blocker) SDK 0.5.0 does not
 * report `POPUP_BLOCKED`. Its popup transport rejects and CLEARS its init deferred, then
 * reads `.promise` on the cleared field, so the caller receives
 * `TypeError: Cannot read properties of undefined (reading 'promise')` (V8 wording;
 * Firefox: "this.initDeferred is undefined"; Safari: "undefined is not an object
 * (evaluating 'this.initDeferred.promise')"). Reproduced deterministically in Node
 * against the bundle on 2026-09-11 (window.open → null). The transport is also left with
 * `popup === null`, after which every later call on that provider hangs until
 * `disconnect()` destroys and resets it — see Cantor8WalletContext.resetAfterBlockedPopup.
 *
 * This module is pure TypeScript (no React, no SDK import) so it is unit-tested directly.
 */

/** Stable code so callers can branch without matching prose. */
export const WALLET_POPUP_BLOCKED = "wallet_popup_blocked" as const;

export const WALLET_POPUP_BLOCKED_SENTENCE =
  "Your browser blocked the wallet popup. Allow pop-ups for this site, then connect the wallet again.";

export class WalletPopupBlockedError extends Error {
  readonly code = WALLET_POPUP_BLOCKED;
  /** The SDK error the translation replaced, for logs. */
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super(WALLET_POPUP_BLOCKED_SENTENCE);
    this.name = "WalletPopupBlockedError";
    this.cause = cause;
  }
}

export function isWalletPopupBlocked(err: unknown): err is WalletPopupBlockedError {
  return err instanceof WalletPopupBlockedError;
}

/**
 * The SDK crash signature: a TypeError on reading `.promise` of the cleared deferred.
 * The three engines word it differently; `initDeferred` is the SDK's field name and
 * survives minification (it is a property, not a local).
 */
const SDK_CRASH_PATTERNS: readonly RegExp[] = [
  /Cannot read properties of undefined \(reading 'promise'\)/, // V8 (Chrome, Edge, Node)
  /initDeferred is undefined/, // SpiderMonkey (Firefox)
  /undefined is not an object \(evaluating '[^']*\.promise'\)/, // JavaScriptCore (Safari)
];

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message ?? "");
  return "";
}

function codeOf(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) return String((err as { code: unknown }).code ?? "");
  return "";
}

/**
 * True for the mis-reported crash above AND for a properly reported block (should a
 * later SDK surface `POPUP_BLOCKED`, or keep `INITIALIZATION_FAILED` with the SDK's own
 * "browser blocked the popup window" text), so the translation does not regress when the
 * upstream bug is fixed.
 */
export function isSdkPopupBlockedFailure(err: unknown): boolean {
  const message = messageOf(err);
  if (err instanceof TypeError && SDK_CRASH_PATTERNS.some((re) => re.test(message))) return true;
  const code = codeOf(err);
  if (code === "POPUP_BLOCKED") return true;
  if (code === "INITIALIZATION_FAILED" && /blocked the popup/i.test(message)) return true;
  return false;
}

/**
 * Turn whatever the SDK threw into something the UI can show: the popup-blocked crash
 * becomes `WalletPopupBlockedError`; everything else is returned as an Error unchanged
 * (the wallet's own rejections — "User rejected the request", timeouts — already read
 * well and are matched downstream by `authErrorMessage`).
 */
export function translateWalletError(err: unknown): Error {
  if (isWalletPopupBlocked(err)) return err;
  if (isSdkPopupBlockedFailure(err)) return new WalletPopupBlockedError(err);
  if (err instanceof Error) return err;
  return new Error(messageOf(err) || String(err));
}
