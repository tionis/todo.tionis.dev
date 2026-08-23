import assert from "node:assert/strict";
import test from "node:test";
import { buildListImportTransactions } from "../lib/listImport";
import { buildImportTemplateTransactions } from "../lib/listTemplates";
import { applyContentOperationsToDraft } from "../shared/transaction-routing.mjs";

function operations(transactions: any[]) {
  return transactions.flatMap((transaction) => transaction.operations || []);
}

function emptyDocument() {
  return { schemaVersion: 1, todos: {} as Record<string, any>, categories: {} as Record<string, any>, classifierHistory: {} as Record<string, any> };
}

test("full-list import remaps category references for todos and classifier history", () => {
  const exported = {
    format: "smart-todos-list",
    version: 1,
    list: { name: "Imported", autoSortTodos: true },
    categories: [{ id: "old-dairy", name: "Dairy", order: 1 }],
    todos: [{ id: "old-todo", text: "Milk", done: true, categoryId: "old-dairy", order: 1 }],
    classifierHistory: [{ id: "old-sample", text: "Milk", normalizedText: "milk", source: "checked", categoryId: "old-dairy" }],
  };
  const built = buildListImportTransactions(exported, "owner-1", "imported-slug");
  const flattened = operations(built.transactions);
  const ownerLink = flattened.find((operation) => operation.entity === "todoLists" && operation.kind === "link");
  assert.equal(ownerLink.links.owner, "owner-1");

  const document = emptyDocument();
  applyContentOperationsToDraft(document, flattened.filter((operation) => operation.entity !== "todoLists"));
  const category = Object.values(document.categories)[0];
  const todo = Object.values(document.todos)[0];
  const sample = Object.values(document.classifierHistory)[0];
  assert.notEqual(category.id, "old-dairy");
  assert.equal(todo.categoryId, category.id);
  assert.equal(sample.categoryId, category.id);
  assert.equal(sample.source, "checked");
});

test("full-list import rejects malformed and oversized record sets before creating transactions", () => {
  assert.throws(() => buildListImportTransactions({ format: "wrong" }, "owner", "slug"), /not a supported/);
  const tooMany = {
    format: "smart-todos-list",
    version: 1,
    list: { name: "Too large" },
    categories: [],
    todos: Array.from({ length: 10_001 }, (_, index) => ({ id: `todo-${index}`, text: "x", done: false })),
    classifierHistory: [],
  };
  assert.throws(() => buildListImportTransactions(tooMany, "owner", "slug"), /too many records/);
});

test("template import reuses matching categories, remaps new ones, and honors classifier reset", () => {
  const source = {
    id: "source",
    name: "Source",
    classifierResetAt: "2026-01-02T00:00:00.000Z",
    sublists: [
      { id: "source-produce", name: "Produce", order: 1 },
      { id: "source-dairy", name: "Dairy", order: 2 },
    ],
    todos: [
      { id: "apple", text: "Apples", done: false, order: 1, sublist: { id: "source-produce" } },
      { id: "milk", text: "Milk", done: false, order: 2, sublist: { id: "source-dairy" } },
    ],
    todoClassifications: [
      { id: "stale", text: "Old milk", source: "checked", createdAt: "2026-01-01T00:00:00.000Z", sublist: { id: "source-dairy" } },
      { id: "fresh", text: "Milk", source: "checked", createdAt: "2026-01-03T00:00:00.000Z", sublist: { id: "source-dairy" } },
    ],
  };
  const transactions = buildImportTemplateTransactions({
    sourceList: source,
    targetListId: "target",
    targetSublists: [{ id: "target-produce", name: " produce ", order: 1 }],
    options: { categories: true, todos: true, classifier: true },
  });
  const document = emptyDocument();
  document.categories["target-produce"] = { id: "target-produce", name: "Produce", order: 1 };
  applyContentOperationsToDraft(document, operations(transactions).filter((operation) => operation.entity !== "todoLists"));

  const categories = Object.values(document.categories);
  assert.equal(categories.filter((category) => category.name.trim().toLowerCase() === "produce").length, 1);
  const dairy = categories.find((category) => category.name === "Dairy");
  assert.ok(dairy);
  assert.equal(Object.values(document.todos).find((todo) => todo.text === "Apples")?.categoryId, "target-produce");
  assert.equal(Object.values(document.todos).find((todo) => todo.text === "Milk")?.categoryId, dairy.id);
  assert.deepEqual(Object.values(document.classifierHistory).map((sample) => sample.text), ["Milk"]);
  assert.equal(Object.values(document.classifierHistory)[0].categoryId, dairy.id);
});
