import fs from "node:fs/promises";
import path from "node:path";
import { DocumentProcessor } from "./document-processor.mjs";

export const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_CACHE_BYTES = 4_000_000;
const MAX_CACHE_ENTRIES = 16;
const MAX_PENDING_BYTES = 8_000_000;
const MAX_PENDING_OPERATIONS = 100;

function assertDocumentBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("Automerge document is too large");
  }
}

// Only serialized documents cross this boundary. The worker owns all decoded
// Automerge handles, so the HTTP process never needs a second WASM runtime.
export class DocumentStore {
  constructor(dataDir) {
    this.directory = path.join(dataDir, "documents");
    this.cache = new Map();
    this.cacheBytes = 0;
    this.queues = new Map();
    this.pendingBytes = 0;
    this.pendingOperations = 0;
    this.processor = new DocumentProcessor();
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  filename(listId) {
    if (!/^[a-zA-Z0-9-]+$/.test(listId)) throw new Error("Invalid list id");
    return path.join(this.directory, `${listId}.automerge`);
  }

  forget(listId) {
    const bytes = this.cache.get(listId);
    if (bytes) this.cacheBytes -= bytes.byteLength;
    this.cache.delete(listId);
  }

  remember(listId, bytes) {
    this.forget(listId);
    this.cache.set(listId, bytes);
    this.cacheBytes += bytes.byteLength;
    while (this.cache.size > MAX_CACHE_ENTRIES || this.cacheBytes > MAX_CACHE_BYTES) {
      this.forget(this.cache.keys().next().value);
    }
  }

  load(listId) {
    return this.enqueue(listId, () => this.read(listId));
  }

  async read(listId) {
    const cached = this.cache.get(listId);
    if (cached) {
      this.remember(listId, cached);
      return cached;
    }
    let bytes;
    try {
      bytes = await fs.readFile(this.filename(listId));
      assertDocumentBytes(bytes);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const serialized = await this.processor.process("create", undefined, bytes);
    this.remember(listId, serialized);
    return serialized;
  }

  async save(listId, bytes) {
    assertDocumentBytes(bytes);
    const filename = this.filename(listId);
    const temporary = `${filename}.${process.pid}.tmp`;
    await fs.writeFile(temporary, bytes, { mode: 0o600 });
    await fs.rename(temporary, filename);
    this.remember(listId, bytes);
  }

  async merge(listId, bytes) {
    assertDocumentBytes(bytes);
    return this.enqueue(listId, async () => {
      const current = await this.read(listId);
      const merged = await this.processor.process("merge", current, bytes);
      await this.save(listId, merged);
      return merged;
    }, bytes.byteLength);
  }

  async create(listId, bytes) {
    if (bytes) assertDocumentBytes(bytes);
    return this.enqueue(listId, async () => {
      const serialized = await this.processor.process("create", undefined, bytes);
      await this.save(listId, serialized);
      return serialized;
    }, bytes?.byteLength ?? 0);
  }

  async resetClassifierHistory(listId, resetAt) {
    return this.enqueue(listId, async () => {
      const document = await this.processor.process("reset", await this.read(listId), undefined, resetAt);
      await this.save(listId, document);
      return document;
    });
  }

  async delete(listId) {
    return this.enqueue(listId, async () => {
      this.forget(listId);
      try {
        await fs.unlink(this.filename(listId));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    });
  }

  enqueue(listId, operation, retainedBytes = 0) {
    if (this.pendingOperations >= MAX_PENDING_OPERATIONS || this.pendingBytes + retainedBytes > MAX_PENDING_BYTES) {
      return Promise.reject(Object.assign(new Error("Document store is busy"), { status: 503 }));
    }
    this.pendingOperations += 1;
    this.pendingBytes += retainedBytes;
    const previous = this.queues.get(listId) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.queues.set(listId, next);
    return next.finally(() => {
      this.pendingOperations -= 1;
      this.pendingBytes -= retainedBytes;
      if (this.queues.get(listId) === next) this.queues.delete(listId);
    });
  }
}
