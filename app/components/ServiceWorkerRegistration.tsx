'use client';

import { useEffect, useState } from 'react';

export default function ServiceWorkerRegistration() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [newWorker, setNewWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    // Register service worker for offline functionality
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered successfully');
          
          // Check for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              setNewWorker(newWorker);
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New version available
                  setUpdateAvailable(true);
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
      
      // Listen for controller changes (new SW activated)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Reload the page to get the latest version
        window.location.reload();
      });
    }
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
