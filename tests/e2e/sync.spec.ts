import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4174';

interface Frames { text: string[]; binary: number[] }

async function openList(context: BrowserContext, token: string) {
  await context.addCookies([{ name: 'smart_todos_session', value: token, url: ORIGIN }]);
  const page = await context.newPage();
  const frames: Frames = { text: [], binary: [] };
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/sync')) return;
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') frames.text.push(payload);
      else frames.binary.push(payload.length);
    });
  });
  await page.goto('/#/list/shared');
  await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();
  await expect.poll(() => frames.binary.length).toBeGreaterThan(0);
  return { page, frames, messages };
}

async function addTodo(page: Page, text: string) {
  const input = page.getByPlaceholder('What needs to be done?');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByText(text, { exact: true })).toBeVisible();
}

test('edits reach other members as small deltas after one full document', async ({ browser }) => {
  const alice = await openList(await browser.newContext(), 'alice-e2e-session');
  const bob = await openList(await browser.newContext(), 'bob-e2e-session');
  const framesBefore = bob.frames.binary.length;

  await addTodo(alice.page, 'Oat milk');
  await expect(bob.page.getByText('Oat milk', { exact: true })).toBeVisible();

  const deltas = bob.frames.text.map((text) => JSON.parse(text)).filter((message) => message.type === 'delta');
  expect(deltas.length).toBeGreaterThan(0);
  expect(deltas.some((message) => message.size > 0)).toBe(true);
  const newFrames = bob.frames.binary.slice(framesBefore);
  expect(newFrames.length).toBeGreaterThan(0);
  // A delta carries only the new changes, so it is smaller than the whole document now.
  const fullDocumentBytes = await bob.page.evaluate(async () => {
    const list = await (await fetch('/api/lists/shared', { credentials: 'include' })).json();
    return atob(list.document).length;
  });
  for (const size of newFrames) expect(size).toBeLessThan(fullDocumentBytes);

  await addTodo(bob.page, 'Rye bread');
  await expect(alice.page.getByText('Rye bread', { exact: true })).toBeVisible();
  await expect(alice.page.getByText('Oat milk', { exact: true })).toBeVisible();
});

test('changes made offline merge and reach the other member after reconnecting', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const alice = await openList(aliceContext, 'alice-e2e-session');
  const bob = await openList(await browser.newContext(), 'bob-e2e-session');

  await aliceContext.setOffline(true);
  await addTodo(alice.page, 'Offline apples');
  await addTodo(alice.page, 'Offline plums');
  // Both edits are in one queued upload: the newer full document supersedes the older command.
  const queuedUploads = await alice.page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('smart-todos-automerge', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const commands = await new Promise<Array<{ path: string; status: string }>>((resolve, reject) => {
      const request = database.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return commands.filter((command) => command.path.endsWith('/document') && command.status === 'pending').length;
  });
  expect(queuedUploads).toBe(1);
  await addTodo(bob.page, 'Online pears');
  await expect(bob.page.getByText('Offline apples', { exact: true })).toHaveCount(0);

  await aliceContext.setOffline(false);
  await expect(bob.page.getByText('Offline apples', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(bob.page.getByText('Offline plums', { exact: true })).toBeVisible();
  await expect(alice.page.getByText('Online pears', { exact: true })).toBeVisible({ timeout: 20_000 });
});

test('the served pages run without any Content-Security-Policy violation', async ({ browser }) => {
  const alice = await openList(await browser.newContext(), 'alice-e2e-session');
  await addTodo(alice.page, 'CSP check');
  // Exercise the settings panel and the share dialog too: they render the most dynamic markup.
  await alice.page.getByRole('button', { name: 'Share' }).locator('visible=true').first().click();
  await expect(alice.page.getByPlaceholder('Search name, @username, group, or email')).toBeVisible();
  await alice.page.keyboard.press('Escape');
  await alice.page.getByRole('button', { name: 'Settings' }).locator('visible=true').first().click();
  await expect(alice.page.getByText('Classifier', { exact: false }).first()).toBeVisible();
  const violations = alice.messages.filter((message) => /Content.Security.Policy|Refused to/i.test(message));
  expect(violations).toEqual([]);
  expect(alice.messages.filter((message) => message.startsWith('pageerror'))).toEqual([]);
});

test('signing out can end the sessions on every device', async ({ browser, request }) => {
  const context = await browser.newContext();
  await context.addCookies([{ name: 'smart_todos_session', value: 'carol-first-session', url: ORIGIN }]);
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign Out' }).locator('visible=true').first().click();
  const dialog = page.getByRole('heading', { name: 'Sign out?' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Also sign out on all my other devices').check();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign In to Get Started' })).toBeVisible();

  const other = await request.get('/api/auth/session', { headers: { Cookie: 'smart_todos_session=carol-second-session' } });
  expect((await other.json()).user).toBeNull();
});
