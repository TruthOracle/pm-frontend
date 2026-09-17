import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { allowedPath } from "../api/proxy/c8backend.mjs";

describe("c8backend proxy path allowlist", () => {
  it("allows exactly the read endpoints the frontend uses", () => {
    for (const path of [
      "healthz",
      "api/balance",
      "api/holdings",
      "api/holding-buckets/status",
      "api/command/abc-123/status",
      "api/transfer/status",
      "api/transfer/history",
    ]) {
      assert.equal(allowedPath(path), true, `should be allowed: ${path}`);
    }
  });

  it("rejects everything else, including traversal and decoration", () => {
    for (const path of [
      "",
      "api",
      "api/balance/extra",
      "api/holdings/extra",
      "api/holding-buckets",
      "api/transfer",
      "api/command//status",
      "api/command/x/status/extra",
      "api/admin/anything",
      "API/BALANCE",
      "api/balance/../transfer",
    ]) {
      assert.equal(allowedPath(path), false, `should be rejected: ${path}`);
    }
  });
});

import { MAINNET_BACKENDS, orderTargets } from "../api/proxy/c8backend.mjs";

describe("c8backend proxy mainnet backend selection", () => {
  it("knows one wallet-backend per mainnet validator", () => {
    const hosts = MAINNET_BACKENDS.map((u) => new URL(u).host);
    assert.deepEqual(hosts, [
      "wallet-backend.main.digik.cantor8.tech",
      "wallet-backend.main.zkpc.cantor8.tech",
      "wallet-backend.main.cache.cantor8.tech",
    ]);
  });

  it("tries the backend that last accepted the token first, then the others in order", () => {
    const [digik, zkpc, cache] = MAINNET_BACKENDS;
    assert.deepEqual(orderTargets(MAINNET_BACKENDS, zkpc), [zkpc, digik, cache]);
    assert.deepEqual(orderTargets(MAINNET_BACKENDS, null), [digik, zkpc, cache]);
    assert.deepEqual(orderTargets(MAINNET_BACKENDS, "https://elsewhere.example"), [digik, zkpc, cache]);
  });
});
