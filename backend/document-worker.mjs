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

// Every Automerge document or change chunk starts with these four bytes. loadIncremental
// silently ignores data it cannot parse, so reject anything else up front.
const AUTOMERGE_MAGIC = [0x85, 0x6f, 0x4a, 0x83];

function assertAutomergeChunk(bytes) {
  if (!AUTOMERGE_MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new Error("Not an Automerge document or change");
  }
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
  let headsBefore;
  try {
    let document;
    if (action === "merge") {
      current = load(currentBytes);
      // loadIncremental takes a full document or a change chunk (saveSince); the merged result is validated below.
      if (!(incomingBytes instanceof Uint8Array) || incomingBytes.byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error("Automerge document is too large");
      }
      assertAutomergeChunk(incomingBytes);
      headsBefore = Automerge.getHeads(current);
      document = Automerge.loadIncremental(current, incomingBytes);
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
    if (headsBefore) {
      const delta = Automerge.saveSince(document, headsBefore);
      const heads = Automerge.getHeads(document);
      parentPort.postMessage({ bytes, delta, heads }, [bytes.buffer, delta.buffer]);
    } else {
      parentPort.postMessage({ bytes }, [bytes.buffer]);
    }
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : "Invalid Automerge document" });
  } finally {
    // merge/change reuse the current document's native handle. Free each loaded
    // handle once, including failures; V8 heap pressure does not track WASM use.
    if (current) Automerge.free(current);
    if (incoming) Automerge.free(incoming);
  }
});
