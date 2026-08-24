import assert from "node:assert/strict";
import test from "node:test";
import { applySecurityHeaders, securityHeaders } from "./security-headers.mjs";

test("locks production responses to the application origin and HTTPS", () => {
  const headers = securityHeaders(new URL("https://todo.example"));

  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.match(headers["Permissions-Policy"], /camera=\(\)/);
  assert.match(headers["Content-Security-Policy"], /connect-src 'self' https:\/\/todo\.example wss:\/\/todo\.example/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(headers["Content-Security-Policy"], /object-src 'none'/);
  assert.match(headers["Content-Security-Policy"], /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(headers["Content-Security-Policy"], /(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
  assert.match(headers["Content-Security-Policy"], /script-src-attr 'none'/);
  assert.match(headers["Content-Security-Policy"], /upgrade-insecure-requests/);
});

test("keeps local HTTP development usable without advertising HSTS", () => {
  const headers = securityHeaders("http://localhost:3030");

  assert.equal(headers["Strict-Transport-Security"], undefined);
  assert.doesNotMatch(headers["Content-Security-Policy"], /upgrade-insecure-requests/);
  assert.match(headers["Content-Security-Policy"], /connect-src 'self' http:\/\/localhost:3030 ws:\/\/localhost:3030/);
});

test("applies every policy header to an HTTP response", () => {
  const applied = new Map();
  applySecurityHeaders({ setHeader: (name, value) => applied.set(name, value) }, "https://todo.example");

  assert.deepEqual(Object.fromEntries(applied), securityHeaders("https://todo.example"));
});
