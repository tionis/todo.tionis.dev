import type { QueuedRequest } from "./db-types";

// IndexedDB access for cached list documents and the offline outbox. The service worker
// (public/sw.js) opens the same database, so keep the name, version and stores in sync.
const DATABASE_NAME = "smart-todos-automerge";
const DATABASE_VERSION = 2;

const available = () => typeof indexedDB !== "undefined";

export function openDocumentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("documents")) request.result.createObjectStore("documents");
      if (!request.result.objectStoreNames.contains("outbox")) request.result.createObjectStore("outbox", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Runs `operation` on one object store and always closes the database afterwards.
async function withStore<T>(stores: string | string[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => IDBRequest<T> | Promise<T>): Promise<T> {
  const database = await openDocumentDatabase();
  try {
    const transaction = database.transaction(stores, mode);
    const result = operation(transaction);
    if (!(result instanceof IDBRequest)) return await result;
    return await new Promise<T>((resolve, reject) => {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    });
  } finally {
    database.close();
  }
}

export async function readOutboxCommands(userId: string): Promise<QueuedRequest[]> {
  if (!available()) return [];
  const commands = await withStore("outbox", "readonly", (transaction) => transaction.objectStore("outbox").getAll() as IDBRequest<QueuedRequest[]>);
  return commands.filter((command) => command.userId === userId);
}

export async function putOutboxCommand(command: QueuedRequest) {
  if (!available()) return;
  await withStore("outbox", "readwrite", (transaction) => transaction.objectStore("outbox").put(command));
}

export async function deleteOutboxCommand(id: string) {
  if (!available()) return;
  await withStore("outbox", "readwrite", (transaction) => transaction.objectStore("outbox").delete(id));
}

/** Stores the document and its upload command in one transaction, so neither exists without the other. */
export async function putDocumentWithCommand(documentKey: string, bytes: Uint8Array, command: QueuedRequest) {
  const database = await openDocumentDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["documents", "outbox"], "readwrite");
      transaction.objectStore("documents").put(bytes, documentKey);
      transaction.objectStore("outbox").put(command);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function readDocumentBytes(documentKey: string): Promise<Uint8Array | undefined> {
  if (!available()) return undefined;
  const stored = await withStore("documents", "readonly", (transaction) => transaction.objectStore("documents").get(documentKey));
  return stored ? new Uint8Array(stored) : undefined;
}

export async function writeDocumentBytes(documentKey: string, bytes: Uint8Array) {
  if (!available()) return;
  await withStore("documents", "readwrite", (transaction) => transaction.objectStore("documents").put(bytes, documentKey));
}

export async function deleteDocumentBytes(documentKey: string) {
  if (!available()) return;
  await withStore("documents", "readwrite", (transaction) => transaction.objectStore("documents").delete(documentKey));
}

/** Removes every cached document and queued command (used on sign-out). */
export async function clearAllStoredData() {
  if (!available()) return;
  await withStore(["documents", "outbox"], "readwrite", (transaction) => {
    transaction.objectStore("documents").clear();
    return transaction.objectStore("outbox").clear();
  });
}
