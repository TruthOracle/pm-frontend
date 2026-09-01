import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { allowedPath } from "../api/proxy/c8backend.mjs";

describe("c8backend proxy path allowlist", () => {
  it("allows exactly the read endpoints the frontend uses", () => {
    for (const path of [
      "healthz",
      "api/balance",
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
