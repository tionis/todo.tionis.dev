import http from "node:http";
import path from "node:path";
import * as Automerge from "@automerge/automerge";
import { chromium } from "@playwright/test";
import { serveStatic } from "../backend/static.mjs";

const staticDir = path.resolve("out");
const user = { id: "demo-user", name: "Alex", email: "alex@example.com" };
const now = "2026-08-24T10:00:00.000Z";
const list = {
  id: "demo-list",
  name: "Saturday groceries",
  slug: "saturday-groceries",
  permission: "private-write",
  tags: "weekly, groceries",
  hideCompleted: false,
  autoSortTodos: true,
  classifierAggressiveness: "normal",
  classifierResetAt: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
  owner: user,
  members: [],
  groupGrants: [],
  pins: [],
  access: { read: true, write: true, owner: true, member: false },
};
const document = Automerge.from({
  schemaVersion: 1,
  categories: {
    produce: { id: "produce", name: "Produce", order: 1, createdAt: now, updatedAt: now },
    household: { id: "household", name: "Household", order: 2, createdAt: now, updatedAt: now },
  },
  todos: {
    lemons: { id: "lemons", text: "Lemons", done: false, order: 1, categoryId: "produce", createdAt: now, updatedAt: now },
    basil: { id: "basil", text: "Fresh basil", done: false, order: 2, categoryId: "produce", createdAt: now, updatedAt: now },
    soap: { id: "soap", text: "Dish soap", done: true, order: 3, categoryId: "household", createdAt: now, updatedAt: now },
  },
  classifierHistory: {},
});
const serializedDocument = Buffer.from(Automerge.save(document)).toString("base64");

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (!await serveStatic(request, response, url, staticDir)) response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch();
try {
  for (const shot of [
    { filename: "screenshot-desktop.png", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    { filename: "screenshot-mobile.png", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  ]) {
    const context = await browser.newContext({ viewport: shot.viewport, deviceScaleFactor: shot.deviceScaleFactor });
    await context.addInitScript(() => {
      Object.defineProperties(navigator.storage, {
        persisted: { configurable: true, value: async () => true },
        estimate: { configurable: true, value: async () => ({ usage: 1, quota: 1_000_000 }) },
      });
    });
    const page = await context.newPage();
    await page.route("**/api/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/auth/session") return route.fulfill({ json: { user } });
      if (pathname === "/api/lists") return route.fulfill({ json: { lists: [list] } });
      if (pathname === "/api/lists/demo-list") return route.fulfill({ json: { list, document: serializedDocument } });
      if (pathname === "/api/lists/demo-list/share-targets") return route.fulfill({ json: { users: [], groups: [] } });
      return route.fulfill({ status: 404, json: { error: "not_found" } });
    });
    await page.goto(origin);
    await page.getByRole("heading", { name: "Your Todo Lists" }).waitFor();
    await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
    await page.screenshot({ path: path.join("public", shot.filename) });
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
