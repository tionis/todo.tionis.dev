'use client';

import { useEffect, useState } from 'react';

export default function ServiceWorkerRegistration() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [newWorker, setNewWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // A production service worker left behind on localhost can otherwise serve
    // stale application or authentication responses while running Next dev.
    if (process.env.NODE_ENV === 'development') {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister()))
      );
      if ('caches' in window) {
        void caches.keys().then((names) => Promise.all(
          names.filter((name) => name.startsWith('smart-todos-')).map((name) => caches.delete(name))
        ));
      }
      return;
    }

    // Register service worker for offline functionality
    let reloading = false;
    let hadController = Boolean(navigator.serviceWorker.controller);
    const watchWorker = (worker: ServiceWorker | null) => {
      if (!worker) return;
      setNewWorker(worker);
      const handleStateChange = () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          setUpdateAvailable(true);
        }
      };
      worker.addEventListener('statechange', handleStateChange);
      handleStateChange();
    };
    const handleControllerChange = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'outbox-updated') {
        void import('../../lib/db').then(({ db }) => db.refreshAfterBackgroundSync());
      }
    };

    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => {
          console.log('Service Worker registered successfully');
          watchWorker(registration.waiting);
          registration.addEventListener('updatefound', () => {
            watchWorker(registration.installing);
          });
          void registration.update().catch((error) => {
            console.warn('Could not check for a service worker update:', error);
          });
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
      
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
      navigator.serviceWorker.addEventListener('message', handleMessage);

      return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      };
  }, []);

  const handleUpdate = () => {
    if (newWorker) {
      newWorker.postMessage({ action: 'skipWaiting' });
    }
  };

  const handleDismiss = () => {
    setUpdateAvailable(false);
  };

  if (updateAvailable) {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-blue-500 text-white p-4 rounded-lg shadow-lg max-w-sm">
        <div className="flex items-start space-x-3">
          <div className="flex-1">
            <h4 className="font-medium text-sm">Update Available</h4>
            <p className="text-xs text-blue-100 mt-1">
              A new version of Smart Todos is ready to install.
            </p>
          </div>
        </div>
        <div className="flex space-x-2 mt-3">
          <button
            onClick={handleUpdate}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded transition-colors"
          >
            Update Now
          </button>
          <button
            onClick={handleDismiss}
            className="bg-blue-400 hover:bg-blue-500 text-white text-xs px-3 py-1 rounded transition-colors"
          >
            Later
          </button>
        </div>
      </div>
    );
  }

  return null;
}
