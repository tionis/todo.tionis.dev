const CACHE_NAME = 'smart-todos-v1';
const STATIC_CACHE_NAME = 'smart-todos-static-v1';
const DYNAMIC_CACHE_NAME = 'smart-todos-dynamic-v1';

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
      .then((cache) => {
        return cache.addAll(staticAssets);
      })
      .then(() => {
        return self.skipWaiting();
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
  if (staticAssets.some(asset => url.pathname.startsWith(asset)) || 
      url.pathname.startsWith('/_next/') || 
      url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|json)$/)) {
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

  // Handle InstantDB and external API requests (network-first with graceful fallback)
  if (url.hostname.includes('instantdb.com') || url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
              cache.put(request, responseClone).catch((error) => {
                console.warn('Failed to cache API response:', error);
              });
            }).catch((error) => {
              console.warn('Failed to open cache for API responses:', error);
            });
          }
          return response;
        })
        .catch(() => {
          // For API failures, try cache first, then return offline response
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return a meaningful offline response for API calls
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
          });
        })
    );
    return;
  }

  // Default: network-first for everything else
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

// Handle background sync (for when the app comes back online)
self.addEventListener('sync', (event) => {
  // Here you could implement offline data synchronization
});

// Handle push notifications (future enhancement)
self.addEventListener('push', (event) => {
  // Here you could implement push notifications
});
