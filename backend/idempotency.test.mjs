import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "./database.mjs";
import { withIdempotency } from "./idempotency.mjs";

function fakeResponse() {
  const response = {
    statusCode: 200, headers: {}, body: undefined,
    writeHead(status, headers) { this.statusCode = status; Object.assign(this.headers, headers); },
    end(chunk) { this.body = chunk; },
  };
  return response;
}

test("a retried command with the same Idempotency-Key replays the first outcome", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-idempotency-"));
  const database = openDatabase(directory);
  try {
    const now = new Date().toISOString();
    database.prepare("INSERT INTO users (id, issuer, subject, active, created_at, updated_at) VALUES ('u', 'i', 's', 1, ?, ?)").run(now, now);
    const user = "u";
    const url = new URL("http://x/api/lists/1/members");
    const request = { method: "POST", headers: { "idempotency-key": "command-0001" } };

    const first = fakeResponse();
    assert.equal(withIdempotency(database, request, first, () => user, url), false);
    first.writeHead(201, {});
    first.end('{"id":"member-1"}');

    const retry = fakeResponse();
    assert.equal(withIdempotency(database, request, retry, () => user, url), true);
    assert.equal(retry.statusCode, 201);
    assert.equal(retry.body, '{"id":"member-1"}');
    assert.equal(retry.headers["Idempotency-Replayed"], "true");

    const reused = fakeResponse();
    const other = new URL("http://x/api/lists/2/members");
    assert.equal(withIdempotency(database, request, reused, () => user, other), true);
    assert.equal(reused.statusCode, 422);

    // Access failures are not recorded, so the command can succeed once permitted.
    const denied = { method: "POST", headers: { "idempotency-key": "command-0002" } };
    const attempt = fakeResponse();
    withIdempotency(database, denied, attempt, () => user, url);
    attempt.writeHead(403, {});
    attempt.end('{"error":"no"}');
    assert.equal(withIdempotency(database, denied, fakeResponse(), () => user, url), false);

    // Anonymous writers are scoped by address; a missing scope or malformed key is ignored.
    const anonymous = fakeResponse();
    assert.equal(withIdempotency(database, request, anonymous, () => "anon:203.0.113.9", url), false);
    anonymous.writeHead(200, {});
    anonymous.end("{}");
    assert.equal(withIdempotency(database, request, fakeResponse(), () => "anon:203.0.113.9", url), true);
    assert.equal(withIdempotency(database, request, fakeResponse(), () => "anon:198.51.100.1", url), false);
    assert.equal(withIdempotency(database, request, fakeResponse(), () => null, url), false);
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
