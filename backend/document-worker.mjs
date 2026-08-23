import { parentPort } from "node:worker_threads";
import * as Automerge from "@automerge/automerge";

const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_EXPANDED_JSON_BYTES = 4_000_000;

function load(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("Automerge document is too large");
  }
  const document = Automerge.load(bytes);
  if (Buffer.byteLength(JSON.stringify(document)) > MAX_EXPANDED_JSON_BYTES) {
    throw new Error("Automerge document expands beyond the safe limit");
  }
  return document;
}

parentPort.on("message", ({ action, currentBytes, incomingBytes }) => {
  try {
    const incoming = load(incomingBytes);
    const document = action === "merge" ? Automerge.merge(load(currentBytes), incoming) : incoming;
    if (Buffer.byteLength(JSON.stringify(document)) > MAX_EXPANDED_JSON_BYTES) {
      throw new Error("Merged Automerge document expands beyond the safe limit");
    }
    const bytes = Automerge.save(document);
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("Automerge document is too large");
    parentPort.postMessage({ bytes }, [bytes.buffer]);
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : "Invalid Automerge document" });
  }
});
