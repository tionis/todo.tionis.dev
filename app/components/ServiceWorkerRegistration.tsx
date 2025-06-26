'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function ServiceWorkerRegistration() {
  const searchParams = useSearchParams();

  useEffect(() => {
    // Handle PWA shortcut actions
    const action = searchParams.get('action');
    if (action === 'new') {
      console.log('PWA shortcut: Create new list');
    }

    // Register service worker for offline functionality
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered successfully:', registration);
        })
        .catch((error) => {
          console.log('Service Worker registration failed:', error);
        });
    }
  }, [searchParams]);

  return null;
}
