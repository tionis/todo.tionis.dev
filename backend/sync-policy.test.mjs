import assert from "node:assert/strict";
import test from "node:test";
import * as Automerge from "@automerge/automerge";
import { reconcileRemoteDocument } from "../shared/sync-policy.mjs";

function initialDocument() {
  return Automerge.from({ schemaVersion: 1, todos: {}, categories: {}, classifierHistory: {} });
}

test("reconnect merges offline and concurrent remote edits and uploads the merged document", () => {
  const initial = initialDocument();
  const base = Automerge.save(initial);
  const local = Automerge.change(Automerge.load(base), (document) => {
    document.todos.milk = { id: "milk", text: "Milk", done: false, order: 1 };
  });
  const remote = Automerge.change(Automerge.load(base), (document) => {
    document.categories.dairy = { id: "dairy", name: "Dairy", order: 1 };
  });

  const result = reconcileRemoteDocument(Automerge, local, remote, "write");
  assert.equal(result.document.todos.milk.text, "Milk");
  assert.equal(result.document.categories.dairy.name, "Dairy");
  assert.equal(result.shouldUpload, true);

  const acknowledged = reconcileRemoteDocument(Automerge, result.document, result.document, "write");
  assert.equal(acknowledged.shouldUpload, false);
});

test("read-only reconnect discards unsynchronized local changes", () => {
  const initial = initialDocument();
  const base = Automerge.save(initial);
  const local = Automerge.change(Automerge.load(base), (document) => {
    document.todos.local = { id: "local", text: "Not authorized", done: false, order: 1 };
  });
  const remote = Automerge.change(Automerge.load(base), (document) => {
    document.todos.server = { id: "server", text: "Server", done: false, order: 1 };
  });

  const result = reconcileRemoteDocument(Automerge, local, remote, "read");
  assert.equal(result.document.todos.local, undefined);
  assert.equal(result.document.todos.server.text, "Server");
  assert.equal(result.shouldUpload, false);
});
