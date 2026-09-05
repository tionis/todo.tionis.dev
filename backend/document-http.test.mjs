import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as Automerge from "@automerge/automerge";
import WebSocket from "ws";
import { hashToken, openDatabase } from "./database.mjs";

function nextDocument(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = (bytes, binary) => {
      if (!binary) return;
      socket.off("message", onMessage);
      socket.off("error", reject);
      resolve(Automerge.load(new Uint8Array(bytes)));
    };
    socket.on("message", onMessage);
    socket.once("error", reject);
  });
}

test("HTTP and WebSocket preserve the document format through merge and classifier reset", { timeout: 15_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-http-"));
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const database = openDatabase(directory);
  database.prepare("INSERT INTO users (id, issuer, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("owner", "https://identity.example.test", "owner", "2026-01-01", "2026-01-01");
  database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken("invented-test-session"), "owner", Date.now() + 60_000);
  database.close();
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    env: {
      ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: directory,
      STATIC_DIR: directory, APP_ORIGIN: origin, PUBLIC_URL: origin,
      OIDC_ISSUER: "https://identity.example.test", OIDC_CLIENT_ID: "synthetic-client", SCIM_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let socket;
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => { throw new Error("Test backend exited before listening"); }),
    ]);
    const headers = { "Content-Type": "application/json", Origin: origin, Cookie: "smart_todos_session=invented-test-session" };
    const post = (route, value) => fetch(origin + route, { method: "POST", headers, body: JSON.stringify(value) });
    const created = await post("/api/lists", { id: "synthetic-list", name: "Synthetic list", slug: "synthetic-list" });
    assert.equal(created.status, 201);
    const read = await fetch(`${origin}/api/lists/synthetic-list`, { headers });
    assert.equal(read.status, 200);
    const initial = Automerge.load(Buffer.from((await read.json()).document, "base64"));
    socket = new WebSocket(`${origin.replace("http:", "ws:")}/sync?listId=synthetic-list`, { headers });
    const connectedDocument = nextDocument(socket);
    await once(socket, "open");
    assert.deepEqual((await connectedDocument).todos, {});
    const edited = Automerge.change(initial, (draft) => {
      draft.todos.item = { id: "item", text: "Invented grocery", done: false };
      draft.classifierHistory.sample = {
        id: "sample", text: "Invented grocery", normalizedText: "invented grocery", source: "checked",
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    });
    const mergedDocument = nextDocument(socket);
    const update = await post("/api/lists/synthetic-list/document", { document: Buffer.from(Automerge.save(edited)).toString("base64") });
    assert.equal(update.status, 200);
    assert.equal((await mergedDocument).todos.item.text, "Invented grocery");
    const resetDocument = nextDocument(socket);
    const reset = await post("/api/lists/synthetic-list/classifier/reset", { resetAt: "2026-01-02T00:00:00.000Z" });
    assert.equal(reset.status, 200);
    const result = await resetDocument;
    assert.deepEqual(result.classifierHistory, {});
    assert.equal(result.todos.item.text, "Invented grocery");
  } finally {
    socket?.terminate();
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
