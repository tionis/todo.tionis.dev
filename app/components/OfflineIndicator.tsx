'use client';

import { useState, useEffect } from 'react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') return;

    const updateOnlineStatus = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      
      // Track if we were offline and came back online
      if (!online) {
        setWasOffline(true);
      } else if (wasOffline) {
        // We're back online after being offline
        setWasOffline(false);
      }
    };

    // Set initial status
    updateOnlineStatus();

    // Listen for online/offline events
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, [wasOffline]);

  return { isOnline, wasOffline };
}

export default function OfflineIndicator() {
  const { isOnline, wasOffline } = useOnlineStatus();
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (isOnline && wasOffline) {
      setShowReconnected(true);
      // Hide the "reconnected" message after 3 seconds
      const timer = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  if (showReconnected) {
    return (
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2">
        <span className="w-2 h-2 bg-green-300 rounded-full animate-pulse"></span>
        <span className="text-sm font-medium">Back online! Syncing your changes...</span>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-orange-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2">
        <span className="w-2 h-2 bg-orange-300 rounded-full"></span>
        <span className="text-sm font-medium">You're offline. Changes will sync when you reconnect.</span>
      </div>
    );
  }

  return null;
}
