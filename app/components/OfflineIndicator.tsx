'use client';

import { useState, useEffect } from 'react';
import { db } from '../../lib/db';

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
  const { pending, rejected, syncing, errors } = db.useSyncStatus();
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (isOnline && wasOffline) {
      setShowReconnected(true);
      // Hide the "reconnected" message after 3 seconds
      const timer = setTimeout(() => setShowReconnected(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  if (rejected > 0) {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
        <span className="text-sm font-medium">{rejected} offline change{rejected === 1 ? '' : 's'} need attention: {errors[0]}</span>
        <button type="button" className="text-sm underline whitespace-nowrap" onClick={() => void db.retryRejected()}>Retry</button>
        {isOnline && <button type="button" className="text-sm underline whitespace-nowrap" onClick={() => void db.discardRejected()}>Discard</button>}
      </div>
    );
  }

  if (syncing || showReconnected) {
    return (
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2">
        <span className="w-2 h-2 bg-green-300 rounded-full animate-pulse"></span>
        <span className="text-sm font-medium">{pending > 0 ? `Syncing ${pending} queued change${pending === 1 ? '' : 's'}...` : 'Back online! All changes are saved.'}</span>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-orange-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2">
        <span className="w-2 h-2 bg-orange-300 rounded-full"></span>
        <span className="text-sm font-medium">You&apos;re offline. {pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} saved locally.` : 'Changes will sync when you reconnect.'}</span>
      </div>
    );
  }

  if (pending > 0) {
    return (
      <button type="button" onClick={() => void db.syncNow()} className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
        {pending} change{pending === 1 ? '' : 's'} waiting to sync — Sync now
      </button>
    );
  }

  return null;
}
