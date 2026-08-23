import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeReturnTo,
  oidcTransactionHash,
  prepareOidcTransactionStorage,
  verifiedIdentityClaims,
} from "./auth.mjs";
import { openDatabase } from "./database.mjs";

test("normalizes return paths without permitting authority changes", () => {
  const origin = new URL("https://todo.example");
  assert.equal(normalizeReturnTo("/list/groceries?view=open#top", origin), "/list/groceries?view=open#top");
  assert.equal(normalizeReturnTo("//evil.example/", origin), "/");
  assert.equal(normalizeReturnTo("/\\evil.example/", origin), "/");
  assert.equal(normalizeReturnTo("https://evil.example/", origin), "/");
});

test("binds OIDC state to a browser secret", () => {
  assert.notEqual(oidcTransactionHash("state", "browser-a"), oidcTransactionHash("state", "browser-b"));
  assert.equal(oidcTransactionHash("state", "browser-a"), oidcTransactionHash("state", "browser-a"));
});

test("uses email claims only when the provider marks them verified", () => {
  assert.equal(verifiedIdentityClaims({ email: "safe@example.com", email_verified: true }).email, "safe@example.com");
  assert.equal(verifiedIdentityClaims({ email: "unsafe@example.com", email_verified: false }).email, undefined);
  assert.equal(verifiedIdentityClaims({ email: "unknown@example.com" }).email, undefined);
});

test("reclaims expired OIDC transactions during process uptime", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-auth-"));
  const database = openDatabase(directory);
  try {
    database.prepare("INSERT INTO oidc_states VALUES (?, ?, ?, ?, ?)").run("expired", "verifier", "nonce", "/", 10);
    database.prepare("INSERT INTO oidc_states VALUES (?, ?, ?, ?, ?)").run("active", "verifier", "nonce", "/", 30);
    prepareOidcTransactionStorage(database, 20);
    assert.deepEqual(database.prepare("SELECT state_hash FROM oidc_states ORDER BY state_hash").all(), [{ state_hash: "active" }]);
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
