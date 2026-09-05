// Synthetic backend-only comparison; run on the same Node version and machine.
// --idle includes the 30-second worker retirement period. This is not a measure
// of the complete service cgroup (HTTP, SQLite, health checks, and page cache).
import fs from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { once } from "node:events";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = await fs.mkdtemp("/tmp/todo-memory-");
let store;
function report(phase) {
  const memory = process.memoryUsage();
  console.log(JSON.stringify({
    phase,
    rssMiB: memory.rss / 2 ** 20,
    heapMiB: memory.heapUsed / 2 ** 20,
    externalMiB: memory.external / 2 ** 20,
    peakMiB: process.resourceUsage().maxRSS / 1024,
  }));
}

try {
  // Generate in another process so fixture construction cannot inflate the
  // measured server's JS/WASM heap. All list contents are invented.
  const fixture = pathToFileURL(`${directory}/fixture`).pathname;
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    import * as Automerge from "@automerge/automerge";
    import fs from "node:fs";
    const todos = {};
    for (let i = 0; i < 200; i++) {
      todos["item" + i] = { id: "item" + i, text: "Invented grocery item " + i, done: false, order: i };
    }
    const document = Automerge.from({ schemaVersion: 1, todos, categories: {}, classifierHistory: {} });
    fs.writeFileSync(process.argv[1], Automerge.save(document));
  `, fixture], { cwd: root });
  const bytes = new Uint8Array(await fs.readFile(fixture));
  const { DocumentStore } = await import(pathToFileURL(`${root}/backend/documents.mjs`));
  store = new DocumentStore(directory);
  await store.initialize();
  report("startup");
  const start = performance.now();
  for (let i = 0; i < 100; i++) await store.create(`synthetic-${i}`, bytes);
  report("100 lists");
  for (let i = 0; i < 300; i++) await store.merge("synthetic-0", bytes);
  report("300 merges");
  console.log(JSON.stringify({ durationSeconds: (performance.now() - start) / 1000 }));
  if (global.gc) {
    global.gc();
    await new Promise((resolve) => setTimeout(resolve, 100));
    global.gc();
    report("after main GC");
  }
  if (process.argv.includes("--idle") && store.processor.worker) {
    const timeout = setTimeout(() => {}, 35_000);
    try {
      await once(store.processor.worker, "exit");
      report("after idle retirement");
    } finally {
      clearTimeout(timeout);
    }
  }
} finally {
  await store?.processor.worker?.terminate();
  await fs.rm(directory, { recursive: true, force: true });
}
