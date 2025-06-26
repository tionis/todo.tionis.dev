'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    // Register service worker for offline functionality
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          // Service worker registered successfully
        })
        .catch((error) => {
          // Service worker registration failed
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  return null;
}
