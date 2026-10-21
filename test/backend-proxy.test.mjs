/**
 * Tests for api/proxy/backend.mjs — the same-origin relay to the accounts backend
 * (truthoracle-backend/docs/ARCHITECTURE.md §4.1).
 *
 * Plain `node --test`, no network: the upstream is a stubbed globalThis.fetch and the
 * request/response objects are minimal emulations of what Vercel (and the `vite dev`
 * middleware in api/proxy/_devProxy.mjs) hand the handler.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Readable } from "node:stream";

import handler, {
  MAX_BODY_BYTES,
  MAX_UPLOAD_BODY_BYTES,
  allowedPath,
  bodyLimitFor,
  backendTarget,
  buildForwardHeaders,
  config,
  filterCookies,
  stripCookieDomain,
  trustPlatformHeaders,
  upstreamSetCookies,
} from "../api/proxy/backend.mjs";

const realFetch = globalThis.fetch;
const ENV = ["BACKEND_URL", "BACKEND_PROXY_SECRET", "VERCEL"];
const saved = {};

beforeEach(() => {
  for (const key of ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** What _devProxy.mjs / the Vercel rewrite hand the handler: query.path plus the URL. */
function request({ method = "GET", path = "api/v1/me", query = "", headers = {}, body } = {}) {
  const stream = body === undefined ? Readable.from([]) : Readable.from([Buffer.from(body)]);
  return Object.assign(stream, {
    method,
    url: `/__backend/${path}${query ? `?${query}` : ""}`,
    query: { path },
    headers: { host: "app.example.com", ...headers },
    socket: { remoteAddress: "127.0.0.1", encrypted: false },
  });
}

function response() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    body: "",
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk === undefined ? "" : Buffer.from(chunk).toString("utf8");
    },
  };
}

/**
 * A fetch Response stand-in with only what the handler touches. A plain Headers (no
 * "response" guard) so multiple Set-Cookie values can be appended like a real upstream.
 */
function upstream({ status = 200, headers = [], body = "" } = {}) {
  const h = new Headers();
  for (const [name, value] of headers) h.append(name, value);
  return { status, headers: h, arrayBuffer: async () => Buffer.from(body) };
}

/** Records every call; `reply` is a factory (fresh object per call) or an Error to throw. */
function stubFetch(reply) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (reply instanceof Error) throw reply;
    return reply();
  };
  return calls;
}

describe("backend proxy: path allowlist", () => {
  it("forwards api/v1/**, health and health/ready", () => {
    for (const path of [
      "api/v1/me",
      "api/v1/auth/session",
      "api/v1/auth/telegram/oidc/callback",
      "api/v1/in-app-wallet/payouts/00abc/settle",
      "health",
      "health/ready",
    ]) {
      assert.equal(allowedPath(path), true, `should be allowed: ${path}`);
    }
  });

  it("rejects everything else, including dot segments and decoration", () => {
    for (const path of [
      "",
      "api",
      "api/v1",
      "api/docs",
      "api/v2/me",
      "xapi/v1/me",
      "API/V1/me",
      "healthz",
      "health/live",
      "health/ready/extra",
      "api/v1/../docs",
      "api/v1/./me",
      undefined,
    ]) {
      assert.equal(allowedPath(path), false, `should be rejected: ${path}`);
    }
  });
});

describe("backend proxy: cookie filtering", () => {
  it("keeps only to_session and to_oidc, values byte-for-byte", () => {
    assert.equal(
      filterCookies("to_admin=adm.in; to_session=abc.def=ghi; foo=bar; to_oidc=xyz"),
      "to_session=abc.def=ghi; to_oidc=xyz",
    );
  });

  it("returns an empty string when nothing forwardable is present", () => {
    assert.equal(filterCookies(undefined), "");
    assert.equal(filterCookies(""), "");
    assert.equal(filterCookies("to_admin=x; other=y"), "");
    assert.equal(filterCookies("to_session=; to_oidc="), "");
  });

  it("matches cookie names exactly", () => {
    assert.equal(filterCookies("to_session2=x; xto_session=y; TO_SESSION=z"), "");
  });

  it("tolerates sloppy spacing", () => {
    assert.equal(filterCookies(" to_session = abc ;to_oidc=d"), "to_session=abc; to_oidc=d");
  });
});

