import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { serveStatic } from "./static.mjs";

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-static-"));
  await fs.mkdir(path.join(directory, "_next", "static"), { recursive: true });
  await fs.writeFile(path.join(directory, "index.html"), "<h1>Smart Todos</h1>");
  await fs.writeFile(path.join(directory, "manifest.json"), '{"name":"Smart Todos"}');
  await fs.writeFile(path.join(directory, "_next", "static", "app.js"), "console.log('app')");
  return directory;
}

async function startStaticServer(directory) {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (!await serveStatic(request, response, url, directory)) {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

test("serves frontend files with appropriate cache policy", async () => {
  const directory = await fixture();
  const { server, origin } = await startStaticServer(directory);
  try {
    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-cache");
    assert.equal(await page.text(), "<h1>Smart Todos</h1>");

    const asset = await fetch(`${origin}/_next/static/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");

    const manifest = await fetch(`${origin}/manifest.json`);
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get("cache-control"), "no-cache");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("falls back to the app shell but does not expose files outside the export", async () => {
  const directory = await fixture();
  const { server, origin } = await startStaticServer(directory);
  try {
    const route = await fetch(`${origin}/lists`, { headers: { Accept: "text/html" } });
    assert.equal(route.status, 200);
    assert.match(await route.text(), /Smart Todos/);

    const traversal = await fetch(`${origin}/%2e%2e%2fpackage.json`);
    assert.equal(traversal.status, 404);
    const missingAsset = await fetch(`${origin}/missing.js`, { headers: { Accept: "text/html" } });
    assert.equal(missingAsset.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
