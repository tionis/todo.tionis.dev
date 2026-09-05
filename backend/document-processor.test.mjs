import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { DocumentProcessor } from "./document-processor.mjs";

test("releases an idle worker and starts another for the next document", { timeout: 5_000 }, async () => {
  const processor = new DocumentProcessor({ idleTimeoutMs: 20 });
  try {
    const bytes = await processor.process("create");
    const worker = processor.worker;
    await once(worker, "exit");
    assert.equal(processor.worker, null);
    const roundTrip = await processor.process("create", undefined, bytes);
    assert.deepEqual(roundTrip, bytes);
    assert.notEqual(processor.worker, worker);
  } finally {
    await processor.worker?.terminate();
  }
});

test("queued merges retain their worker until all operations complete", async () => {
  const processor = new DocumentProcessor({ idleTimeoutMs: 1 });
  try {
    const bytes = await processor.process("create");
    const results = await Promise.all(Array.from({ length: 20 }, () => processor.process("merge", bytes, bytes)));
    for (const result of results) assert.deepEqual(result, bytes);
  } finally {
    await processor.worker?.terminate();
  }
});
