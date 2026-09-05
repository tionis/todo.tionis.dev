import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as Automerge from "@automerge/automerge";
import { DocumentStore, MAX_DOCUMENT_BYTES } from "./documents.mjs";
import { deleteClassifierHistoryThrough, validateListDocument } from "./document-validation.mjs";
function emptyListDocument() {
  return Automerge.from({ schemaVersion: 1, todos: {}, categories: {}, classifierHistory: {} });
}

test("persists and merges concurrent offline list edits", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-documents-"));
  try {
    const store = new DocumentStore(directory);
    await store.initialize();
    const initial = emptyListDocument();
    await store.create("list-1", Automerge.save(initial));

    const alice = Automerge.change(Automerge.clone(initial), (document) => {
      document.todos.alice = { id: "alice", text: "Milk", done: false, order: 1 };
    });
    const bob = Automerge.change(Automerge.clone(initial), (document) => {
      document.categories.shop = { id: "shop", name: "Shop", order: 1 };
    });
    await store.merge("list-1", Automerge.save(alice));
    await store.merge("list-1", Automerge.save(bob));

    const reloadedStore = new DocumentStore(directory);
    await reloadedStore.initialize();
    const merged = Automerge.load(await reloadedStore.load("list-1"));
    assert.equal(merged.todos.alice.text, "Milk");
    assert.equal(merged.categories.shop.name, "Shop");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("rejects malformed documents before persistence", () => {
  const invalid = Automerge.from({ schemaVersion: 1, todos: [], categories: {}, classifierHistory: {} });
  assert.throws(() => validateListDocument(invalid), /todos must be an object/);
});

test("rejects malformed initial documents before persistence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-documents-"));
  try {
    const store = new DocumentStore(directory);
    await store.initialize();
    const invalid = Automerge.from({ schemaVersion: 1, todos: {} });
    await assert.rejects(() => store.create("list-1", Automerge.save(invalid)), /categories must be an object/);
    await assert.rejects(() => fs.access(store.filename("list-1")), { code: "ENOENT" });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("rejects unsupported nested document data", () => {
  const invalid = Automerge.from({
    schemaVersion: 1,
    todos: { item: { id: "item", text: "Milk", done: false, nested: { expensive: true } } },
    categories: {},
    classifierHistory: {},
  });
  assert.throws(() => validateListDocument(invalid), /nested is not supported/);
});

test("rejects oversized Automerge input before parsing", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-documents-"));
  try {
    const store = new DocumentStore(directory);
    await store.initialize();
    await assert.rejects(() => store.create("list-1", new Uint8Array(MAX_DOCUMENT_BYTES + 1)), /too large/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("isolates malformed parsing and continues processing valid documents", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-documents-"));
  try {
    const store = new DocumentStore(directory);
    await store.initialize();
    await assert.rejects(() => store.create("invalid", new Uint8Array([1, 2, 3, 4])));
    await store.create("valid", Automerge.save(emptyListDocument()));
    assert.equal(Automerge.load(await store.load("valid")).schemaVersion, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("serializes classifier resets with concurrent document merges", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-documents-"));
  try {
    const store = new DocumentStore(directory);
    await store.initialize();
    const initial = Automerge.from({
      schemaVersion: 1,
      todos: {},
      categories: {},
      classifierHistory: {
        sample: {
          id: "sample",
          text: "Milk",
          normalizedText: "milk",
          source: "checked",
        },
      },
    });
    await store.create("list-1", Automerge.save(initial));
    const collaborator = Automerge.change(Automerge.clone(initial), (document) => {
      document.todos.bread = { id: "bread", text: "Bread", done: false, order: 1 };
    });

    await Promise.all([
      store.resetClassifierHistory("list-1", "2026-01-02T00:00:00.000Z"),
      store.merge("list-1", Automerge.save(collaborator)),
    ]);

    const result = Automerge.load(await store.load("list-1"));
    assert.deepEqual(Object.keys(result.classifierHistory), []);
    assert.equal(result.todos.bread.text, "Bread");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("offline classifier reset preserves samples created after its reset epoch", () => {
  const document = {
    classifierHistory: {
      old: { id: "old", createdAt: "2026-01-01T00:00:00.000Z" },
      undated: { id: "undated" },
      new: { id: "new", createdAt: "2026-01-03T00:00:00.000Z" },
    },
  };
  deleteClassifierHistoryThrough(document, "2026-01-02T00:00:00.000Z");
  assert.deepEqual(Object.keys(document.classifierHistory), ["new"]);
});

test("evicts serialized cache entries and reloads all edits from disk", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-cache-"));
  const store = new DocumentStore(directory);
  try {
    await store.initialize();
    for (let i = 0; i < 24; i++) {
      const document = Automerge.from({
        schemaVersion: 1, todos: { item: { id: "item", text: `Invented item ${i}`, done: false } },
        categories: {}, classifierHistory: {},
      });
      await store.create(`list-${i}`, Automerge.save(document));
      Automerge.free(document);
    }
    assert.ok(store.cache.size < 24);
    assert.ok([...store.cache.values()].every((entry) => entry instanceof Uint8Array));
    const reloaded = Automerge.load(await store.load("list-0"));
    assert.equal(reloaded.todos.item.text, "Invented item 0");
    Automerge.free(reloaded);
    await store.delete("list-0");
    assert.deepEqual(Automerge.load(await store.load("list-0")).todos, {});
  } finally {
    await store.processor.worker?.terminate();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("bounds retained uploads while a list operation is blocked and recovers capacity", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-queue-"));
  const store = new DocumentStore(directory);
  let unblock;
  const gate = new Promise((resolve) => { unblock = resolve; });
  const blocked = store.enqueue("list-1", () => gate);
  try {
    await store.initialize();
    const uploads = [];
    for (let i = 0; i < 4; i++) {
      uploads.push(store.merge("list-1", new Uint8Array(MAX_DOCUMENT_BYTES)).catch(() => {}));
    }
    await assert.rejects(store.merge("list-1", new Uint8Array(MAX_DOCUMENT_BYTES)), /busy/);
    unblock();
    await Promise.all([blocked, ...uploads]);
    await store.create("valid");
    assert.equal(Automerge.load(await store.load("valid")).schemaVersion, 1);
    assert.equal(store.pendingBytes, 0);
  } finally {
    unblock();
    await store.processor.worker?.terminate();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("invalid merged schema leaves the durable document intact", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-invalid-merge-"));
  const store = new DocumentStore(directory);
  try {
    await store.initialize();
    const initial = await store.create("list-1");
    const invalid = Automerge.change(Automerge.load(initial), (draft) => { draft.todos = []; });
    await assert.rejects(store.merge("list-1", Automerge.save(invalid)), /todos must be an object/);
    assert.deepEqual(new Uint8Array(await fs.readFile(store.filename("list-1"))), initial);
    await store.merge("list-1", initial);
    assert.equal(Automerge.load(await store.load("list-1")).schemaVersion, 1);
    Automerge.free(invalid);
  } finally {
    await store.processor.worker?.terminate();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
