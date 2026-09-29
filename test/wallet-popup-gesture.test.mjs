/**
 * The Cantor8 popup-gesture rules (frontend/wallets/cantor8/popupGesture.ts) and the
 * helpers that keep wallet popups on their own click: the SDK-crash translation, the
 * sentences the dialogs show, and the freshness checks for prefetched challenges and
 * operator nonces.
 *
 * The last block runs the REAL @cantor8/wallet-connect-sdk bundle in Node with
 * `window.open` stubbed to return null (what every stock browser does when it blocks a
 * popup). It pins the two facts the app relies on: the SDK's failure is recognised as
 * "popup blocked" whatever it throws, and `disconnect()` un-wedges the transport so the
 * next click can open a popup again. Imported straight from frontend/ through the hooks
 * in _support/frontend-loader.mjs — no bundler, no browser.
 */

import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { register } from "node:module";

register("./_support/frontend-loader.mjs", import.meta.url);

globalThis.__VITE_ENV__ = { VITE_BACKEND_PROXY_URL: "/__backend" };

const gesture = await import("../frontend/wallets/cantor8/popupGesture.ts");
const wallet = await import("../frontend/auth/wallet.ts");
const admin = await import("../frontend/lib/adminSession.ts");
const { BackendError } = await import("../frontend/lib/backend.ts");

const V8 = new TypeError("Cannot read properties of undefined (reading 'promise')");
const GECKO = new TypeError("this.initDeferred is undefined");
const JSC = new TypeError("undefined is not an object (evaluating 'this.initDeferred.promise')");

describe("popupGesture: recognising a blocked popup", () => {
  it("matches the SDK crash in all three engines' wording", () => {
    for (const err of [V8, GECKO, JSC]) assert.equal(gesture.isSdkPopupBlockedFailure(err), true, err.message);
  });

  it("matches a properly reported block too, so a fixed SDK does not regress the sentence", () => {
    assert.equal(gesture.isSdkPopupBlockedFailure(Object.assign(new Error("browser blocked the popup window"), { code: "POPUP_BLOCKED" })), true);
    assert.equal(
      gesture.isSdkPopupBlockedFailure(Object.assign(new Error("browser blocked the popup window"), { code: "INITIALIZATION_FAILED" })),
      true,
    );
  });

  it("does not match other TypeErrors, wallet rejections, backend errors or junk", () => {
    assert.equal(gesture.isSdkPopupBlockedFailure(new TypeError("Cannot read properties of undefined (reading 'partyId')")), false);
    assert.equal(gesture.isSdkPopupBlockedFailure(new Error("Cannot read properties of undefined (reading 'promise')")), false, "only a TypeError");
    assert.equal(gesture.isSdkPopupBlockedFailure(Object.assign(new Error("User rejected the request"), { code: "USER_REJECTED" })), false);
    assert.equal(gesture.isSdkPopupBlockedFailure(Object.assign(new Error("Handshake timed out"), { code: "INITIALIZATION_FAILED" })), false);
    assert.equal(gesture.isSdkPopupBlockedFailure(new BackendError(401, "challenge_rejected", "expired")), false);
    assert.equal(gesture.isSdkPopupBlockedFailure(null), false);
    assert.equal(gesture.isSdkPopupBlockedFailure("promise"), false);
  });

  it("translateWalletError: the crash becomes WalletPopupBlockedError with the cause kept; everything else passes through", () => {
    const translated = gesture.translateWalletError(V8);
    assert.ok(gesture.isWalletPopupBlocked(translated));
    assert.equal(translated.code, gesture.WALLET_POPUP_BLOCKED);
    assert.equal(translated.message, gesture.WALLET_POPUP_BLOCKED_SENTENCE);
    assert.equal(translated.cause, V8);

    const rejected = Object.assign(new Error("User rejected the request"), { code: "USER_REJECTED" });
    assert.equal(gesture.translateWalletError(rejected), rejected, "same object, not a copy");
    assert.equal(gesture.translateWalletError(translated), translated, "idempotent");
    const fromString = gesture.translateWalletError("popup closed");
    assert.ok(fromString instanceof Error);
    assert.equal(fromString.message, "popup closed");
  });
});

