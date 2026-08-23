import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function hashToken(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const database = new Database(path.join(dataDir, "metadata.sqlite"));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT,
      name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (issuer, subject)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS oidc_states (
      state_hash TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      nonce TEXT NOT NULL,
      return_to TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS oidc_states_expires_at ON oidc_states(expires_at);
    CREATE TABLE IF NOT EXISTS lists (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      permission TEXT NOT NULL,
      tags TEXT,
      hide_completed INTEGER NOT NULL DEFAULT 0,
      auto_sort_todos INTEGER NOT NULL DEFAULT 0,
      classifier_aggressiveness TEXT NOT NULL DEFAULT 'normal',
      classifier_reset_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS lists_owner_id ON lists(owner_id);
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      added_at TEXT NOT NULL,
      UNIQUE (list_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'pending',
      invited_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS invitations_email_status ON invitations(email, status);
    CREATE TABLE IF NOT EXISTS pins (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE (list_id, user_id)
    );
  `);

  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  database.prepare("DELETE FROM oidc_states WHERE expires_at <= ?").run(Date.now());
  return database;
}

export function getUserForSession(database, rawToken) {
  if (!rawToken) return null;
  return database.prepare(`
    SELECT users.id, users.email, users.name
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(rawToken), Date.now()) || null;
}

export function upsertOidcUser(database, issuer, claims) {
  const now = new Date().toISOString();
  const current = database.prepare(
    "SELECT id FROM users WHERE issuer = ? AND subject = ?"
  ).get(issuer, claims.sub);
  const id = current?.id || crypto.randomUUID();
  database.prepare(`
    INSERT INTO users (id, issuer, subject, email, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (issuer, subject) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      updated_at = excluded.updated_at
  `).run(id, issuer, claims.sub, claims.email || null, claims.name || claims.preferred_username || null, now, now);
  return database.prepare("SELECT id, email, name FROM users WHERE id = ?").get(id);
}
