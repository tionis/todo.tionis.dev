import assert from "node:assert/strict";
import test from "node:test";
import {
  applyContentOperationsToDraft,
  collectListAssociations,
  explicitListId,
  groupContentOperations,
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
