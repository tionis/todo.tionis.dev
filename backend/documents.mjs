import fs from "node:fs/promises";
import path from "node:path";
import * as Automerge from "@automerge/automerge";
import { DocumentProcessor } from "./document-processor.mjs";

export const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_ITEMS = 10_000;
const MAX_TEXT = 20_000;
const MAX_TOTAL_TEXT = 2_000_000;
const TOP_LEVEL_FIELDS = new Set(["schemaVersion", "todos", "categories", "classifierHistory"]);
const TODO_FIELDS = new Set(["id", "text", "done", "order", "createdAt", "updatedAt", "categoryId"]);
const CATEGORY_FIELDS = new Set(["id", "name", "order", "classifierKeywords", "createdAt"]);
const CLASSIFIER_FIELDS = new Set(["id", "text", "normalizedText", "source", "createdAt", "categoryId"]);

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
}

function assertKeys(value, allowed, field) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${field}.${key} is not supported`);
}

function assertString(value, field, budget, optional = false) {
  if (optional && (value === undefined || value === null)) return;
  if (typeof value !== "string" || value.length > MAX_TEXT) throw new Error(`${field} is invalid`);
  budget.characters += value.length;
  if (budget.characters > MAX_TOTAL_TEXT) throw new Error("Document contains too much text");
}

function assertNumber(value, field, optional = false) {
  if (optional && (value === undefined || value === null)) return;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field} is invalid`);
}

export function validateListDocument(document) {
  assertRecord(document, "document");
  assertKeys(document, TOP_LEVEL_FIELDS, "document");
  if (document.schemaVersion !== 1) throw new Error("Unsupported list document version");
  assertRecord(document.todos, "todos");
  assertRecord(document.categories, "categories");
  assertRecord(document.classifierHistory, "classifierHistory");
  const totalRecords = Object.keys(document.todos).length
    + Object.keys(document.categories).length
    + Object.keys(document.classifierHistory).length;
  if (totalRecords > MAX_ITEMS) throw new Error("Document contains too many records");
  const budget = { characters: 0 };

  for (const [id, todo] of Object.entries(document.todos)) {
    if (!todo || todo.id !== id) throw new Error("Invalid todo id");
    assertRecord(todo, "todo");
    assertKeys(todo, TODO_FIELDS, "todo");
    assertString(todo.id, "todo.id", budget);
    assertString(todo.text, "todo.text", budget);
    if (typeof todo.done !== "boolean") throw new Error("todo.done must be boolean");
    assertNumber(todo.order, "todo.order", true);
    assertString(todo.createdAt, "todo.createdAt", budget, true);
    assertString(todo.updatedAt, "todo.updatedAt", budget, true);
    assertString(todo.categoryId, "todo.categoryId", budget, true);
  }
  for (const [id, category] of Object.entries(document.categories)) {
    if (!category || category.id !== id) throw new Error("Invalid category id");
    assertRecord(category, "category");
    assertKeys(category, CATEGORY_FIELDS, "category");
    assertString(category.id, "category.id", budget);
    assertString(category.name, "category.name", budget);
    assertNumber(category.order, "category.order", true);
    assertString(category.classifierKeywords, "category.classifierKeywords", budget, true);
    assertString(category.createdAt, "category.createdAt", budget, true);
  }
  for (const [id, sample] of Object.entries(document.classifierHistory)) {
    if (!sample || sample.id !== id) throw new Error("Invalid classifier sample id");
    assertRecord(sample, "classifierHistory");
    assertKeys(sample, CLASSIFIER_FIELDS, "classifierHistory");
    assertString(sample.id, "classifierHistory.id", budget);
    assertString(sample.text, "classifierHistory.text", budget);
    assertString(sample.normalizedText, "classifierHistory.normalizedText", budget);
    assertString(sample.source, "classifierHistory.source", budget);
    assertString(sample.createdAt, "classifierHistory.createdAt", budget, true);
    assertString(sample.categoryId, "classifierHistory.categoryId", budget, true);
  }
}

function assertDocumentBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("Automerge document is too large");
  }
}

function serializeDocument(document) {
  validateListDocument(document);
  const bytes = Automerge.save(document);
  assertDocumentBytes(bytes);
  return bytes;
}

export class DocumentStore {
  constructor(dataDir) {
    this.directory = path.join(dataDir, "documents");
    this.cache = new Map();
    this.queues = new Map();
    this.processor = new DocumentProcessor();
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
      const bytes = await fs.readFile(this.filename(listId));
      assertDocumentBytes(bytes);
      document = Automerge.load(bytes);
      validateListDocument(document);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      document = emptyListDocument();
    }
    this.cache.set(listId, document);
    return document;
  }

  async save(listId, document, serialized = serializeDocument(document)) {
    const filename = this.filename(listId);
    const temporary = `${filename}.${process.pid}.tmp`;
    await fs.writeFile(temporary, serialized, { mode: 0o600 });
    await fs.rename(temporary, filename);
    this.cache.set(listId, document);
  }

  async merge(listId, bytes) {
    return this.enqueue(listId, async () => {
      assertDocumentBytes(bytes);
      const current = await this.load(listId);
      const serialized = await this.processor.process("merge", serializeDocument(current), bytes);
      const merged = Automerge.load(serialized);
      validateListDocument(merged);
      await this.save(listId, merged, serialized);
      return merged;
    });
  }

  async create(listId, bytes) {
    if (bytes) assertDocumentBytes(bytes);
    const serialized = bytes ? await this.processor.process("create", undefined, bytes) : undefined;
    const document = serialized ? Automerge.load(serialized) : emptyListDocument();
    await this.save(listId, document, serialized);
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
