'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '../../lib/db';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [wasOffline, setWasOffline] = useState(false);
  const offlineRef = useRef(false);

  useEffect(() => {
    // Check if we're in a browser environment
    if (typeof window === 'undefined') return;

    let reconnectedTimer: ReturnType<typeof setTimeout> | undefined;
    const updateOnlineStatus = () => {
      if (!navigator.onLine) {
        offlineRef.current = true;
        setIsOnline(false);
        setWasOffline(false);
        return;
      }

      setIsOnline(true);
      if (offlineRef.current) {
        offlineRef.current = false;
        setWasOffline(true);
        clearTimeout(reconnectedTimer);
        reconnectedTimer = setTimeout(() => setWasOffline(false), 3000);
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
      clearTimeout(reconnectedTimer);
    };
  }, []);

  return { isOnline, wasOffline };
}

export function SyncStatusBadge({ listId }: { listId?: string }) {
  const { isOnline } = useOnlineStatus();
  const { pending, rejected, syncing, errors, ready, lastSyncedAt } = db.useSyncStatus(listId);
  const [expanded, setExpanded] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState<'none' | 'finish' | 'retry'>('none');

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const registrationPrototype = typeof ServiceWorkerRegistration === 'undefined' ? undefined : ServiceWorkerRegistration.prototype;
    setBackgroundMode('sync' in (registrationPrototype || {}) ? 'retry' : navigator.serviceWorker.controller ? 'finish' : 'none');
  }, []);

  const state = rejected > 0
    ? { label: 'Sync issue', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-300', border: 'border-red-300 dark:border-red-800' }
    : !ready
      ? { label: 'Checking sync', dot: 'bg-gray-400 animate-pulse', text: 'text-gray-600 dark:text-gray-300', border: 'border-gray-300 dark:border-gray-600' }
      : !isOnline && pending > 0
        ? { label: `Saved locally (${pending})`, dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-800' }
        : !isOnline
          ? { label: 'Offline · synced', dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-300', border: 'border-gray-300 dark:border-gray-600' }
          : syncing || pending > 0
            ? { label: `Syncing${pending > 0 ? ` (${pending})` : ''}`, dot: 'bg-blue-500 animate-pulse', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300 dark:border-blue-800' }
            : { label: 'Synced', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-300 dark:border-emerald-800' };

  const detail = rejected > 0
    ? errors[0]
    : pending > 0
      ? `${pending} change${pending === 1 ? ' is' : 's are'} safely stored on this device and waiting for server confirmation.`
      : isOnline
        ? 'Every local change has been confirmed by the server.'
        : 'Everything saved before you went offline was confirmed by the server.';

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border bg-white px-2.5 py-1 text-xs shadow-sm dark:bg-gray-800 ${state.text} ${state.border}`}
        title="Show synchronization details"
      >
        <span className={`h-2 w-2 rounded-full ${state.dot}`} aria-hidden="true" />
        <span>{state.label}</span>
      </button>
      {expanded && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-sans text-gray-600 shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          <div className="font-medium text-gray-900 dark:text-white">Synchronization</div>
          <p className="mt-1">{detail}</p>
          {lastSyncedAt && pending === 0 && rejected === 0 && (
            <p className="mt-2 text-gray-500 dark:text-gray-400">Last confirmed {new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
          )}
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            {backgroundMode === 'retry'
              ? 'Browser background retry is enabled, including after you reconnect.'
              : backgroundMode === 'finish'
                ? 'An upload already in progress can finish after this tab closes; offline changes retry when you reopen the app.'
                : 'Keep the app open until “Synced”; offline changes retry when you reopen it.'}
          </p>
          {(pending > 0 || rejected > 0) && isOnline && (
            <button type="button" className="mt-3 font-medium text-blue-600 underline dark:text-blue-400" onClick={() => void (rejected > 0 ? db.retryRejected() : db.syncNow())}>
              Try now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function OfflineIndicator() {
  const { isOnline, wasOffline } = useOnlineStatus();
  const { pending, rejected, syncing, errors } = db.useSyncStatus();

  if (rejected > 0) {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
        <span className="text-sm font-medium">{rejected} offline change{rejected === 1 ? '' : 's'} need attention: {errors[0]}</span>
        <button type="button" className="text-sm underline whitespace-nowrap" onClick={() => void db.retryRejected()}>Retry</button>
        {isOnline && <button type="button" className="text-sm underline whitespace-nowrap" onClick={() => void db.discardRejected()}>Discard</button>}
      </div>
    );
  }

  if (syncing || wasOffline) {
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
