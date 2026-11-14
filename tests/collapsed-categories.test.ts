import assert from "node:assert/strict";
import test from "node:test";
import { collapsedStorageKey, parseCollapsed, toggleCollapsed } from "../lib/collapsedCategories";

test("collapse state is stored per list", () => {
  assert.equal(collapsedStorageKey("list-1"), "smart-todos:collapsed:list-1");
});

test("parses stored collapse state defensively", () => {
  assert.deepEqual([...parseCollapsed(null)], []);
  assert.deepEqual([...parseCollapsed("not json")], []);
  assert.deepEqual([...parseCollapsed('{"a":1}')], []);
  assert.deepEqual([...parseCollapsed('["a", 3, "uncategorized"]')], ["a", "uncategorized"]);
});

test("toggling adds and removes a section", () => {
  const collapsed = toggleCollapsed(new Set(), "produce");
  assert.deepEqual(collapsed, ["produce"]);
  assert.deepEqual(toggleCollapsed(new Set(collapsed), "produce"), []);
});
