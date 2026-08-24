// The production build replaces these placeholders. Keeping the revision in
// the worker itself ensures browsers discover every exported application
// release, even when this source file did not otherwise change.
const CACHE_VERSION = '__BUILD_REVISION__';
const API_BASE = __API_BASE__;
const STATIC_CACHE_NAME = `smart-todos-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE_NAME = `smart-todos-dynamic-${CACHE_VERSION}`;

const staticAssets = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-icon-180.png',
  '/favicon.ico',
  // Note: Next.js assets will be cached dynamically
];

// Install event - cache static resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(staticAssets);
        const shell = await fetch('/');
        const html = await shell.clone().text();
        const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((match) => match[1])
          .filter((value) => value.startsWith('/_next/') || /\.(?:js|css|woff2?)$/.test(value));
        await Promise.allSettled([...new Set(assetUrls)].map((url) => cache.add(url)));
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
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
  }
});

// Fetch event - implement cache strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests and supported schemes
  if (request.method !== 'GET') return;
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Authentication and list metadata are server-authoritative and must never
  // be served from a cache. Keep this before the navigation/static branches so
  // it also covers same-origin production deployments and auth callbacks.
  const isSameOrigin = url.origin === self.location.origin;
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
        .then((response) => {
          // Cache successful navigation responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone).catch((error) => {
                console.warn('Failed to cache navigation response:', error);
              });
            }).catch((error) => {
              console.warn('Failed to open cache for navigation:', error);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached page or offline fallback
          return caches.match(request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Return the main page for hash routing
              return caches.match('/');
            });
        })
    );
    return;
  }

  // Handle static assets (cache-first strategy)
  if (isSameOrigin && (staticAssets.includes(url.pathname) ||
      url.pathname.startsWith('/_next/') ||
      url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|json)$/))) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone).catch((error) => {
                console.warn('Failed to cache static asset:', error);
              });
            }).catch((error) => {
              console.warn('Failed to open cache for static assets:', error);
            });
          }
          return response;
        }).catch(() => {
          // For offline, try to return a basic response for essential assets
          if (url.pathname === '/' || url.pathname.includes('.html')) {
            return caches.match('/');
          }
          // For other assets, return a 404 response
          return new Response('Asset not available offline', { status: 404 });
        });
      })
    );
    return;
  }

  // Default: network-first for everything else
  if (!isSameOrigin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
            cache.put(request, responseClone).catch((error) => {
              console.warn('Failed to cache default response:', error);
            });
          }).catch((error) => {
            console.warn('Failed to open cache for default responses:', error);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

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
  if (!session.user?.id) return;

  const database = await openOutboxDatabase();
  try {
    const commands = (await readOutbox(database))
      .filter((command) => command.userId === session.user.id && command.status === 'pending')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));

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
  } finally {
    database.close();
    await notifyOutboxUpdated();
  }
}

// Deliver queued authoritative changes even when no application window is open.
self.addEventListener('sync', (event) => {
  if (event.tag === 'smart-todos-outbox') {
    event.waitUntil(flushOutboxInBackground());
  }
});
