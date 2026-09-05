// The production build replaces these placeholders. Keeping the revision in
// the worker itself ensures browsers discover every exported application
// release, even when this source file did not otherwise change.
const CACHE_VERSION = '__BUILD_REVISION__';
const API_BASE = __API_BASE__;
const BUILD_ASSETS = __PRECACHE_ASSETS__;
const CACHE_PREFIX = 'smart-todos-';
const PRECACHE_CACHE_NAME = `${CACHE_PREFIX}precache-${CACHE_VERSION}`;
const RUNTIME_ASSET_CACHE_NAME = `${CACHE_PREFIX}assets-${CACHE_VERSION}`;
const NAVIGATION_CACHE_NAME = `${CACHE_PREFIX}navigation-${CACHE_VERSION}`;
const RUNTIME_ASSET_CACHE_LIMIT = 64;
const NAVIGATION_CACHE_LIMIT = 32;
const RUNTIME_ASSET_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const NAVIGATION_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHED_AT_HEADER = 'X-Smart-Todos-Cached-At';
const CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'image', 'font']);

const staticAssets = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-icon-180.png',
  '/favicon.ico',
  ...BUILD_ASSETS,
];

// Install event - cache static resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE_CACHE_NAME)
      .then((cache) => cache.addAll(staticAssets))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith(CACHE_PREFIX) &&
              cacheName !== PRECACHE_CACHE_NAME &&
              cacheName !== RUNTIME_ASSET_CACHE_NAME &&
              cacheName !== NAVIGATION_CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.action === 'outbox-capabilities') {
    const reply = event.ports && event.ports[0];
    if (reply) reply.postMessage({ outboxFlush: true });
    return;
  }
  if (event.data && event.data.action === 'flush-outbox') {
    const reply = event.ports && event.ports[0];
    const flush = requestOutboxFlush();
    event.waitUntil(flush.then(
      () => reply && reply.postMessage({ ok: true }),
      (error) => reply && reply.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Synchronization deferred' }),
    ));
  }
});

async function putBounded(cacheName, request, response, limit) {
  const cache = await caches.open(cacheName);
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, Date.now().toString());
  await cache.put(request, new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)));
}

async function matchFresh(cacheName, request, maxAgeMs) {
  const cache = await caches.open(cacheName);
  const response = await cache.match(request);
  if (!response) return undefined;
  const cachedAt = Number(response.headers.get(CACHED_AT_HEADER));
  if (!cachedAt || Date.now() - cachedAt <= maxAgeMs) return response;
  await cache.delete(request);
  return undefined;
}

// Fetch event - implement cache strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin && request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(handleShareTargetRequest(request));
    return;
  }

  // Only handle GET requests and supported schemes
  if (request.method !== 'GET') return;
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Authentication and list metadata are server-authoritative and must never
  // be served from a cache. Keep this before the navigation/static branches so
  // it also covers same-origin production deployments and auth callbacks.
  const apiUrl = new URL(`${API_BASE || self.location.origin}/api/`);
  const isApiRequest = url.origin === apiUrl.origin && url.pathname.startsWith(apiUrl.pathname);
  if (isApiRequest) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          return new Response(
            JSON.stringify({
              error: 'offline',
              message: 'This request requires an internet connection'
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }

  // Handle navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          // Cache successful navigation responses
          if (response.ok && !url.search) {
            const responseClone = response.clone();
            await putBounded(NAVIGATION_CACHE_NAME, request, responseClone, NAVIGATION_CACHE_LIMIT).catch((error) => {
              console.warn('Failed to open cache for navigation:', error);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached page or offline fallback
          return matchFresh(NAVIGATION_CACHE_NAME, request, NAVIGATION_CACHE_MAX_AGE_MS)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Return the main page for hash routing
              return caches.open(PRECACHE_CACHE_NAME).then((cache) => cache.match('/'));
            });
        })
    );
    return;
  }

  // Handle static assets (cache-first strategy)
  if (isSameOrigin && staticAssets.includes(url.pathname)) {
    event.respondWith(
      caches.open(PRECACHE_CACHE_NAME).then((cache) => cache.match(request)).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).catch(() => new Response('Asset not available offline', { status: 404 }));
      })
    );
    return;
  }

  if (isSameOrigin && (url.pathname.startsWith('/_next/') || CACHEABLE_DESTINATIONS.has(request.destination))) {
    event.respondWith(
      matchFresh(RUNTIME_ASSET_CACHE_NAME, request, RUNTIME_ASSET_CACHE_MAX_AGE_MS)
        .then((cachedResponse) => cachedResponse || fetch(request).then(async (response) => {
          if (response.ok) {
            await putBounded(RUNTIME_ASSET_CACHE_NAME, request, response.clone(), RUNTIME_ASSET_CACHE_LIMIT)
              .catch((error) => console.warn('Failed to cache runtime asset:', error));
          }
          return response;
        }))
        .catch(() => new Response('Asset not available offline', { status: 404 }))
    );
    return;
  }

  // Unknown same-origin requests stay network-only so future endpoints and
  // downloads cannot silently become part of the offline cache.
  if (!isSameOrigin) return;

  event.respondWith(
    fetch(request)
      .catch(() => new Response('This resource is unavailable offline', { status: 503 }))
  );
});

function openShareDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('smart-todos-pwa', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('shares')) {
        request.result.createObjectStore('shares', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeSharedText(text) {
  const database = await openShareDatabase();
  try {
    const id = crypto.randomUUID();
    const entries = await outboxRequest(database.transaction('shares', 'readonly').objectStore('shares').getAll());
    const cutoff = Date.now() - SHARE_MAX_AGE_MS;
    const retainedIds = new Set(entries
      .filter((entry) => entry.createdAt >= cutoff)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 19)
      .map((entry) => entry.id));
    const transaction = database.transaction('shares', 'readwrite');
    const store = transaction.objectStore('shares');
    for (const entry of entries.filter((candidate) => !retainedIds.has(candidate.id))) store.delete(entry.id);
    store.put({ id, text, createdAt: Date.now() });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return id;
  } finally {
    database.close();
  }
}

async function handleShareTargetRequest(request) {
  try {
    const formData = await request.formData();
    const value = (name) => {
      const item = formData.get(name);
      return typeof item === 'string' ? item.trim() : '';
    };
    const parts = [];
    for (const item of [value('title'), value('text'), value('url')]) {
      if (item && !parts.includes(item)) parts.push(item);
    }
    const text = parts.join('\n').slice(0, 20_000);
    const shareId = await storeSharedText(text);
    const destination = new URL('/', self.location.origin);
    destination.searchParams.set('action', 'share');
    destination.searchParams.set('shareId', shareId);
    return Response.redirect(destination.href, 303);
  } catch (error) {
    console.error('Could not receive shared content:', error);
    return new Response('Could not receive shared content', { status: 500 });
  }
}

function openOutboxDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('smart-todos-automerge', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('documents')) {
        request.result.createObjectStore('documents');
      }
      if (!request.result.objectStoreNames.contains('outbox')) {
        request.result.createObjectStore('outbox', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function outboxRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readOutbox(database) {
  return outboxRequest(database.transaction('outbox', 'readonly').objectStore('outbox').getAll());
}

async function deleteOutboxCommand(database, id) {
  await outboxRequest(database.transaction('outbox', 'readwrite').objectStore('outbox').delete(id));
}

async function updateOutboxCommand(database, command) {
  await outboxRequest(database.transaction('outbox', 'readwrite').objectStore('outbox').put(command));
}

async function notifyOutboxUpdated() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type: 'outbox-updated' });
}

async function flushOutboxInBackground() {
  const base = API_BASE || self.location.origin;
  const sessionResponse = await fetch(`${base}/api/auth/session`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!sessionResponse.ok) throw new Error(`Session unavailable (${sessionResponse.status})`);
  const session = await sessionResponse.json();
  const userId = session.user?.id || 'anonymous';

  const database = await openOutboxDatabase();
  try {
    // Re-read after each batch so edits queued while a flush is in progress
    // are not stranded until the application is opened again.
    while (true) {
      const commands = (await readOutbox(database))
        .filter((command) => command.userId === userId && command.status === 'pending')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      if (commands.length === 0) break;

      for (const command of commands) {
        const response = await fetch(`${base}${command.path}`, {
          method: command.method,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': command.id,
          },
          body: command.body === undefined ? undefined : JSON.stringify(command.body),
        });

        if (response.ok) {
          await deleteOutboxCommand(database, command.id);
          continue;
        }
        if (response.status === 401 || response.status === 429 || response.status >= 500) {
          throw new Error(`Synchronization deferred (${response.status})`);
        }

        const value = await response.json().catch(() => ({}));
        command.status = 'rejected';
        command.error = value.message || value.error || `Server rejected this change (${response.status})`;
        await updateOutboxCommand(database, command);
      }
    }
  } finally {
    database.close();
    await notifyOutboxUpdated();
  }
}

let outboxFlushPromise = null;
function requestOutboxFlush() {
  if (!outboxFlushPromise) {
    outboxFlushPromise = flushOutboxInBackground().finally(() => {
      outboxFlushPromise = null;
    });
  }
  return outboxFlushPromise;
}

// Deliver queued changes even when no application window is open.
self.addEventListener('sync', (event) => {
  if (event.tag === 'smart-todos-outbox') {
    event.waitUntil(requestOutboxFlush());
  }
});
