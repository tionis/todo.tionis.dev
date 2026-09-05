import { parentPort } from "node:worker_threads";
import * as Automerge from "@automerge/automerge";
import { deleteClassifierHistoryThrough, validateListDocument } from "./document-validation.mjs";

const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_EXPANDED_JSON_BYTES = 4_000_000;

function validate(document) {
  if (Buffer.byteLength(JSON.stringify(document)) > MAX_EXPANDED_JSON_BYTES) {
    throw new Error("Automerge document expands beyond the safe limit");
  }
  validateListDocument(document);
}

function load(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("Automerge document is too large");
  }
  const document = Automerge.load(bytes);
  try {
    validate(document);
    return document;
  } catch (error) {
    Automerge.free(document);
    throw error;
  }
}

parentPort.on("message", ({ action, currentBytes, incomingBytes, resetAt }) => {
  let current;
  let incoming;
  try {
    let document;
    if (action === "merge") {
      current = load(currentBytes);
      incoming = load(incomingBytes);
      document = Automerge.merge(current, incoming);
    } else if (action === "reset") {
      current = load(currentBytes);
      document = Automerge.change(current, (draft) => deleteClassifierHistoryThrough(draft, resetAt));
    } else if (action === "create") {
      incoming = incomingBytes ? load(incomingBytes) : Automerge.from({
        schemaVersion: 1, todos: {}, categories: {}, classifierHistory: {},
      });
      document = incoming;
    } else {
      throw new Error("Unsupported document operation");
    }
    validate(document);
    const bytes = Automerge.save(document);
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("Automerge document is too large");
    parentPort.postMessage({ bytes }, [bytes.buffer]);
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : "Invalid Automerge document" });
  } finally {
    // merge/change reuse the current document's native handle. Free each loaded
    // handle once, including failures; V8 heap pressure does not track WASM use.
    if (current) Automerge.free(current);
    if (incoming) Automerge.free(incoming);
  }
});