describe("backend proxy: Set-Cookie domain stripping", () => {
  it("removes a Domain attribute wherever it sits, case-insensitively", () => {
    assert.equal(
      stripCookieDomain("to_session=abc; Path=/; Domain=backend.railway.app; HttpOnly; Secure; SameSite=Lax"),
      "to_session=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    assert.equal(stripCookieDomain("to_oidc=x; domain=.example.com; Path=/"), "to_oidc=x; Path=/");
    assert.equal(stripCookieDomain("to_oidc=; Path=/; Max-Age=0; DOMAIN=example.com"), "to_oidc=; Path=/; Max-Age=0");
  });

  it("leaves a cookie without Domain untouched", () => {
    assert.equal(stripCookieDomain("to_oidc=x; Max-Age=600; HttpOnly"), "to_oidc=x; Max-Age=600; HttpOnly");
  });

  it("never touches the name=value pair itself", () => {
    assert.equal(stripCookieDomain("Domain=oops; Path=/"), "Domain=oops; Path=/");
  });
});

describe("backend proxy: forwarded request headers", () => {
  const full = {
    host: "app.example.com",
    connection: "keep-alive",
    "content-length": "12",
    "content-type": "application/json",
    accept: "application/json",
    origin: "https://app.example.com",
    referer: "https://app.example.com/account",
    "x-requested-with": "truthoracle",
    cookie: "to_admin=adm; to_session=sess; other=1; to_oidc=oidc",
    authorization: "Bearer leak",
    "x-admin-instance": "inst",
    "x-forwarded-for": "6.6.6.6, 10.0.0.1",
    "x-forwarded-host": "app.example.com, internal",
    "x-forwarded-proto": "https",
    "x-real-ip": "203.0.113.5",
    "x-custom": "nope",
  };
  const req = (headers, socket = { remoteAddress: "127.0.0.1" }) => ({ headers, socket });

  it("forwards the KYC vendor's webhook signature headers (x-payload-digest pair) untouched", () => {
    delete process.env.BACKEND_PROXY_SECRET;
    delete process.env.VERCEL;
    const headers = buildForwardHeaders(
      req({
        host: "app.example.com",
        "content-type": "application/json",
        "x-payload-digest": "abc123",
        "x-payload-digest-alg": "HMAC_SHA256_HEX",
        "x-other-signature": "must not pass",
      }),
    );
    assert.equal(headers["x-payload-digest"], "abc123");
    assert.equal(headers["x-payload-digest-alg"], "HMAC_SHA256_HEX");
    assert.equal(headers["x-other-signature"], undefined);
  });

  it("forwards the card ramp's idempotency-key so a retried order POST reaches the backend with the same key", () => {
    delete process.env.BACKEND_PROXY_SECRET;
    delete process.env.VERCEL;
    const headers = buildForwardHeaders(
      req({ host: "app.example.com", "content-type": "application/json", "idempotency-key": "web-123e4567" }),
    );
    assert.equal(headers["idempotency-key"], "web-123e4567");
  });

  it("is an allow-list built from scratch, never a copy of req.headers (on Vercel)", () => {
    process.env.BACKEND_PROXY_SECRET = "s3cret";
    process.env.VERCEL = "1";
    assert.equal(trustPlatformHeaders(), true);
    assert.deepEqual(buildForwardHeaders(req(full)), {
      "content-type": "application/json",
      accept: "application/json",
      origin: "https://app.example.com",
      referer: "https://app.example.com/account",
      "x-requested-with": "truthoracle",
      cookie: "to_session=sess; to_oidc=oidc",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
      "x-real-ip": "203.0.113.5",
      "x-truthoracle-proxy": "s3cret",
    });
  });

  it("omits the proxy secret header when BACKEND_PROXY_SECRET is unset", () => {
    const headers = buildForwardHeaders(req(full));
    assert.equal("x-truthoracle-proxy" in headers, false);
    assert.equal("authorization" in headers, false);
  });

  it("ignores client x-real-ip / x-forwarded-host / x-forwarded-proto off Vercel", () => {
    process.env.BACKEND_PROXY_SECRET = "s3cret";
    delete process.env.VERCEL;
    assert.equal(trustPlatformHeaders(), false);
    const headers = buildForwardHeaders(req(full, { remoteAddress: "10.1.2.3", encrypted: false }));
    assert.equal(headers["x-real-ip"], "10.1.2.3", "socket address, not the client's x-real-ip");
    assert.equal(headers["x-forwarded-host"], "app.example.com", "Host, not the client's x-forwarded-host");
    assert.equal(headers["x-forwarded-proto"], "http", "socket encryption, not the client's x-forwarded-proto");
    assert.equal(headers["x-truthoracle-proxy"], "s3cret");
    // VERCEL set to anything but "1" is still "not Vercel".
    process.env.VERCEL = "true";
    assert.equal(trustPlatformHeaders(), false);
  });

  it("never falls back to a client x-forwarded-for, even on Vercel", () => {
    process.env.VERCEL = "1";
    const headers = buildForwardHeaders(req({ host: "h", "x-forwarded-for": "6.6.6.6" }, { remoteAddress: "127.0.0.1" }));
    assert.equal(headers["x-real-ip"], "127.0.0.1");
  });

  it("derives host, proto and ip when no platform headers exist (vite dev)", () => {
    const headers = buildForwardHeaders(
      req({ host: "localhost:5173", accept: "*/*" }, { remoteAddress: "::1", encrypted: false }),
    );
    assert.equal(headers["x-forwarded-host"], "localhost:5173");
    assert.equal(headers["x-forwarded-proto"], "http");
    assert.equal(headers["x-real-ip"], "::1");
    assert.equal("cookie" in headers, false, "no Cookie header at all when none of ours is present");
  });

  it("never trusts a client x-forwarded-proto that is not http/https", () => {
    process.env.VERCEL = "1";
    const headers = buildForwardHeaders(req({ host: "h", "x-forwarded-proto": "gopher" }, { encrypted: true }));
    assert.equal(headers["x-forwarded-proto"], "https");
  });
});

describe("backend proxy: Set-Cookie relay helper", () => {
  it("uses getSetCookie when the runtime has it", () => {
    const h = new Headers();
    h.append("set-cookie", "a=1");
    h.append("set-cookie", "b=2");
    assert.deepEqual(upstreamSetCookies(h), ["a=1", "b=2"]);
  });

  it("falls back to the single joined value (and logs once) when getSetCookie is missing", () => {
    const errors = [];
    const realError = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    try {
      const legacy = { get: (name) => (name === "set-cookie" ? "to_session=x; Path=/" : null) };
      assert.deepEqual(upstreamSetCookies(legacy), ["to_session=x; Path=/"]);
      assert.deepEqual(upstreamSetCookies({ get: () => null }), []);
    } finally {
      console.error = realError;
    }
    assert.equal(errors.length, 1, "warns exactly once");
    assert.match(errors[0], /getSetCookie/);
  });
});

describe("backend proxy: handler", () => {
  it("answers OPTIONS with 204 before anything else", async () => {
    const res = response();
    await handler(request({ method: "OPTIONS" }), res);
    assert.equal(res.statusCode, 204);
  });

  it("404s paths outside the allowlist even when configured, without calling upstream", async () => {
    process.env.BACKEND_URL = "https://backend.example";
    const calls = stubFetch(() => upstream());
    for (const path of ["api/docs", "api/v1/../docs", "", "health/live"]) {
      const res = response();
      await handler(request({ path }), res);
      assert.equal(res.statusCode, 404, `path should 404: ${path}`);
      assert.deepEqual(JSON.parse(res.body), { error: "path not proxied" });
    }
    assert.equal(calls.length, 0);
  });

  it("503s backend_unconfigured without BACKEND_URL, or with a non-absolute one", async () => {
    const calls = stubFetch(() => upstream());
    for (const value of [undefined, "", "   ", "backend.example", "localhost:8091"]) {
      if (value === undefined) delete process.env.BACKEND_URL;
      else process.env.BACKEND_URL = value;
      assert.equal(backendTarget(), "");
      const res = response();
      await handler(request({ path: "health" }), res);
      assert.equal(res.statusCode, 503, `BACKEND_URL=${JSON.stringify(value)}`);
      const body = JSON.parse(res.body);
      assert.equal(body.error, "backend_unconfigured");
      assert.equal(typeof body.message, "string");
      assert.equal(res.headers["cache-control"], "no-store");
    }
    assert.equal(calls.length, 0);
  });

  it("normalises a doubled slash instead of refusing it (proxyPath drops empty segments)", async () => {
    process.env.BACKEND_URL = "https://backend.example";
    const calls = stubFetch(() => upstream({ body: "{}" }));
    const res = response();
    await handler(request({ path: "api/v1//me" }), res);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://backend.example/api/v1/me");
    assert.equal(res.statusCode, 200);
  });

  it("413s a body over the cap before calling upstream", async () => {
    process.env.BACKEND_URL = "https://backend.example";
    const calls = stubFetch(() => upstream({ body: "{}" }));
    const res = response();
    await handler(
      request({ method: "POST", path: "api/v1/auth/google", body: "x".repeat(MAX_BODY_BYTES + 1) }),
      res,
    );
    assert.equal(res.statusCode, 413);
    assert.equal(JSON.parse(res.body).error, "body_too_large");
    assert.equal(calls.length, 0);
    // Exactly at the cap is fine.
    const ok = response();
    await handler(request({ method: "POST", path: "api/v1/auth/google", body: "x".repeat(MAX_BODY_BYTES) }), ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(calls.length, 1);
  });

  it("gives only the two admin file imports the 8 MB cap", async () => {
    assert.equal(MAX_UPLOAD_BODY_BYTES, 8 * 1024 * 1024);
    for (const path of [
      "api/v1/admin/ramp/bank-statements",
      "api/v1/admin/ramp/bank-statements/00000000-0000-4000-8000-000000000001/confirm",
      "api/v1/admin/compliance/screening-lists",
    ]) {
      assert.equal(bodyLimitFor(path), MAX_UPLOAD_BODY_BYTES, path);
    }
    for (const path of [
      "api/v1/admin/ramp/bank-statementsx",
      "api/v1/admin/ramp/bank-lines/x/classify",
      "api/v1/admin/compliance/screening-lists/x",
      "api/v1/admin/compliance/screening-hits",
      "api/v1/ramp/onramp",
      "api/v1/admin/ramp/bank-statements/../../tokens/mint",
    ]) {
      assert.equal(bodyLimitFor(path), MAX_BODY_BYTES, path);
    }

    process.env.BACKEND_URL = "https://backend.example";
    const calls = stubFetch(() => upstream({ body: "{}" }));
    // A statement just under the upload cap goes through; one byte over is 413 before upstream.
    const ok = response();
    await handler(request({ method: "POST", path: "api/v1/admin/ramp/bank-statements", body: "x".repeat(MAX_UPLOAD_BODY_BYTES) }), ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(calls.length, 1);
    const big = response();
    await handler(request({ method: "POST", path: "api/v1/admin/compliance/screening-lists", body: "x".repeat(MAX_UPLOAD_BODY_BYTES + 1) }), big);
    assert.equal(big.statusCode, 413);
    assert.match(JSON.parse(big.body).message, /8388608/);
    // Every other admin route keeps the small cap.
    const small = response();
    await handler(request({ method: "POST", path: "api/v1/admin/tokens/mint", body: "x".repeat(MAX_BODY_BYTES + 1) }), small);
    assert.equal(small.statusCode, 413);
    assert.equal(calls.length, 1);
  });

  it("forwards method, path, query, raw body and only the allow-listed headers", async () => {
    process.env.BACKEND_URL = "https://backend.example/";
    process.env.BACKEND_PROXY_SECRET = "s3cret";
    process.env.VERCEL = "1";
    const calls = stubFetch(() => upstream({ body: "{}" }));
    const body = '{"challengeId":"c1"}';
    const res = response();
    await handler(
      request({
        method: "POST",
        path: "api/v1/auth/wallet",
        query: "x=1&y=2",
        body,
        headers: {
          "content-type": "application/json",
          origin: "https://app.example.com",
          cookie: "to_admin=adm; to_session=sess",
          authorization: "Bearer leak",
          "x-admin-instance": "inst",
          "x-forwarded-for": "6.6.6.6",
          "x-forwarded-proto": "https",
          "x-real-ip": "203.0.113.5",
        },
      }),
      res,
    );
    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, "https://backend.example/api/v1/auth/wallet?x=1&y=2");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(Buffer.from(init.body).toString("utf8"), body);
    assert.deepEqual(init.headers, {
      "content-type": "application/json",
      origin: "https://app.example.com",
      cookie: "to_session=sess",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
      "x-real-ip": "203.0.113.5",
      "x-truthoracle-proxy": "s3cret",
    });
    assert.equal(res.statusCode, 200);
  });

  it("sends no body on GET", async () => {
    process.env.BACKEND_URL = "https://backend.example";
    const calls = stubFetch(() => upstream({ body: '{"authenticated":false}' }));
    const res = response();
    await handler(request({ path: "api/v1/auth/session" }), res);
    assert.equal(calls[0].init.body, undefined);
    assert.equal(res.body, '{"authenticated":false}');
  });

  it("relays status, body and headers; drops framing headers; strips cookie domains", async () => {
    process.env.BACKEND_URL = "https://backend.example";
    stubFetch(() =>
      upstream({
        status: 201,
        headers: [
          ["content-type", "application/json; charset=utf-8"],
          ["content-encoding", "gzip"],
          ["content-length", "999"],
          ["transfer-encoding", "chunked"],
          ["cache-control", "private, max-age=0"],
          ["x-request-id", "r1"],
          ["set-cookie", "to_session=abc; Path=/; Domain=backend.example; HttpOnly; Secure; SameSite=Lax"],
          ["set-cookie", "to_oidc=; Path=/; Max-Age=0; domain=backend.example"],
        ],
        body: '{"ok":true}',
      }),
    );
    const res = response();
    await handler(request({ method: "POST", path: "api/v1/auth/logout", body: "" }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body, '{"ok":true}');
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(res.headers["x-request-id"], "r1");
    assert.equal(res.headers["cache-control"], "private, max-age=0", "the backend's own cache-control wins");
    for (const dropped of ["content-encoding", "content-length", "transfer-encoding"]) {
      assert.equal(res.headers[dropped], undefined, `must drop ${dropped}`);
    }
    assert.deepEqual(res.headers["set-cookie"], [
      "to_session=abc; Path=/; HttpOnly; Secure; SameSite=Lax",
      "to_oidc=; Path=/; Max-Age=0",
    ]);
  });

  it("defaults cache-control to no-store and sets no Set-Cookie when the backend sends none", async () => {
    process.env.BACKEND_URL = "https://backend.example";
    stubFetch(() => upstream({ headers: [["content-type", "application/json"]], body: "{}" }));
    const res = response();
    await handler(request({ path: "api/v1/me" }), res);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["set-cookie"], undefined);
  });

  it("relays a redirect instead of following it (the OIDC hops)", async () => {
    process.env.BACKEND_URL = "https://backend.example";
    const calls = stubFetch(() => upstream({ status: 302, headers: [["location", "https://oauth.telegram.org/auth?x=1"]] }));
    const res = response();
    await handler(request({ path: "api/v1/auth/telegram/oidc/start", query: "mode=login" }), res);
    assert.equal(calls[0].url, "https://backend.example/api/v1/auth/telegram/oidc/start?mode=login");
    assert.equal(calls[0].init.redirect, "manual");
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "https://oauth.telegram.org/auth?x=1");
  });

  it("502s backend_unreachable when the backend cannot be reached", async () => {
    process.env.BACKEND_URL = "https://backend.example";
    stubFetch(new Error("connect ECONNREFUSED"));
    const res = response();
    await handler(request({ path: "health" }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).error, "backend_unreachable");
  });

  it("declares the Vercel maxDuration for long history walks", () => {
    assert.equal(config.maxDuration, 60);
  });
});
