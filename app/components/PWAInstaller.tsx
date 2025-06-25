'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function PWAInstaller() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isInstallable, setIsInstallable] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Handle PWA shortcut actions
    const action = searchParams.get('action');
    if (action === 'new') {
      // This would trigger the create new list action
      // You could dispatch an event or use a context to trigger this
      console.log('PWA shortcut: Create new list');
    }

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('SW registered: ', registration);
          
          // Check for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New content is available
                  console.log('New content is available; please refresh.');
                  showUpdateAvailable();
                }
              });
            }
          });
        })
        .catch((registrationError) => {
          console.log('SW registration failed: ', registrationError);
        });
    }

    // Handle app install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later
      setDeferredPrompt(e);
      setIsInstallable(true);
      
      // Show install button or notification
      showInstallPromotion();
    };

    const showUpdateAvailable = () => {
      const updateBanner = document.createElement('div');
      updateBanner.id = 'update-banner';
      updateBanner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: #059669;
        color: white;
        padding: 12px 16px;
        text-align: center;
        z-index: 1001;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      `;
      
      updateBanner.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; max-width: 600px; margin: 0 auto;">
          <span>🔄 New version available!</span>
          <button id="refresh-button" style="
            background: white;
            color: #059669;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
          ">Refresh</button>
        </div>
      `;
      
      document.body.appendChild(updateBanner);
      
      const refreshButton = document.getElementById('refresh-button');
      refreshButton?.addEventListener('click', () => {
        window.location.reload();
      });
    };

    const showInstallPromotion = () => {
      // Check if we should show install promotion
      const installPromotionShown = localStorage.getItem('install-promotion-shown');
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                          (window.navigator as any).standalone === true;
      
      if (!installPromotionShown && !isStandalone && deferredPrompt) {
        // Don't show immediately, wait a bit for user to interact with the app
        setTimeout(() => {
          createInstallBanner();
        }, 5000);
      }
    };

    const createInstallBanner = () => {
      const installBanner = document.createElement('div');
      installBanner.id = 'install-banner';
      installBanner.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        right: 20px;
        background: #2563eb;
        color: white;
        padding: 16px;
        border-radius: 12px;
        z-index: 1000;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        max-width: 400px;
        margin: 0 auto;
        animation: slideUp 0.3s ease-out;
      `;
      
      // Add animation styles
      if (!document.getElementById('install-banner-styles')) {
        const style = document.createElement('style');
        style.id = 'install-banner-styles';
        style.textContent = `
          @keyframes slideUp {
            from { transform: translateY(100px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `;
        document.head.appendChild(style);
      }
      
      installBanner.innerHTML = `
        <div style="display: flex; align-items: start; gap: 12px;">
          <div style="font-size: 24px;">📱</div>
          <div style="flex: 1;">
            <div style="font-weight: 600; margin-bottom: 4px;">Install Smart Todos</div>
            <div style="font-size: 13px; opacity: 0.9; margin-bottom: 12px;">
              Get faster access, offline support, and a native app experience.
            </div>
            <div style="display: flex; gap: 8px;">
              <button id="install-button" style="
                background: white;
                color: #2563eb;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
                font-size: 13px;
              ">Install App</button>
              <button id="dismiss-button" style="
                background: transparent;
                color: white;
                border: 1px solid rgba(255,255,255,0.3);
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
              ">Not now</button>
            </div>
          </div>
          <button id="close-button" style="
            background: none;
            border: none;
            color: white;
            cursor: pointer;
            font-size: 18px;
            opacity: 0.7;
            padding: 0;
            width: 24px;
            height: 24px;
          ">×</button>
        </div>
      `;
      
      document.body.appendChild(installBanner);
      
      // Handle install button click
      const installButton = document.getElementById('install-button');
      installButton?.addEventListener('click', async () => {
        installBanner.remove();
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          console.log(`User response to the install prompt: ${outcome}`);
          setDeferredPrompt(null);
          setIsInstallable(false);
        }
        localStorage.setItem('install-promotion-shown', 'true');
      });
      
      // Handle dismiss and close buttons
      const dismissButton = document.getElementById('dismiss-button');
      const closeButton = document.getElementById('close-button');
      
      dismissButton?.addEventListener('click', () => {
        installBanner.remove();
        localStorage.setItem('install-promotion-shown', 'true');
      });
      
      closeButton?.addEventListener('click', () => {
        installBanner.remove();
        // Don't mark as permanently dismissed, just for this session
      });
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Clean up
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [searchParams, deferredPrompt]);

  return null; // This component doesn't render anything
}
