import { db } from "./db";
import { id } from "./id";
import { normalizeItemText } from "./classification";

interface ListExportV1 {
  format: "smart-todos-list";
  version: 1;
  list: Record<string, any> & { name: string };
  categories: Array<Record<string, any> & { id: string; name: string }>;
  todos: Array<Record<string, any> & { id: string; text: string; done: boolean; categoryId?: string | null }>;
  classifierHistory: Array<Record<string, any> & { id: string; text: string; source: string; categoryId?: string | null }>;
}

export const MAX_IMPORT_FILE_BYTES = 4_000_000;
const MAX_IMPORT_RECORDS = 10_000;
const MAX_IMPORT_TEXT = 20_000;
const MAX_IMPORT_TOTAL_TEXT = 2_000_000;

function assertImportString(value: unknown, field: string, budget: { characters: number }, optional = false) {
  if (optional && (value === undefined || value === null)) return;
  if (typeof value !== "string" || value.length > MAX_IMPORT_TEXT) throw new Error(`${field} is invalid or too long`);
  budget.characters += value.length;
  if (budget.characters > MAX_IMPORT_TOTAL_TEXT) throw new Error("The export contains too much text");
}

function assertExport(value: any): asserts value is ListExportV1 {
  if (!value || value.format !== "smart-todos-list" || value.version !== 1) throw new Error("This is not a supported Smart Todos export");
  if (!value.list?.name || !Array.isArray(value.categories) || !Array.isArray(value.todos) || !Array.isArray(value.classifierHistory)) {
    throw new Error("The export is missing required list data");
  }
  const totalRecords = value.categories.length + value.todos.length + value.classifierHistory.length;
  if (totalRecords > MAX_IMPORT_RECORDS) throw new Error("The export contains too many records");
  const budget = { characters: 0 };
  assertImportString(value.list.name, "list.name", budget);
  for (const category of value.categories) {
    assertImportString(category?.id, "category.id", budget);
    assertImportString(category?.name, "category.name", budget);
    assertImportString(category?.classifierKeywords, "category.classifierKeywords", budget, true);
  }
  for (const todo of value.todos) {
    assertImportString(todo?.id, "todo.id", budget);
    assertImportString(todo?.text, "todo.text", budget);
    if (typeof todo?.done !== "boolean") throw new Error("todo.done is invalid");
    assertImportString(todo?.categoryId, "todo.categoryId", budget, true);
  }
  for (const sample of value.classifierHistory) {
    assertImportString(sample?.id, "classifierHistory.id", budget);
    assertImportString(sample?.text, "classifierHistory.text", budget);
    assertImportString(sample?.normalizedText, "classifierHistory.normalizedText", budget, true);
    assertImportString(sample?.source, "classifierHistory.source", budget);
    assertImportString(sample?.categoryId, "classifierHistory.categoryId", budget, true);
  }
}

export function buildListImportTransactions(value: unknown, ownerId: string, slug: string) {
  assertExport(value);
  const listId = id();
  const categoryIds = new Map(value.categories.map((category) => [category.id, id()]));
  const transactions: any[] = [
    db.tx.todoLists[listId].update({
      name: value.list.name,
      slug,
      permission: "private-write",
      tags: value.list.tags ?? null,
      hideCompleted: !!value.list.hideCompleted,
      autoSortTodos: !!value.list.autoSortTodos,
      classifierAggressiveness: value.list.classifierAggressiveness || "normal",
      classifierResetAt: value.list.classifierResetAt ?? null,
      createdAt: value.list.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).link({ owner: ownerId }),
  ];

  for (const category of value.categories) {
    transactions.push(db.tx.sublists[categoryIds.get(category.id)!].update({
      name: category.name,
      order: category.order ?? 0,
      classifierKeywords: category.classifierKeywords ?? "",
      createdAt: category.createdAt || new Date().toISOString(),
    }).link({ list: listId }));
  }
  for (const todo of value.todos) {
    let transaction = db.tx.todos[id()].update({
      text: todo.text,
      done: !!todo.done,
      order: todo.order ?? 0,
      createdAt: todo.createdAt || new Date().toISOString(),
      updatedAt: todo.updatedAt || todo.createdAt || new Date().toISOString(),
    }).link({ list: listId });
    const categoryId = todo.categoryId ? categoryIds.get(todo.categoryId) : undefined;
    if (categoryId) transaction = transaction.link({ sublist: categoryId });
    transactions.push(transaction);
  }
  for (const sample of value.classifierHistory) {
    const categoryId = sample.categoryId ? categoryIds.get(sample.categoryId) : undefined;
    if (!categoryId) continue;
    transactions.push(db.tx.todoClassifications[id()].update({
      text: sample.text,
      normalizedText: sample.normalizedText || normalizeItemText(sample.text),
      source: sample.source,
      createdAt: sample.createdAt || new Date().toISOString(),
    }).link({ list: listId, sublist: categoryId }));
  }
  return { listId, transactions };
}
