import assert from "node:assert/strict";
import test from "node:test";
import {
  applyContentOperationsToDraft,
  classifierResetPlan,
  collectListAssociations,
  explicitListId,
  groupContentOperations,
  withoutRedundantListContentDeletes,
} from "../shared/transaction-routing.mjs";

test("routes a new classifier sample using its sibling list-link operation", () => {
  const update = { entity: "todoClassifications", id: "sample-1", kind: "update", data: { source: "deleted" } };
  const link = { entity: "todoClassifications", id: "sample-1", kind: "link", links: { list: "list-1", sublist: "category-1" } };
  const associations = collectListAssociations([update, link]);

  assert.equal(explicitListId(update, associations), "list-1");
  assert.equal(explicitListId(link, associations), "list-1");
});

test("does not mix associations for equal ids belonging to different entities", () => {
  const todo = { entity: "todos", id: "same-id", kind: "link", links: { list: "list-1" } };
  const sample = { entity: "todoClassifications", id: "same-id", kind: "update" };
  const associations = collectListAssociations([todo, sample]);

  assert.equal(explicitListId(sample, associations), undefined);
});

test("archives classifier history and deletes completed todos in one transaction", () => {
  const document = {
    schemaVersion: 1,
    todos: {
      "todo-1": { id: "todo-1", text: "Milk", done: true, categoryId: "category-1", order: 1 },
    },
    categories: {
      "category-1": { id: "category-1", name: "Dairy", order: 1 },
    },
    classifierHistory: {},
  };
  const operations = [
    {
      entity: "todoClassifications",
      id: "sample-1",
      kind: "update",
      data: { id: "sample-1", text: "Milk", normalizedText: "milk", source: "deleted" },
    },
    {
      entity: "todoClassifications",
      id: "sample-1",
      kind: "link",
      links: { list: "list-1", sublist: "category-1" },
    },
    { entity: "todos", id: "todo-1", kind: "delete" },
  ];
  const associations = collectListAssociations(operations);
  const grouped = groupContentOperations(
    operations,
    associations,
    (operation) => document.todos[operation.id] ? "list-1" : undefined,
  );

  assert.deepEqual([...grouped.keys()], ["list-1"]);
  applyContentOperationsToDraft(document, grouped.get("list-1"));
  assert.deepEqual(document.todos, {});
  assert.deepEqual(document.classifierHistory["sample-1"], {
    id: "sample-1",
    text: "Milk",
    normalizedText: "milk",
    source: "deleted",
    categoryId: "category-1",
  });
});

test("creates a categorized todo and its classifier sample atomically in one list document", () => {
  const document = { schemaVersion: 1, todos: {}, categories: { produce: { id: "produce", name: "Produce" } }, classifierHistory: {} };
  const operations = [
    { entity: "todos", id: "todo-1", kind: "update", data: { text: "Apples", done: false, order: 1 } },
    { entity: "todos", id: "todo-1", kind: "link", links: { list: "list-1" } },
    { entity: "todos", id: "todo-1", kind: "link", links: { sublist: "produce" } },
    { entity: "todoClassifications", id: "sample-1", kind: "update", data: { text: "Apples", source: "explicit-create" } },
    { entity: "todoClassifications", id: "sample-1", kind: "link", links: { list: "list-1", sublist: "produce" } },
  ];
  const associations = collectListAssociations(operations);
  const grouped = groupContentOperations(operations, associations, () => undefined);
  applyContentOperationsToDraft(document, grouped.get("list-1"));

  assert.equal(document.todos["todo-1"].categoryId, "produce");
  assert.equal(document.classifierHistory["sample-1"].categoryId, "produce");
});

