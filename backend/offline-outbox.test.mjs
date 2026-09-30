import assert from "node:assert/strict";
import test from "node:test";
import { deliveryDisposition, orderedPendingCommands, summarizeOutbox, supersededDocumentUploads } from "../shared/offline-outbox.mjs";

test("retries transient delivery failures but surfaces authoritative rejection", () => {
  assert.equal(deliveryDisposition(new TypeError("network unavailable")), "retry");
  assert.equal(deliveryDisposition({ status: 401 }), "retry");
  assert.equal(deliveryDisposition({ status: 503 }), "retry");
  assert.equal(deliveryDisposition({ status: 403 }), "reject");
  assert.equal(deliveryDisposition({ status: 409 }), "reject");
});

test("orders pending commands durably and reports rejected work", () => {
  const commands = [
    { id: "b", createdAt: "2026-01-02", status: "pending" },
    { id: "rejected", createdAt: "2026-01-01", status: "rejected" },
    { id: "a", createdAt: "2026-01-01", status: "pending" },
  ];
  assert.deepEqual(orderedPendingCommands(commands).map((command) => command.id), ["a", "b"]);
  assert.deepEqual(summarizeOutbox(commands, true), { pending: 2, rejected: 1, syncing: true });
});

test("a newer document upload supersedes older pending uploads of the same list only", () => {
  const upload = (id, listId, status = "pending") => ({ id, listId, status, method: "POST", path: `/api/lists/${listId}/document` });
  const commands = [
    upload("old-1", "list-a"),
    upload("old-2", "list-a"),
    upload("other-list", "list-b"),
    upload("rejected", "list-a", "rejected"),
    { id: "rename", listId: "list-a", status: "pending", method: "PATCH", path: "/api/lists/list-a" },
  ];
  assert.deepEqual(supersededDocumentUploads(commands, upload("new", "list-a")), ["old-1", "old-2"]);
});