describe("auth/wallet: sentences and freshness", () => {
  it("authErrorMessage: popup blocked, declined, cancelled, timed out, backend code, plain error", () => {
    assert.equal(wallet.authErrorMessage(new gesture.WalletPopupBlockedError()), gesture.WALLET_POPUP_BLOCKED_SENTENCE);
    assert.equal(
      wallet.authErrorMessage(Object.assign(new Error("User rejected the request"), { code: "USER_REJECTED" })),
      "The wallet request was declined before a signature was produced.",
    );
    assert.equal(wallet.authErrorMessage(new Error("Wallet operation canceled")), "The wallet request was declined before a signature was produced.");
    assert.equal(wallet.authErrorMessage(new Error("Wallet sign timed out")), "The wallet did not answer in time. Open it and try again.");
    assert.equal(wallet.authErrorMessage(new BackendError(401, "challenge_rejected", "challenge expired")), "The wallet challenge expired or was already used. Try again.");
    assert.equal(wallet.authErrorMessage(new BackendError(409, "wallet_already_linked", "x")), wallet.authCodeMessage("wallet_already_linked"));
    assert.equal(wallet.authErrorMessage(new Error("The wallet returned an empty signature.")), "The wallet returned an empty signature.");
    assert.equal(wallet.authErrorMessage(undefined), "Something went wrong. Try again.");
  });

  it("challengeIsFresh counts LOCAL age since receipt, so a wrong browser clock cannot make a challenge immortal", () => {
    const now = Date.parse("2026-09-11T10:00:00Z");
    const held = (ageMs, expiresAt) => ({
      receivedAt: now - ageMs,
      // Deliberately absurd server timestamps: they must not influence the answer.
      challenge: { challengeId: "c", message: "m", expiresAt: expiresAt ?? new Date(now + 5 * 60_000).toISOString() },
    });
    assert.equal(wallet.challengeIsFresh(held(0), now), true);
    assert.equal(wallet.challengeIsFresh(held(wallet.CHALLENGE_REUSE_MS - 1), now), true);
    assert.equal(wallet.challengeIsFresh(held(wallet.CHALLENGE_REUSE_MS), now), false);
    // A clock an hour slow would leave expiresAt far in the future; age still decides.
    assert.equal(wallet.challengeIsFresh(held(wallet.CHALLENGE_REUSE_MS + 1, new Date(now + 3_600_000).toISOString()), now), false);
    // A clock an hour fast would put expiresAt in the past; a just-received challenge is still usable.
    assert.equal(wallet.challengeIsFresh(held(0, new Date(now - 3_600_000).toISOString()), now), true);
    // An unparseable server timestamp cannot throw or poison the decision.
    assert.equal(wallet.challengeIsFresh(held(0, "not a date"), now), true);
    // Clock moved backwards after receipt → treated as stale rather than negative-age fresh.
    assert.equal(wallet.challengeIsFresh(held(-1), now), false);
    // The reuse window stays well inside the server's 5-minute TTL.
    assert.ok(wallet.CHALLENGE_REUSE_MS < 5 * 60_000, "reuse window must be shorter than the server TTL");
  });

  it("requireWalletPublicKey: returns the key or explains what to do", () => {
    assert.equal(wallet.requireWalletPublicKey("abcd"), "abcd");
    assert.throws(() => wallet.requireWalletPublicKey(undefined), /did not expose its public key/);
    assert.throws(() => wallet.requireWalletPublicKey(""), /Reconnect the wallet/);
  });

  it("linkWalletWithChallenge: the popup is the FIRST await, then the proof is posted verbatim", async () => {
    const order = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      order.push(`fetch ${new URL(String(url), "http://app.test").pathname}`);
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ wallet: { partyId: body.partyId }, identity: { id: "i" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const challenge = { challengeId: "ch-1", message: "TruthOracle link-wallet\nNonce: n", expiresAt: new Date(Date.now() + 300_000).toISOString() };
      const signMessage = async (message, partyId) => {
        order.push(`sign ${partyId}`);
        assert.equal(message, challenge.message, "signed verbatim");
        return "sig";
      };
      const result = await wallet.linkWalletWithChallenge(challenge, { partyId: "p::1220aa", publicKey: "pk", signMessage, label: "Ledger" });
      assert.deepEqual(order, ["sign p::1220aa", "fetch /__backend/api/v1/wallets/link"]);
      assert.equal(result.wallet.partyId, "p::1220aa");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("linkWalletWithChallenge posts exactly the proof the wallet produced", async () => {
    const realFetch = globalThis.fetch;
    let posted = null;
    globalThis.fetch = async (url, init) => {
      posted = { path: new URL(String(url), "http://app.test").pathname, body: JSON.parse(init.body), method: init.method };
      return new Response(JSON.stringify({ wallet: { partyId: "p::1220aa" } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const challenge = { challengeId: "ch-7", message: "TruthOracle link-wallet\nNonce: n7", expiresAt: new Date(Date.now() + 300_000).toISOString() };
      await wallet.linkWalletWithChallenge(challenge, {
        partyId: "p::1220aa",
        publicKey: "cHVibGljLWtleQ==",
        signMessage: async () => "c2lnbmF0dXJl",
        label: "Ledger Nano",
      });
      assert.equal(posted.method, "POST");
      assert.equal(posted.path, "/__backend/api/v1/wallets/link");
      assert.deepEqual(posted.body, {
        challengeId: "ch-7",
        partyId: "p::1220aa",
        publicKey: "cHVibGljLWtleQ==",
        signature: "c2lnbmF0dXJl",
        kind: "cantor8",
        label: "Ledger Nano",
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("linkWallet (no prefetched challenge) fetches the challenge first, then signs it", async () => {
    const order = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url), "http://app.test").pathname;
      order.push(`fetch ${path}`);
      if (path.endsWith("/wallets/link-challenge")) {
        assert.deepEqual(JSON.parse(init.body), { partyId: "p::1220bb" });
        return new Response(
          JSON.stringify({ challengeId: "ch-8", message: "msg-8", expiresAt: new Date(Date.now() + 300_000).toISOString() }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ wallet: { partyId: "p::1220bb" } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const signed = [];
      await wallet.linkWallet({
        partyId: "p::1220bb",
        publicKey: "pk",
        signMessage: async (message) => {
          order.push("sign");
          signed.push(message);
          return "sig";
        },
      });
      assert.deepEqual(order, ["fetch /__backend/api/v1/wallets/link-challenge", "sign", "fetch /__backend/api/v1/wallets/link"]);
      assert.deepEqual(signed, ["msg-8"], "the server's message is signed verbatim");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("linkWalletWithChallenge: an empty signature never reaches the server; a missing key fails before the popup", async () => {
    let fetched = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetched += 1;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const challenge = { challengeId: "ch", message: "m", expiresAt: new Date(Date.now() + 300_000).toISOString() };
      await assert.rejects(
        wallet.linkWalletWithChallenge(challenge, { partyId: "p", publicKey: "pk", signMessage: async () => "" }),
        /empty signature/,
      );
      let popups = 0;
      await assert.rejects(
        wallet.linkWalletWithChallenge(challenge, {
          partyId: "p",
          publicKey: undefined,
          signMessage: async () => {
            popups += 1;
            return "sig";
          },
        }),
        /public key/,
      );
      assert.equal(popups, 0, "no popup without a key");
      assert.equal(fetched, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("adminSession: operator sign-in", () => {
  it("a prefetched nonce is signed BEFORE any request, so the click's popup allowance is intact", async () => {
    const order = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url), "http://app.test").pathname;
      order.push(`fetch ${path}`);
      if (path === "/api/admin/session") {
        return new Response(JSON.stringify({ configured: true, authenticated: true, partyId: "op::1220aa", expiresAt: Date.now() + 3_600_000 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const session = await admin.signInAsAdmin({
        partyId: "op::1220aa",
        nonce: { nonce: "n-1", expiresAt: Date.now() + 300_000, receivedAt: Date.now() },
        signMessage: async (message) => {
          order.push(`sign ${message}`);
          return "sig";
        },
      });
      assert.deepEqual(order, ["sign n-1", "fetch /api/admin/session"], "no nonce fetch in front of the popup");
      assert.equal(session.authenticated, true);
      assert.equal(session.partyId, "op::1220aa");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("a stale prefetched nonce is replaced before signing rather than signed blind", async () => {
    const order = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = new URL(String(url), "http://app.test").pathname;
      order.push(`fetch ${path}`);
      if (path === "/api/admin/nonce") {
        return new Response(JSON.stringify({ nonce: "n-fresh", expiresAt: Date.now() + 300_000 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ configured: true, authenticated: true, partyId: "op::1220aa", expiresAt: Date.now() + 3_600_000 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      await admin.signInAsAdmin({
        partyId: "op::1220aa",
        nonce: { nonce: "n-old", expiresAt: Date.now() + 300_000, receivedAt: Date.now() - admin.NONCE_REUSE_MS - 1 },
        signMessage: async (message) => {
          order.push(`sign ${message}`);
          return "sig";
        },
      });
      assert.deepEqual(order, ["fetch /api/admin/nonce", "sign n-fresh", "fetch /api/admin/session"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("adminSession: operator nonce freshness", () => {
  it("adminNonceIsFresh counts local age since receipt, ignoring the server's expiresAt", () => {
    const now = 1_000_000_000_000;
    const held = (ageMs, expiresAt) => ({ nonce: "n", expiresAt: expiresAt ?? now + 5 * 60_000, receivedAt: now - ageMs });
    assert.equal(admin.adminNonceIsFresh(null, now), false);
    assert.equal(admin.adminNonceIsFresh(held(0), now), true);
    assert.equal(admin.adminNonceIsFresh(held(admin.NONCE_REUSE_MS - 1), now), true);
    assert.equal(admin.adminNonceIsFresh(held(admin.NONCE_REUSE_MS), now), false);
    // Server timestamps in the far past or future do not change the answer.
    assert.equal(admin.adminNonceIsFresh(held(0, now - 3_600_000), now), true);
    assert.equal(admin.adminNonceIsFresh(held(admin.NONCE_REUSE_MS + 1, now + 3_600_000), now), false);
    assert.equal(admin.adminNonceIsFresh(held(-1), now), false);
    assert.ok(admin.NONCE_REUSE_MS < 5 * 60_000, "reuse window must be shorter than the server TTL");
  });
});

// ─── The real SDK bundle under a blocked popup ─────────────────────────────────────

const SDK_URL = new URL("../node_modules/@cantor8/wallet-connect-sdk/dist/index.esm.js", import.meta.url);

/** Install the minimum DOM the bundle touches; `open` decides what window.open returns. */
function installBrowserGlobals(open) {
  const listeners = new Map();
  const win = {
    open,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    dispatchEvent: () => true,
    setInterval: (...a) => setInterval(...a),
    clearInterval: (...a) => clearInterval(...a),
    setTimeout: (...a) => setTimeout(...a),
    clearTimeout: (...a) => clearTimeout(...a),
    location: { origin: "http://localhost", href: "http://localhost/", ancestorOrigins: undefined },
  };
  win.parent = win; // top-level window → the popup transport, as in the browser
  win.self = win;
  win.window = win;
  globalThis.window = win;
  globalThis.location = win.location;
  globalThis.document = { title: "t", referrer: "" };
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
  return win;
}

/** Settle or report a hang — a wedged transport never settles. */
function settle(promise, ms = 800) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ state: "pending" }), ms);
  });
  return Promise.race([
    promise.then(
      (value) => ({ state: "resolved", value }),
      (error) => ({ state: "rejected", error }),
    ),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

describe("@cantor8/wallet-connect-sdk under a blocked popup (real bundle, Node)", () => {
  let C8WalletProvider;
  let openImpl = () => null;
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  let runnerListeners = [];

  before(async () => {
    installBrowserGlobals((...args) => openImpl(...args));
    // When the popup is blocked the SDK rejects a deferred nobody holds — an orphaned
    // rejection that is part of the behaviour under test, not a failure. node:test
    // fails the running test on any unhandled rejection, so its listener is swapped for
    // a recorder for the duration of this suite and restored afterwards.
    runnerListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", onUnhandled);
    ({ C8WalletProvider } = await import(SDK_URL.href));
  });

  after(() => {
    process.removeListener("unhandledRejection", onUnhandled);
    for (const listener of runnerListeners) process.on("unhandledRejection", listener);
  });

  afterEach(() => {
    openImpl = () => null;
    unhandled.length = 0;
  });

  const opts = { dappName: "TruthOracle test", dappUrl: "http://localhost", network: "devnet" };
  const party = "party::1220" + "ab".repeat(32);

  it("signMessage() and connect() fail when window.open returns null, and the failure is recognised as popup-blocked", async () => {
    const provider = new C8WalletProvider(opts);
    const signed = await settle(provider.signMessage("hello", party));
    assert.equal(signed.state, "rejected");
    assert.equal(gesture.isSdkPopupBlockedFailure(signed.error), true, `unrecognised: ${signed.error?.message}`);
    assert.ok(gesture.isWalletPopupBlocked(gesture.translateWalletError(signed.error)));

    const connected = await settle(new C8WalletProvider(opts).connect());
    assert.equal(connected.state, "rejected");
    assert.ok(gesture.isWalletPopupBlocked(gesture.translateWalletError(connected.error)));
    await new Promise((r) => setTimeout(r, 0));
    // The orphaned rejection carries the SDK's own words for the same event.
    assert.ok(unhandled.some((e) => /blocked the popup/i.test(e?.message ?? "")), "SDK's orphaned POPUP_BLOCKED rejection");
  });

  it("after a blocked popup the same provider hangs on the next call; disconnect() resets it so the next click opens a popup", async () => {
    const provider = new C8WalletProvider(opts);
    const first = await settle(provider.signMessage("hello", party));
    assert.equal(first.state, "rejected");

    // Wedged: the transport keeps popup === null and posts into nothing.
    const opened = [];
    openImpl = (url) => {
      opened.push(String(url));
      return { closed: false, focus() {}, close() {}, postMessage() {} };
    };
    const wedged = await settle(provider.signMessage("hello", party), 500);
    assert.equal(wedged.state, "pending", "second call on the wedged transport never settles");
    assert.deepEqual(opened, [], "and never even tries to open a popup");

    // Cantor8WalletContext.resetAfterBlockedPopup does exactly this.
    await provider.disconnect();

    const again = await settle(provider.signMessage("hello", party), 300);
    assert.equal(opened.length, 1, "a popup is opened again");
    assert.match(opened[0], /\/embedded\/confirmSignMessage/);
    assert.equal(again.state, "pending", "pending on the handshake with the (stubbed) popup — no TypeError");
    // Tear the transport down so its handshake timers do not keep the process alive.
    await provider.disconnect();
  });
});
