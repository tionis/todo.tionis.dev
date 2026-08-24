import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { generateServiceWorker } from "../scripts/generate-service-worker.mjs";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-pwa-"));
  const publicDir = path.join(root, "public");
  const outDir = path.join(root, "out");
  await fs.mkdir(publicDir);
  await fs.mkdir(outDir);
  await fs.copyFile(path.resolve("public/sw.js"), path.join(publicDir, "sw.js"));
  await fs.writeFile(path.join(outDir, "index.html"), '<script src="/_next/app.js"></script>');
  await fs.writeFile(path.join(outDir, "manifest.json"), '{"name":"Smart Todos"}');
  return { root, publicDir, outDir };
}

test("generates a release-specific service worker", async () => {
  const value = await fixture();
  try {
    const firstRevision = await generateServiceWorker({ ...value, apiBase: "https://api.example/" });
    const firstWorker = await fs.readFile(path.join(value.outDir, "sw.js"), "utf8");
    assert.match(firstWorker, new RegExp(`CACHE_VERSION = '${firstRevision}'`));
    assert.match(firstWorker, /API_BASE = "https:\/\/api\.example"/);
    assert.doesNotMatch(firstWorker, /__BUILD_REVISION__|__API_BASE__/);

    await fs.writeFile(path.join(value.outDir, "index.html"), '<script src="/_next/app-v2.js"></script>');
    const secondRevision = await generateServiceWorker({ ...value, apiBase: "https://api.example/" });
    assert.notEqual(firstRevision, secondRevision);
  } finally {
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("waits for update approval and serves the cached shell offline", async () => {
  const value = await fixture();
  try {
    await generateServiceWorker({ ...value });
    const source = await fs.readFile(path.join(value.outDir, "sw.js"), "utf8");
    const handlers = new Map();
    let skipWaitingCalls = 0;
    let networkAvailable = true;
    const cache = {
      addAll: async () => {},
      add: async () => {},
      put: async () => {},
    };
    const caches = {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async (request) => request === "/" ? new Response("cached shell") : undefined,
    };
    const fetch = async () => {
      if (!networkAvailable) throw new TypeError("offline");
      return new Response('<script src="/_next/app.js"></script>', {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    };
    const self = {
      location: { origin: "https://todo.example" },
      clients: { claim: async () => {}, matchAll: async () => [] },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: () => { skipWaitingCalls += 1; },
    };
    vm.runInNewContext(source, {
      self, caches, fetch, indexedDB: {}, URL, Response, JSON, Promise, TypeError, console,
    });

    let installPromise;
    handlers.get("install")({ waitUntil: (promise) => { installPromise = promise; } });
    await installPromise;
    assert.equal(skipWaitingCalls, 0, "an update must remain waiting for user approval");

    handlers.get("message")({ data: { action: "skipWaiting" } });
    assert.equal(skipWaitingCalls, 1);

    networkAvailable = false;
    let navigationResponse;
    handlers.get("fetch")({
      request: { method: "GET", mode: "navigate", url: "https://todo.example/#/list/groceries" },
      respondWith: (promise) => { navigationResponse = promise; },
    });
    assert.equal(await (await navigationResponse).text(), "cached shell");
  } finally {
    await fs.rm(value.root, { recursive: true, force: true });
  }
});

test("background sync delivers the IndexedDB outbox without an open window", async () => {
  const value = await fixture();
  try {
    await generateServiceWorker({ ...value });
    const source = await fs.readFile(path.join(value.outDir, "sw.js"), "utf8");
    const handlers = new Map();
    const commands = [{
      id: "command-1",
      userId: "user-1",
      createdAt: "2026-08-24T10:00:00.000Z",
      status: "pending",
      method: "PATCH",
      path: "/api/lists/list-1",
      body: { name: "Groceries" },
    }];
    const idbResult = (result) => {
      const request = {};
      queueMicrotask(() => {
        request.result = result;
        request.onsuccess?.();
      });
      return request;
    };
    const database = {
      objectStoreNames: { contains: () => true },
      transaction: () => ({
        objectStore: () => ({
          getAll: () => idbResult(commands.map((command) => ({ ...command }))),
          delete: (id) => {
            commands.splice(commands.findIndex((command) => command.id === id), 1);
            return idbResult(undefined);
          },
          put: (command) => {
            commands.splice(commands.findIndex((candidate) => candidate.id === command.id), 1, command);
            return idbResult(command.id);
          },
        }),
      }),
      close: () => {},
    };
    const indexedDB = {
      open: () => {
        const request = { result: database };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    };
    const requests = [];
    const fetch = async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/api/auth/session")) {
        return Response.json({ user: { id: "user-1" } });
      }
      return Response.json({ ok: true });
    };
    const self = {
      location: { origin: "https://todo.example" },
      clients: { claim: async () => {}, matchAll: async () => [] },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: () => {},
    };
    vm.runInNewContext(source, {
      self, caches: {}, fetch, indexedDB, URL, Response, JSON, Promise, TypeError, console,
    });

    let syncPromise;
    handlers.get("sync")({
      tag: "smart-todos-outbox",
      waitUntil: (promise) => { syncPromise = promise; },
    });
    await syncPromise;

    assert.equal(commands.length, 0);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].init.headers["Idempotency-Key"], "command-1");
    assert.equal(requests[1].init.credentials, "include");
  } finally {
    await fs.rm(value.root, { recursive: true, force: true });
  }
});
