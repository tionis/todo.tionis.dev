import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from '../backend/static.mjs';

const staticDir = path.resolve('out');
const serviceWorkerSource = await fs.readFile(path.join(staticDir, 'sw.js'), 'utf8');
let serviceWorkerRevision = 'base';
function json(response, value) {
  const body = JSON.stringify(value);
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4173');
  const cookies = new Set((request.headers.cookie || '').split(';').map((cookie) => cookie.trim()));
  if (request.method === 'POST' && url.pathname === '/__test/sw-revision') {
    const requestedRevision = url.searchParams.get('value') || '';
    if (!/^[a-z0-9-]{1,40}$/i.test(requestedRevision)) {
      response.writeHead(400).end();
      return;
    }
    serviceWorkerRevision = requestedRevision;
    response.writeHead(204).end();
    return;
  }
  if (request.method === 'GET' && url.pathname === '/sw.js') {
    const body = serviceWorkerSource.replace(
      /const CACHE_VERSION = '[^']+';/,
      `const CACHE_VERSION = '${serviceWorkerRevision}';`,
    );
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': Buffer.byteLength(body),
      'Content-Type': 'text/javascript; charset=utf-8',
    });
    response.end(body);
    return;
  }
  if (cookies.has('pwa-test-offline=1')) {
    request.socket.destroy();
    return;
  }
  const authenticated = cookies.has('pwa-test-auth=1');
  if (request.method === 'GET' && url.pathname === '/api/auth/session') {
    json(response, { user: authenticated ? { id: 'user-1', name: 'Test User' } : null });
    return;
  }
  if (authenticated && request.method === 'GET' && url.pathname === '/api/lists') {
    json(response, { lists: [] });
    return;
  }
  if (authenticated && request.method === 'GET' && url.pathname === '/api/invitations') {
    json(response, { invitations: [] });
    return;
  }
  if (!await serveStatic(request, response, url, staticDir)) {
    response.writeHead(404).end();
  }
});

server.listen(4173, '127.0.0.1', () => console.log('PWA test server listening on http://127.0.0.1:4173'));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
