import assert from "node:assert/strict";
import test from "node:test";
import { mayUseOfflineFallback, scopedCacheKey } from "../shared/cache-policy.mjs";

test("authorization failures never use offline cached data", () => {
  assert.equal(mayUseOfflineFallback({ status: 401, code: "unauthorized" }), false);
  assert.equal(mayUseOfflineFallback({ status: 403, code: "forbidden" }), false);
  assert.equal(mayUseOfflineFallback({ status: 500, code: "server_error" }), false);
  assert.equal(mayUseOfflineFallback({ status: 503, code: "offline" }), true);
  assert.equal(mayUseOfflineFallback(new TypeError("network failed")), true);
});

test("persistent list and document keys are isolated by identity", () => {
  assert.notEqual(scopedCacheKey("list", "alice", "groceries"), scopedCacheKey("list", "bob", "groceries"));
  assert.notEqual(scopedCacheKey("document", "alice", "list-1"), scopedCacheKey("document", "bob", "list-1"));
});
