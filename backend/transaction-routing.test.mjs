import assert from "node:assert/strict";
import test from "node:test";
import { collectListAssociations, explicitListId } from "../shared/transaction-routing.mjs";

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
