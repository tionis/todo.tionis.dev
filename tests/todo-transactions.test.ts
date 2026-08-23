import assert from "node:assert/strict";
import test from "node:test";
import {
  createClassificationTransaction,
  createTodoDeleteTransactions,
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
