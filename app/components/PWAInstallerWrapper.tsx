'use client';

import { Suspense } from 'react';
import PWAInstaller from './PWAInstaller';

// Wrapper component to handle Suspense boundary for PWAInstaller
export default function PWAInstallerWrapper() {
  return (
    <Suspense fallback={null}>
      <PWAInstaller />
    </Suspense>
  );
}
