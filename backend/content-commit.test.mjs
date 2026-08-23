import assert from "node:assert/strict";
import test from "node:test";
import { commitPersistedDocument } from "../shared/content-commit.mjs";

test("persistence failure leaves the visible document unchanged", async () => {
  let current = { version: "old" };
  await assert.rejects(() => commitPersistedDocument({
    document: { version: "new" },
    persist: async () => { throw new Error("quota exceeded"); },
    commit: (document) => { current = document; },
  }), /quota exceeded/);
  assert.equal(current.version, "old");
});

test("transport failure keeps the durable offline edit and schedules recovery", async () => {
  let durable;
  let current;
  let recovered = false;
  await commitPersistedDocument({
    document: { version: "new" },
    persist: async (document) => { durable = document; },
    commit: (document) => { current = document; },
    publish: () => { throw new Error("socket closed"); },
    recoverPublish: () => { recovered = true; },
  });
  assert.equal(durable.version, "new");
  assert.equal(current.version, "new");
  assert.equal(recovered, true);
});
