import fs from "node:fs/promises";
import path from "node:path";
import * as Automerge from "@automerge/automerge";

const MAX_ITEMS = 50_000;
const MAX_TEXT = 20_000;

export function emptyListDocument() {
  return Automerge.from({
    schemaVersion: 1,
    todos: {},
    categories: {},
    classifierHistory: {},
  });
}

function assertRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  if (Object.keys(value).length > MAX_ITEMS) throw new Error(`${field} contains too many records`);
}

function assertString(value, field, optional = false) {
  if (optional && (value === undefined || value === null)) return;
  if (typeof value !== "string" || value.length > MAX_TEXT) throw new Error(`${field} is invalid`);
}

export function validateListDocument(document) {
  if (document.schemaVersion !== 1) throw new Error("Unsupported list document version");
  assertRecord(document.todos, "todos");
  assertRecord(document.categories, "categories");
  assertRecord(document.classifierHistory, "classifierHistory");

  for (const [id, todo] of Object.entries(document.todos)) {
    if (!todo || todo.id !== id) throw new Error("Invalid todo id");
    assertString(todo.text, "todo.text");
    if (typeof todo.done !== "boolean") throw new Error("todo.done must be boolean");
    assertString(todo.categoryId, "todo.categoryId", true);
  }
  for (const [id, category] of Object.entries(document.categories)) {
    if (!category || category.id !== id) throw new Error("Invalid category id");
    assertString(category.name, "category.name");
    assertString(category.classifierKeywords, "category.classifierKeywords", true);
  }
  for (const [id, sample] of Object.entries(document.classifierHistory)) {
    if (!sample || sample.id !== id) throw new Error("Invalid classifier sample id");
    assertString(sample.text, "classifierHistory.text");
    assertString(sample.normalizedText, "classifierHistory.normalizedText");
    assertString(sample.source, "classifierHistory.source");
    assertString(sample.categoryId, "classifierHistory.categoryId", true);
  }
}

export class DocumentStore {
  constructor(dataDir) {
    this.directory = path.join(dataDir, "documents");
    this.cache = new Map();
    this.queues = new Map();
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  filename(listId) {
    if (!/^[a-zA-Z0-9-]+$/.test(listId)) throw new Error("Invalid list id");
    return path.join(this.directory, `${listId}.automerge`);
  }

  async load(listId) {
    if (this.cache.has(listId)) return this.cache.get(listId);
    let document;
    try {
      document = Automerge.load(await fs.readFile(this.filename(listId)));
      validateListDocument(document);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      document = emptyListDocument();
    }
    this.cache.set(listId, document);
    return document;
  }

  async save(listId, document) {
    validateListDocument(document);
    const filename = this.filename(listId);
    const temporary = `${filename}.${process.pid}.tmp`;
    await fs.writeFile(temporary, Automerge.save(document), { mode: 0o600 });
    await fs.rename(temporary, filename);
    this.cache.set(listId, document);
  }

  async merge(listId, bytes) {
    return this.enqueue(listId, async () => {
      const current = await this.load(listId);
      const incoming = Automerge.load(bytes);
      validateListDocument(incoming);
      const merged = Automerge.merge(current, incoming);
      validateListDocument(merged);
      await this.save(listId, merged);
      return merged;
    });
  }

  async create(listId, bytes) {
    const document = bytes ? Automerge.load(bytes) : emptyListDocument();
    await this.save(listId, document);
    return document;
  }

  async delete(listId) {
    this.cache.delete(listId);
    try {
      await fs.unlink(this.filename(listId));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  enqueue(listId, operation) {
    const previous = this.queues.get(listId) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.queues.set(listId, next);
    return next.finally(() => {
      if (this.queues.get(listId) === next) this.queues.delete(listId);
    });
  }
}
