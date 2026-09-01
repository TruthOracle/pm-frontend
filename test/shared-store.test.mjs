import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  acquireLock,
  claimOnce,
  hitRateLimit,
  resetSharedStoreForTests,
  sharedStoreConfigured,
} from "../api/_lib/sharedStore.mjs";

const realFetch = globalThis.fetch;

/** Minimal Upstash pipeline emulator: SET NX PX, INCR, PEXPIRE, DEL over a Map. */
function fakeRedis() {
  const data = new Map(); // key -> { value, expiresAt }
  const alive = (key) => {
    const entry = data.get(key);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      data.delete(key);
      return null;
    }
    return entry;
  };
  const run = ([cmd, key, ...rest]) => {
    switch (cmd) {
      case "SET": {
        if (rest.includes("NX") && alive(key)) return null;
        const px = rest.indexOf("PX");
        data.set(key, {
          value: rest[0],
          expiresAt: px >= 0 ? Date.now() + Number(rest[px + 1]) : 0,
        });
        return "OK";
      }
      case "INCR": {
        const entry = alive(key) ?? { value: "0", expiresAt: 0 };
        entry.value = String(Number(entry.value) + 1);
        data.set(key, entry);
        return Number(entry.value);
      }
      case "PEXPIRE": {
        const entry = alive(key);
        if (!entry) return 0;
        entry.expiresAt = Date.now() + Number(rest[0]);
        return 1;
      }
      case "DEL":
        return alive(key) ? (data.delete(key), 1) : 0;
      default:
        return { error: `unsupported command ${cmd}` };
    }
  };
  return {
    data,
    fetch: async (_url, { body }) =>
      new Response(JSON.stringify(JSON.parse(body).map((cmd) => ({ result: run(cmd) })))),
  };
}

function configureStore() {
  process.env.KV_REST_API_URL = "https://fake-store.example";
  process.env.KV_REST_API_TOKEN = "test-token";
}

function unconfigureStore() {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

beforeEach(() => {
  resetSharedStoreForTests();
  unconfigureStore();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  unconfigureStore();
});

describe("shared store: in-memory fallback (no store configured)", () => {
  it("reports unconfigured", () => {
    assert.equal(sharedStoreConfigured(), false);
  });

  it("claims a key exactly once", async () => {
    assert.deepEqual(await claimOnce("k1", 60_000), { claimed: true, shared: false });
    assert.deepEqual(await claimOnce("k1", 60_000), { claimed: false, shared: false });
    assert.equal((await claimOnce("k2", 60_000)).claimed, true);
  });

  it("rate-limits past the max", async () => {
    for (let i = 1; i <= 3; i++) {
      assert.equal((await hitRateLimit("r1", 60_000, 3)).limited, false, `hit ${i}`);
    }
    assert.equal((await hitRateLimit("r1", 60_000, 3)).limited, true);
  });

  it("locks exclusively and releases", async () => {
    const first = await acquireLock("l1", 60_000);
    assert.equal(first.acquired, true);
    assert.equal((await acquireLock("l1", 60_000)).acquired, false);
    await first.release();
    assert.equal((await acquireLock("l1", 60_000)).acquired, true);
  });
});

describe("shared store: Upstash-compatible backend", () => {
  it("enforces single use across instances (memory cleared = other instance)", async () => {
    configureStore();
    globalThis.fetch = fakeRedis().fetch;
    assert.deepEqual(await claimOnce("k1", 60_000), { claimed: true, shared: true });
    // Another instance has no memory of the claim; only the store can reject it.
    resetSharedStoreForTests();
    assert.deepEqual(await claimOnce("k1", 60_000), { claimed: false, shared: true });
  });

  it("counts rate-limit hits across instances", async () => {
    configureStore();
    globalThis.fetch = fakeRedis().fetch;
    assert.equal((await hitRateLimit("r1", 60_000, 2)).limited, false);
    resetSharedStoreForTests(); // simulate a different instance
    assert.equal((await hitRateLimit("r1", 60_000, 2)).limited, false);
    resetSharedStoreForTests();
    const third = await hitRateLimit("r1", 60_000, 2);
    assert.equal(third.limited, true);
    assert.equal(third.count, 3);
  });

  it("excludes lock holders across instances and DELs on release", async () => {
    configureStore();
    const redis = fakeRedis();
    globalThis.fetch = redis.fetch;
    const first = await acquireLock("l1", 60_000);
    assert.equal(first.acquired, true);
    resetSharedStoreForTests();
    assert.equal((await acquireLock("l1", 60_000)).acquired, false);
    await first.release();
    assert.equal(redis.data.has("truthoracle:l1"), false);
    resetSharedStoreForTests();
    assert.equal((await acquireLock("l1", 60_000)).acquired, true);
  });

  it("degrades to per-instance behaviour when the store errors", async () => {
    configureStore();
    globalThis.fetch = async () => new Response("boom", { status: 500 });
    const claim = await claimOnce("k1", 60_000);
    assert.deepEqual(claim, { claimed: true, shared: false });
    // The in-memory guard still rejects the same-instance replay.
    assert.equal((await claimOnce("k1", 60_000)).claimed, false);
    const rate = await hitRateLimit("r1", 60_000, 1);
    assert.equal(rate.limited, false);
    assert.equal((await hitRateLimit("r1", 60_000, 1)).limited, true);
    assert.equal((await acquireLock("l1", 60_000)).acquired, true);
  });
});
