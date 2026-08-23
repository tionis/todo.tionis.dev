import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as Automerge from "@automerge/automerge";
import { DocumentStore, emptyListDocument, validateListDocument } from "./documents.mjs";

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
