import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  const response = await request.post('/__test/sw-revision?value=base');
  expect(response.ok()).toBe(true);
});

test('installs its complete offline shell and reloads without a network', async ({ context, page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Smart Todos' })).toBeVisible();
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const manifest = await page.evaluate(async () => fetch('/manifest.json').then((response) => response.json()));
  expect(manifest).toMatchObject({
    id: '/',
    start_url: '/',
    display: 'standalone',
    share_target: { action: '/share-target', method: 'POST', enctype: 'multipart/form-data' },
  });

  const cacheState = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const staticCacheName = cacheNames.find((name) => name.startsWith('smart-todos-precache-'));
    if (!staticCacheName) return { cacheNames, urls: [] };
    const cache = await caches.open(staticCacheName);
    return { cacheNames, urls: (await cache.keys()).map((request) => new URL(request.url).pathname) };
  });
  expect(cacheState.urls).toContain('/');
  expect(cacheState.urls.some((url) => url.endsWith('.wasm'))).toBe(true);
  expect(cacheState.urls.some((url) => url.endsWith('.css'))).toBe(true);

  await context.addCookies([{ name: 'pwa-test-offline', value: '1', url: 'http://127.0.0.1:4173' }]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Smart Todos' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('privately hands POSTed shared text to the authenticated quick-add flow', async ({ context, page }) => {
  await context.addCookies([{ name: 'pwa-test-auth', value: '1', url: 'http://127.0.0.1:4173' }]);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Todo Lists' })).toBeVisible();
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/share-target';
    form.enctype = 'multipart/form-data';
    for (const [name, value] of [['title', 'Recipe'], ['text', 'Buy lemons'], ['url', 'https://example.com']]) {
      const input = document.createElement('input');
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  });
  await expect(page.getByRole('heading', { name: 'Add shared todo' })).toBeVisible();
  await expect(page.locator('#shared-todo-text')).toHaveValue('Recipe\nBuy lemons\nhttps://example.com');
  await expect(page).toHaveURL('/');
});

test('preserves queued changes across an offline browser restart', async ({ context, page }) => {
  await context.addCookies([{ name: 'pwa-test-auth', value: '1', url: 'http://127.0.0.1:4173' }]);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Todo Lists' })).toBeVisible();
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('smart-todos-automerge', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('outbox', 'readwrite');
      transaction.objectStore('outbox').put({
        id: 'offline-command',
        userId: 'user-1',
        listId: 'list-1',
        createdAt: '2026-08-24T10:00:00.000Z',
        status: 'pending',
        method: 'PATCH',
        path: '/api/lists/list-1',
        body: { name: 'Groceries' },
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  await context.addCookies([{ name: 'pwa-test-offline', value: '1', url: 'http://127.0.0.1:4173' }]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/1 change (saved locally|waiting to sync)/)).toBeVisible();
  const commands = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('smart-todos-automerge', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).finally(() => database.close());
  });
  expect(commands).toHaveLength(1);
});

test('reports an installable Chromium manifest without errors', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Desktop Chromium DevTools installability diagnostics');
  await page.goto('/');
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const session = await context.newCDPSession(page);
  const manifest = await session.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
  expect(JSON.parse(manifest.data || '{}')).toMatchObject({
    id: '/',
    start_url: '/',
    display: 'standalone',
  });
  const installability = await session.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
});

test('updates the real worker and migrates only its own caches', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'One real-browser lifecycle test is sufficient');
  await page.goto('/');
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active?.state === 'activated');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.evaluate(async () => {
    await caches.open('another-app-cache');
    await caches.open('smart-todos-precache-obsolete');
  });

  const revisionResponse = await request.post('/__test/sw-revision?value=next');
  expect(revisionResponse.ok()).toBe(true);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await expect(page.getByText('Update Available')).toBeVisible();
  await page.getByRole('button', { name: 'Update Now' }).click();
  await expect(page.getByRole('heading', { name: 'Smart Todos' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).sort())).toEqual(
    expect.arrayContaining(['another-app-cache', 'smart-todos-precache-next']),
  );
  const cacheNames = await page.evaluate(async () => caches.keys());
  expect(cacheNames).not.toContain('smart-todos-precache-base');
  expect(cacheNames).not.toContain('smart-todos-precache-obsolete');
});
