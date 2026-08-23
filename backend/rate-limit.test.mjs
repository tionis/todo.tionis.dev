import assert from "node:assert/strict";
import test from "node:test";
import { createFixedWindowRateLimiter } from "./rate-limit.mjs";

test("bounds requests per key and resets after the window", () => {
  const allow = createFixedWindowRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(allow("client", 0), true);
  assert.equal(allow("client", 1), true);
  assert.equal(allow("client", 2), false);
  assert.equal(allow("other", 2), true);
  assert.equal(allow("client", 1000), true);
});
