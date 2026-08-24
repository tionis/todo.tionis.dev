'use client';

import { useEffect, useState } from 'react';
import { isIosDevice, storageNotice, type StorageNotice } from '../../lib/pwa';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export default function PwaControls() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const [notice, setNotice] = useState<StorageNotice>(null);
  const [dismissedStorage, setDismissedStorage] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const dismissed = sessionStorage.getItem('smart-todos:install-dismissed') === 'true';
    const ios = isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    if (ios && !dismissed) setShowIosInstall(true);

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (!dismissed) setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setShowIosInstall(false);
      setShowIosHelp(false);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!navigator.storage?.estimate) return;
    let cancelled = false;
    let persistenceRequested = false;
    const checkStorage = async () => {
      const wasPersisted = await navigator.storage.persisted?.() ?? false;
      let persisted = wasPersisted;
      if (!persisted && !persistenceRequested) {
        persistenceRequested = true;
        persisted = await navigator.storage.persist?.() || false;
      }
      const estimate = await navigator.storage.estimate();
      if (!cancelled) setNotice(storageNotice(persisted, estimate));
    };
    void checkStorage().catch((error) => console.warn('Could not inspect offline storage:', error));
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void checkStorage();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const dismissInstall = () => {
    sessionStorage.setItem('smart-todos:install-dismissed', 'true');
    setInstallPrompt(null);
    setShowIosInstall(false);
    setShowIosHelp(false);
  };

  const install = async () => {
    if (!installPrompt) {
      setShowIosHelp(true);
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const showInstall = Boolean(installPrompt) || showIosInstall;
  const visibleNotice = notice && !dismissedStorage;
  if (!showInstall && !visibleNotice) return null;

  const storageColor = notice?.level === 'critical'
    ? 'bg-red-700'
    : notice?.level === 'warning'
      ? 'bg-amber-600'
      : 'bg-slate-700';

  return (
    <div className="fixed bottom-4 left-4 z-40 flex max-w-sm flex-col gap-2" aria-live="polite">
      {showInstall && (
        <div className="rounded-lg bg-blue-700 p-3 text-sm text-white shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">Install Smart Todos</div>
              <div className="mt-1 text-xs text-blue-100">
                {showIosHelp ? 'Open the Share menu and choose “Add to Home Screen”.' : 'Launch faster and keep your lists available offline.'}
              </div>
            </div>
            <button type="button" onClick={dismissInstall} aria-label="Dismiss install suggestion" className="text-blue-100 hover:text-white">×</button>
          </div>
          {!showIosHelp && <button type="button" onClick={() => void install()} className="mt-2 rounded bg-blue-500 px-3 py-1 hover:bg-blue-400">Install</button>}
        </div>
      )}
      {visibleNotice && (
        <div className={`rounded-lg p-3 text-xs text-white shadow-lg ${storageColor}`}>
          <div className="flex items-start justify-between gap-3">
            <span>{notice.message}</span>
            <button type="button" onClick={() => setDismissedStorage(true)} aria-label="Dismiss storage notice" className="text-white/80 hover:text-white">×</button>
          </div>
        </div>
      )}
    </div>
  );
}
