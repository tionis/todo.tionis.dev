import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { loadConfig } from "./config.mjs";
import { IDEMPOTENCY_TTL_MS, openDatabase } from "./database.mjs";
import { DocumentStore } from "./documents.mjs";
import { createRequestHelpers, fail } from "./http-helpers.mjs";
import { withIdempotency } from "./idempotency.mjs";
import { createListShaper } from "./list-shape.mjs";
import { createFixedWindowRateLimiter } from "./rate-limit.mjs";
import { createRealtime } from "./realtime.mjs";
import { NOT_HANDLED } from "./route-result.mjs";
import { createRoutesAuth } from "./routes-auth.mjs";
import { createRoutesContent } from "./routes-content.mjs";
import { createRoutesLists } from "./routes-lists.mjs";
import { createRoutesSharing } from "./routes-sharing.mjs";
import { handleScimRequest } from "./scim.mjs";
import { applySecurityHeaders } from "./security-headers.mjs";
import { serveStatic } from "./static.mjs";

const config = loadConfig();
const database = openDatabase(config.dataDir);
const documents = new DocumentStore(config.dataDir);
await documents.initialize();

// The export's inline scripts are allowed by hash. A build without the hash file
// (or nothing built yet) falls back to 'unsafe-inline'.
const scriptHashes = await fs.readFile(path.join(config.staticDir, "csp-script-hashes.json"), "utf8")
  .then((text) => JSON.parse(text).filter((hash) => /^sha256-[A-Za-z0-9+/=]+$/.test(hash)))
  .catch(() => {
    console.warn("csp-script-hashes.json not found; allowing inline scripts in the Content-Security-Policy");
    return [];
  });

const allowLoginForClient = createFixedWindowRateLimiter({ limit: config.authLoginLimit, windowMs: 10 * 60_000 });
const allowWritesForClient = createFixedWindowRateLimiter({ limit: 600, windowMs: 60_000 });
const allowLoginGlobally = createFixedWindowRateLimiter({ limit: 2_000, windowMs: 10 * 60_000, maxKeys: 1 });

const { requestUser, requestAddress, setCors, requireUser, trustedMutation } = createRequestHelpers({ config, database });
const shaper = createListShaper({ database });

const server = http.createServer(async (request, response) => {
  applySecurityHeaders(response, config.publicUrl, scriptHashes);
  setCors(request, response);
  try {
    const url = new URL(request.url || "/", config.publicUrl);
    if (url.pathname.startsWith("/scim/v2")) {
      await handleScimRequest(request, response, url, {
        database,
        config,
        onAccessChanged(listIds) {
          for (const listId of new Set(listIds)) realtime.refreshListConnections(listId);
          realtime.notifyAllDashboards();
        },
      });
    } else if (url.pathname.startsWith("/api/") || url.pathname === "/sync") {
      if (withIdempotency(database, request, response, () => requestUser(request), url)) return;
      await handleApi(request, response, url);
    } else if (!await serveStatic(request, response, url, config.staticDir)) {
      fail(response, 404, "Not found");
    }
  } catch (error) {
    console.error(error);
    if (!response.headersSent) fail(response, error.status || 500, error.status ? error.message : "Internal server error");
    else response.end();
  }
});

const realtime = createRealtime({ config, database, documents, requestUser, requestAddress, allowWritesForClient, ...shaper });
realtime.attach(server);

const routeContext = {
  config, database, documents, realtime, requestUser, requestAddress, requireUser, trustedMutation,
  allowLoginForClient, allowLoginGlobally, allowWritesForClient, ...shaper,
};
const routeGroups = [
  createRoutesAuth(routeContext),
  createRoutesLists(routeContext),
  createRoutesContent(routeContext),
  createRoutesSharing(routeContext),
];

async function handleApi(request, response, url) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
      "Access-Control-Max-Age": "86400",
    });
    response.end();
    return;
  }
  for (const group of routeGroups) {
    if (await group(request, response, url) !== NOT_HANDLED) return;
  }
  fail(response, 404, "Not found");
}

// Purge expired sessions, login attempts and idempotency records.
const cleanup = setInterval(() => {
  const now = Date.now();
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  database.prepare("DELETE FROM oidc_states WHERE expires_at <= ?").run(now);
  database.prepare("DELETE FROM idempotency_keys WHERE created_at <= ?").run(now - IDEMPOTENCY_TTL_MS);
}, 60 * 60_000);
cleanup.unref();

server.listen(config.port, config.host, () => {
  console.log(`Smart Todos listening on http://${config.host}:${config.port}`);
});

function shutdown() {
  clearInterval(cleanup);
  realtime.shutdown();
  server.closeIdleConnections?.();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