test("moves and uncategorizes todos while retaining classifier correction samples", () => {
  const document = {
    schemaVersion: 1,
    todos: { item: { id: "item", text: "Milk", categoryId: "dairy" } },
    categories: { dairy: { id: "dairy" }, misc: { id: "misc" } },
    classifierHistory: {},
  };
  const move = [
    { entity: "todos", id: "item", kind: "update", data: { updatedAt: "now" } },
    { entity: "todos", id: "item", kind: "link", links: { sublist: "misc" } },
    { entity: "todoClassifications", id: "negative", kind: "update", data: { text: "Milk", source: "negative" } },
    { entity: "todoClassifications", id: "negative", kind: "link", links: { list: "list-1", sublist: "dairy" } },
    { entity: "todoClassifications", id: "positive", kind: "update", data: { text: "Milk", source: "manual-move" } },
    { entity: "todoClassifications", id: "positive", kind: "link", links: { list: "list-1", sublist: "misc" } },
  ];
  const associations = collectListAssociations(move);
  const grouped = groupContentOperations(move, associations, (operation) => operation.id === "item" ? "list-1" : undefined);
  applyContentOperationsToDraft(document, grouped.get("list-1"));
  assert.equal(document.todos.item.categoryId, "misc");
  assert.equal(document.classifierHistory.negative.categoryId, "dairy");
  assert.equal(document.classifierHistory.positive.categoryId, "misc");

  applyContentOperationsToDraft(document, [
    { entity: "todos", id: "item", kind: "unlink", links: { sublist: "misc" } },
  ]);
  assert.equal(document.todos.item.categoryId, undefined);
});

test("deleting a category and its todos removes only the selected content", () => {
  const document = {
    schemaVersion: 1,
    todos: {
      remove: { id: "remove", categoryId: "category-remove" },
      keep: { id: "keep", categoryId: "category-keep" },
    },
    categories: {
      "category-remove": { id: "category-remove" },
      "category-keep": { id: "category-keep" },
    },
    classifierHistory: {},
  };
  applyContentOperationsToDraft(document, [
    { entity: "todos", id: "remove", kind: "delete" },
    { entity: "sublists", id: "category-remove", kind: "delete" },
  ]);
  assert.deepEqual(Object.keys(document.todos), ["keep"]);
  assert.deepEqual(Object.keys(document.categories), ["category-keep"]);
});

test("routes a multi-list batch without crossing document boundaries", () => {
  const operations = [
    { entity: "todos", id: "a", kind: "update", data: { text: "A" } },
    { entity: "todos", id: "a", kind: "link", links: { list: "list-a" } },
    { entity: "sublists", id: "b", kind: "update", data: { name: "B" } },
    { entity: "sublists", id: "b", kind: "link", links: { list: "list-b" } },
  ];
  const grouped = groupContentOperations(operations, collectListAssociations(operations), () => undefined);

  assert.deepEqual([...grouped.keys()], ["list-a", "list-b"]);
  assert.deepEqual(grouped.get("list-a").map((operation) => operation.id), ["a", "a"]);
  assert.deepEqual(grouped.get("list-b").map((operation) => operation.id), ["b", "b"]);
});

test("deleting a list relies on the authoritative cascade instead of first mutating its document", () => {
  const operations = [
    { entity: "todos", id: "todo-1", kind: "delete" },
    { entity: "sublists", id: "category-1", kind: "delete" },
    { entity: "todoLists", id: "list-1", kind: "delete" },
  ];
  assert.deepEqual(withoutRedundantListContentDeletes(operations), [operations[2]]);
  assert.throws(() => withoutRedundantListContentDeletes([
    ...operations,
    { entity: "todos", id: "todo-2", kind: "update", data: { text: "unsafe" } },
  ]), /cannot be combined/);
});

test("classifier reset rejects unrelated changes instead of silently skipping them", () => {
  const reset = { entity: "todoLists", id: "list-1", kind: "update", data: { classifierResetAt: "now" } };
  const removeSample = { entity: "todoClassifications", id: "sample-1", kind: "delete" };
  assert.deepEqual(classifierResetPlan([removeSample, reset]), { listId: "list-1" });
  assert.throws(() => classifierResetPlan([
    removeSample,
    reset,
    { entity: "todos", id: "todo-1", kind: "delete" },
  ]), /cannot be combined/);
  assert.throws(() => classifierResetPlan([
    removeSample,
    { ...reset, data: { classifierResetAt: "now", name: "silently lost" } },
  ]), /cannot include other list settings/);
});
