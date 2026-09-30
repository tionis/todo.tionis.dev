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

test("persistent limiter keeps its counters across database reopen", async () => {
  const { default: fs } = await import("node:fs/promises");
  const { default: os } = await import("node:os");
  const { default: path } = await import("node:path");
  const { openDatabase } = await import("./database.mjs");
  const { createPersistentRateLimiter } = await import("./rate-limit.mjs");
  const now = Date.now();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-limit-"));
  try {
    let database = openDatabase(directory);
    let allow = createPersistentRateLimiter(database, { name: "login", limit: 2, windowMs: 60_000 });
    assert.equal(allow("client", now), true);
    assert.equal(allow("client", now + 1), true);
    assert.equal(allow("client", now + 2), false);
    database.close();

    database = openDatabase(directory);
    allow = createPersistentRateLimiter(database, { name: "login", limit: 2, windowMs: 60_000 });
    assert.equal(allow("client", now + 3), false);
    assert.equal(allow("other", now + 3), true);
    assert.equal(allow("client", now + 60_000), true);
    database.close();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
