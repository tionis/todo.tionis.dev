import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { openDatabase } from "./database.mjs";

test("migrates pre-directory user databases without losing accounts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-database-"));
  const filename = path.join(directory, "metadata.sqlite");
  const legacy = new Database(filename);
  const now = new Date().toISOString();
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (issuer, subject)
    )
  `);
  legacy.prepare("INSERT INTO users VALUES ('user-1', 'issuer', 'subject', 'user@example.com', 'Legacy User', ?, ?)")
    .run(now, now);
  legacy.close();

  const database = openDatabase(directory);
  try {
    const columns = new Set(database.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
    assert.equal(columns.has("username"), true);
    assert.equal(columns.has("scim_external_id"), true);
    assert.equal(columns.has("active"), true);
    assert.equal(columns.has("email_verified"), true);
    assert.equal(database.prepare("SELECT name FROM users WHERE id = 'user-1'").get().name, "Legacy User");
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
