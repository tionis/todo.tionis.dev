import assert from "node:assert/strict";
import test from "node:test";
import {
  createClassificationTransaction,
  createTodoDeleteTransactions,
  createCategoryToRestockTransactions,
  createTodoTransaction,
} from "../lib/todoTransactions";
import { db } from "../lib/db";
import {
  applyContentOperationsToDraft,
  collectListAssociations,
  groupContentOperations,
} from "../shared/transaction-routing.mjs";

function operations(transactions: any[]) {
  return transactions.flatMap((transaction) => transaction.operations || []);
}

test("production todo builder creates and categorizes a new todo", () => {
  const flattened = operations([createTodoTransaction("list-1", "Milk", 2, "dairy")]);
  const grouped = groupContentOperations(flattened, collectListAssociations(flattened), () => undefined);
  const document = { schemaVersion: 1, todos: {} as Record<string, any>, categories: { dairy: { id: "dairy" } }, classifierHistory: {} };
  applyContentOperationsToDraft(document, grouped.get("list-1"));

  const todo = Object.values(document.todos)[0];
  assert.equal(todo.text, "Milk");
  assert.equal(todo.order, 2);
  assert.equal(todo.categoryId, "dairy");
});

test("production completed-todo deletion archives only categorized items", () => {
  const flattened = operations(createTodoDeleteTransactions("list-1", [
    { id: "milk", text: "Milk", sublist: { id: "dairy" } },
    { id: "notes", text: "Notes" },
  ]));
  const document = {
    schemaVersion: 1,
    todos: {
      milk: { id: "milk", text: "Milk", done: true, categoryId: "dairy" },
      notes: { id: "notes", text: "Notes", done: true },
    } as Record<string, any>,
    categories: { dairy: { id: "dairy" } },
    classifierHistory: {} as Record<string, any>,
  };
  const grouped = groupContentOperations(
    flattened,
    collectListAssociations(flattened),
    (operation: any) => document.todos[operation.id] ? "list-1" : undefined,
  );
  applyContentOperationsToDraft(document, grouped.get("list-1"));

  assert.deepEqual(document.todos, {});
  const samples = Object.values(document.classifierHistory);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].text, "Milk");
  assert.equal(samples[0].source, "deleted");
  assert.equal(samples[0].categoryId, "dairy");
});

test("checking a categorized todo updates it and records classifier history together", () => {
  const flattened = operations([
    db.tx.todos.milk.update({ done: true, updatedAt: "now" }),
    createClassificationTransaction("list-1", "dairy", "Milk", "checked"),
  ]);
  const document = {
    schemaVersion: 1,
    todos: { milk: { id: "milk", text: "Milk", done: false, categoryId: "dairy" } } as Record<string, any>,
    categories: { dairy: { id: "dairy" } },
    classifierHistory: {} as Record<string, any>,
  };
  const grouped = groupContentOperations(
    flattened,
    collectListAssociations(flattened),
    (operation: any) => document.todos[operation.id] ? "list-1" : undefined,
  );
  applyContentOperationsToDraft(document, grouped.get("list-1"));

  assert.equal(document.todos.milk.done, true);
  const sample = Object.values(document.classifierHistory)[0];
  assert.equal(sample.source, "checked");
  assert.equal(sample.categoryId, "dairy");
});

test("new todos can be marked as restock items", () => {
  const document = { schemaVersion: 1, todos: {} as Record<string, any>, categories: {}, classifierHistory: {} };
  applyContentOperationsToDraft(document, operations([createTodoTransaction("list-1", "Spülmittel", 1, undefined, true), createTodoTransaction("list-1", "Milch", 2)]));
  const todos = Object.values(document.todos);
  assert.equal(todos.find((todo) => todo.text === "Spülmittel").later, true);
  assert.equal("later" in todos.find((todo) => todo.text === "Milch"), false);
});

test("converting a category to restock flags its items, sorts what the classifier knows and removes the category", () => {
  const sublists = [
    { id: "obst", name: "Obst" },
    { id: "drogerie", name: "Drogerie" },
    { id: "nachfuellen", name: "Nachfüllen" },
  ];
  const sublist = (id: string) => sublists.find((item) => item.id === id);
  const checked = (text: string, category: string) => ({ text, done: true, sublist: sublist(category), createdAt: "2026-01-01T00:00:00Z" });
  const todoList = {
    id: "list-1",
    autoSortTodos: true,
    sublists,
    todos: [
      checked("Äpfel", "obst"), checked("Bananen", "obst"), checked("Birnen", "obst"),
      checked("Zahnpasta", "drogerie"), checked("Spülmittel", "drogerie"), checked("Duschgel", "drogerie"),
      { id: "a", text: "Spülmittel", done: false, sublist: sublist("nachfuellen") },
      { id: "b", text: "Batterien", done: false, sublist: sublist("nachfuellen") },
      { id: "c", text: "Äpfel", done: false, sublist: sublist("obst") },
    ],
    todoClassifications: [{ id: "s1", text: "Spülmittel", source: "manual-move", sublist: sublist("nachfuellen") }],
  };
  const result = createCategoryToRestockTransactions(todoList, "nachfuellen");
  assert.equal(result.sorted, 1);
  assert.equal(result.unsorted, 1);

  const document = {
    schemaVersion: 1,
    todos: {
      a: { id: "a", text: "Spülmittel", done: false, categoryId: "nachfuellen" },
      b: { id: "b", text: "Batterien", done: false, categoryId: "nachfuellen" },
      c: { id: "c", text: "Äpfel", done: false, categoryId: "obst" },
    } as Record<string, any>,
    categories: { obst: { id: "obst" }, drogerie: { id: "drogerie" }, nachfuellen: { id: "nachfuellen" } } as Record<string, any>,
    classifierHistory: { s1: { id: "s1", categoryId: "nachfuellen" } } as Record<string, any>,
  };
  applyContentOperationsToDraft(document, operations(result.transactions));
  assert.deepEqual(document.todos.a, { id: "a", text: "Spülmittel", done: false, categoryId: "drogerie", later: true, updatedAt: document.todos.a.updatedAt });
  assert.equal(document.todos.b.later, true);
  assert.equal("categoryId" in document.todos.b, false);
  assert.equal("later" in document.todos.c, false);
  assert.equal(document.categories.nachfuellen, undefined);
  assert.equal(document.classifierHistory.s1, undefined);
});
