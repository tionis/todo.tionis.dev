import assert from "node:assert/strict";
import test from "node:test";
import * as Automerge from "@automerge/automerge";
import { applySyncFrame, syncPayload } from "../shared/delta-sync.mjs";

const base = () => Automerge.from({ schemaVersion: 1, todos: {}, categories: {}, classifierHistory: {} });
const add = (document, key) => Automerge.change(document, (draft) => { draft.todos[key] = { id: key, text: key, done: false }; });
const delta = (before, after) => Automerge.saveSince(after, Automerge.getHeads(before));

test("a delta on top of the full document applies without an upload", () => {
  const server0 = base();
  const first = applySyncFrame(Automerge, undefined, { kind: "full", bytes: Automerge.save(server0) }, "write");
  const server1 = add(Automerge.load(Automerge.save(server0)), "milk");
  const second = applySyncFrame(Automerge, first.document, {
    kind: "delta", bytes: delta(server0, server1), heads: Automerge.getHeads(server1),
  }, "write");
  assert.equal(second.document.todos.milk.text, "milk");
  assert.equal(second.shouldUpload, false);
  assert.deepEqual(second.serverHeads, Automerge.getHeads(server1));
});

test("an empty delta acknowledges without changing the document", () => {
  const document = add(base(), "eggs");
  const result = applySyncFrame(Automerge, document, { kind: "delta", bytes: undefined, heads: Automerge.getHeads(document) }, "write");
  assert.equal(result.document.todos.eggs.text, "eggs");
  assert.equal(result.shouldUpload, false);
});

test("local changes the server has not seen are flagged for upload", () => {
  const shared = base();
  const server = add(Automerge.load(Automerge.save(shared)), "bread");
  const local = add(Automerge.load(Automerge.save(shared)), "butter");
  const result = applySyncFrame(Automerge, local, {
    kind: "delta", bytes: delta(shared, server), heads: Automerge.getHeads(server),
  }, "write");
  assert.ok(result.document.todos.bread && result.document.todos.butter);
  assert.equal(result.shouldUpload, true);

  const upload = syncPayload(Automerge, result.document, result.serverHeads);
  const applied = Automerge.loadIncremental(Automerge.load(Automerge.save(server)), upload);
  assert.ok(applied.todos.butter);
  assert.ok(upload.byteLength < Automerge.save(result.document).byteLength);
});

test("read-only clients never upload", () => {
  const shared = base();
  const server = add(Automerge.load(Automerge.save(shared)), "tea");
  const result = applySyncFrame(Automerge, shared, { kind: "delta", bytes: delta(shared, server), heads: ["someone-else"] }, "read");
  assert.equal(result.shouldUpload, false);
});

test("a delta that arrives before the full document is held until its base arrives", () => {
  const server0 = base();
  const server1 = add(Automerge.load(Automerge.save(server0)), "jam");
  const early = applySyncFrame(Automerge, undefined, {
    kind: "delta", bytes: delta(server0, server1), heads: Automerge.getHeads(server1),
  }, "write");
  assert.deepEqual(early.document.todos ?? {}, {});

  const full = applySyncFrame(Automerge, early.document, { kind: "full", bytes: Automerge.save(server1) }, "write");
  assert.equal(full.document.todos.jam.text, "jam");
  assert.equal(full.shouldUpload, false);
});

test("replaying a delta is harmless", () => {
  const server0 = base();
  const server1 = add(Automerge.load(Automerge.save(server0)), "rice");
  const frame = { kind: "delta", bytes: delta(server0, server1), heads: Automerge.getHeads(server1) };
  const once = applySyncFrame(Automerge, Automerge.load(Automerge.save(server0)), frame, "write");
  const twice = applySyncFrame(Automerge, once.document, frame, "write");
  assert.deepEqual(Object.keys(twice.document.todos), ["rice"]);
  assert.equal(twice.shouldUpload, false);
});

test("unknown server heads fall back to a full upload", () => {
  const document = add(base(), "salt");
  assert.deepEqual(syncPayload(Automerge, document, ["not-a-head"]), Automerge.save(document));
});
