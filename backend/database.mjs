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

function ensureColumn(database, table, definition) {
  const name = definition.split(/\s+/, 1)[0];
  if (!database.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
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
      email_verified INTEGER NOT NULL DEFAULT 0,
      name TEXT,
      username TEXT,
      scim_external_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
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
    CREATE TABLE IF NOT EXISTS directory_groups (
      id TEXT PRIMARY KEY,
      external_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS directory_group_members (
      group_id TEXT NOT NULL REFERENCES directory_groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS directory_group_members_user_id ON directory_group_members(user_id);
    CREATE TABLE IF NOT EXISTS list_group_grants (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES directory_groups(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      added_at TEXT NOT NULL,
      UNIQUE (list_id, group_id)
    );
    CREATE INDEX IF NOT EXISTS list_group_grants_group_id ON list_group_grants(group_id);
  `);

  ensureColumn(database, "users", "username TEXT");
  ensureColumn(database, "users", "scim_external_id TEXT");
  ensureColumn(database, "users", "active INTEGER NOT NULL DEFAULT 1");
  ensureColumn(database, "users", "email_verified INTEGER NOT NULL DEFAULT 0");
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_scim_external_id
      ON users(scim_external_id) WHERE scim_external_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_active_username
      ON users(username COLLATE NOCASE) WHERE active = 1 AND username IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS directory_groups_active_display_name
      ON directory_groups(display_name COLLATE NOCASE) WHERE active = 1;
  `);

  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  database.prepare("DELETE FROM oidc_states WHERE expires_at <= ?").run(Date.now());
  return database;
}

export function getUserForSession(database, rawToken) {
  if (!rawToken) return null;
  return database.prepare(`
    SELECT users.id, users.email, users.email_verified AS emailVerified, users.name, users.username
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.active = 1
  `).get(hashToken(rawToken), Date.now()) || null;
}

export function upsertOidcUser(database, issuer, claims) {
  const now = new Date().toISOString();
  const current = database.prepare(
    "SELECT id FROM users WHERE issuer = ? AND subject = ?"
  ).get(issuer, claims.sub);
  const id = current?.id || crypto.randomUUID();
  database.prepare(`
    INSERT INTO users (id, issuer, subject, email, email_verified, name, username, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (issuer, subject) DO UPDATE SET
      email = COALESCE(excluded.email, users.email),
      email_verified = CASE WHEN excluded.email IS NOT NULL THEN 1 ELSE users.email_verified END,
      name = COALESCE(excluded.name, users.name),
      username = COALESCE(excluded.username, users.username),
      updated_at = excluded.updated_at
  `).run(
    id,
    issuer,
    claims.sub,
    claims.email || null,
    claims.email ? 1 : 0,
    claims.name || null,
    claims.preferred_username || null,
    now,
    now,
  );
  return database.prepare("SELECT id, email, email_verified AS emailVerified, name, username, active FROM users WHERE id = ?").get(id);
}
