import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { hashToken, openDatabase } from "./database.mjs";

const ISSUER = "https://identity.example.test";

export async function freePort() {
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));
  return port;
}

export function addUser(database, id, { username = id, name = id, email = null, active = 1 } = {}) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO users (id, issuer, subject, email, name, username, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, ISSUER, id, email, name, username, active, now, now);
}

export function addSession(database, userId, token) {
  database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), userId, Date.now() + 3_600_000);
}

export function addGroup(database, id, displayName, memberIds = []) {
  const now = new Date().toISOString();
  database.prepare("INSERT INTO directory_groups (id, external_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, `ext-${id}`, displayName, now, now);
  for (const userId of memberIds) {
    database.prepare("INSERT INTO directory_group_members (group_id, user_id) VALUES (?, ?)").run(id, userId);
  }
}

/**
 * Starts the real backend against a fresh data directory. `seed(database)` runs before
 * the server opens the database. `staticDir` defaults to the data directory (no frontend).
 */
export async function startTestServer({ seed, staticDir, port, env = {} } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-server-"));
  const listenPort = port || await freePort();
  const origin = `http://127.0.0.1:${listenPort}`;
  const database = openDatabase(directory);
  seed?.(database);
  database.close();
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    env: {
      ...process.env, HOST: "127.0.0.1", PORT: String(listenPort), DATA_DIR: directory,
      STATIC_DIR: staticDir || directory, APP_ORIGIN: origin, PUBLIC_URL: origin,
      OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: "synthetic-client", SCIM_TOKEN: "", ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => { throw new Error("Test backend exited before listening"); }),
  ]);

  async function stop() {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }

  /** JSON request as `session` (a token from addSession, or none for an anonymous caller). */
  async function api(session, method, route, body, headers = {}) {
    const response = await fetch(origin + route, {
      method,
      headers: {
        Origin: origin,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(session ? { Cookie: `smart_todos_session=${session}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: response.status, json, headers: response.headers };
  }

  return { origin, port: listenPort, directory, stop, api };
}
