import assert from "node:assert/strict";
import test from "node:test";
import { runTransactionPhases } from "../shared/transaction-phases.mjs";

test("authoritative metadata failure prevents local content from being partially applied", async () => {
  const calls = [];
  await assert.rejects(() => runTransactionPhases([
    async () => { calls.push("metadata"); throw new Error("server rejected update"); },
    async () => { calls.push("content"); },
  ]), /server rejected/);
  assert.deepEqual(calls, ["metadata"]);

  await runTransactionPhases([
    async () => { calls.push("metadata-retry"); },
    async () => { calls.push("content-retry"); },
  ]);
  assert.deepEqual(calls, ["metadata", "metadata-retry", "content-retry"]);
});
