import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as Automerge from "@automerge/automerge";
import { DocumentStore, emptyListDocument, MAX_DOCUMENT_BYTES, validateListDocument } from "./documents.mjs";

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
    const merged = await reloadedStore.load("list-1");
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
    assert.equal((await store.load("valid")).schemaVersion, 1);
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
      store.change("list-1", (document) => {
        for (const id of Object.keys(document.classifierHistory)) delete document.classifierHistory[id];
      }),
      store.merge("list-1", Automerge.save(collaborator)),
    ]);

    const result = await store.load("list-1");
    assert.deepEqual(Object.keys(result.classifierHistory), []);
    assert.equal(result.todos.bread.text, "Bread");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
