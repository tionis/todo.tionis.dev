import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCategoryTree,
  categoryDisplayPath,
  categoryLeafName,
  categoryParentPath,
  categoryPath,
  categoryPaths,
  flattenCategoryTree,
  joinCategoryPath,
  normalizeCategoryPath,
  pathSectionId,
  renameCategoryPath,
  subtreeCategories,
  type CategoryNode,
  type PathCategory,
} from "../lib/categoryTree";

const categories: PathCategory[] = [
  { id: "obst", name: "Obst & Gemüse", order: 1 },
  { id: "aldi-kuehl", name: "ALDI/Kühlregal", order: 2 },
  { id: "tk", name: "Tiefkühl", order: 3 },
  { id: "aldi-kaese", name: "aldi / Kühlregal / Käse", order: 4 },
  { id: "aldi", name: "ALDI", order: 6 },
  { id: "edeka-feinkost", name: "Feinkost", order: 5, group: " EDEKA " },
];

function shape(nodes: CategoryNode<PathCategory>[]): unknown[] {
  return nodes.map((node) => node.children.length
    ? { [`${node.name}${node.category ? `=${node.category.id}` : ""}`]: shape(node.children) }
    : `${node.name}=${node.category?.id}`);
}

test("paths build a tree in list order, and a node can hold its own category", () => {
  assert.deepEqual(shape(buildCategoryTree(categories)), [
    "Obst & Gemüse=obst",
    { "ALDI=aldi": [{ "Kühlregal=aldi-kuehl": ["Käse=aldi-kaese"] }] },
    "Tiefkühl=tk",
    { EDEKA: ["Feinkost=edeka-feinkost"] },
  ]);
});

test("a legacy group reads as the first segment of the path", () => {
  const feinkost = categories[5];
  assert.equal(categoryPath(feinkost), "EDEKA/Feinkost");
  assert.equal(categoryDisplayPath(feinkost), "EDEKA / Feinkost");
  assert.equal(categoryLeafName(feinkost), "Feinkost");
  assert.equal(categoryParentPath(feinkost), "EDEKA");
});

test("paths are normalized and compared case-insensitively", () => {
  assert.equal(normalizeCategoryPath(" ALDI //  Kühl  regal / "), "ALDI/Kühl regal");
  assert.equal(normalizeCategoryPath("   "), "");
  assert.equal(joinCategoryPath("ALDI", "Obst/Bio"), "ALDI/Obst/Bio");
  assert.equal(joinCategoryPath("", "Obst"), "Obst");
  assert.equal(pathSectionId("EDEKA"), pathSectionId("edeka"));
  assert.equal(pathSectionId("EDEKA"), "group:edeka");
  assert.deepEqual(categoryPaths(categories), ["Obst & Gemüse", "ALDI", "ALDI/Kühlregal", "ALDI/Kühlregal/Käse", "Tiefkühl", "EDEKA", "EDEKA/Feinkost"]);
});

test("two categories with the same path are both shown", () => {
  const tree = buildCategoryTree([{ id: "a", name: "Obst", order: 1 }, { id: "b", name: "obst", order: 2 }]);
  assert.deepEqual(tree.map((node) => node.category?.id), ["a", "b"]);
});

test("flattening and subtrees follow display order", () => {
  const tree = buildCategoryTree(categories);
  assert.deepEqual(flattenCategoryTree(tree).map(({ node, depth }) => `${depth}:${node.name}`),
    ["0:Obst & Gemüse", "0:ALDI", "1:Kühlregal", "2:Käse", "0:Tiefkühl", "0:EDEKA", "1:Feinkost"]);
  assert.deepEqual(subtreeCategories(tree[1]).map((category) => category.id), ["aldi", "aldi-kuehl", "aldi-kaese"]);
});

test("renaming a path moves everything below it", () => {
  assert.deepEqual(renameCategoryPath(categories, "ALDI", "Aldi Süd"), [
    { id: "aldi-kuehl", name: "Aldi Süd/Kühlregal" },
    { id: "aldi-kaese", name: "Aldi Süd/Kühlregal/Käse" },
    { id: "aldi", name: "Aldi Süd" },
  ]);
  assert.deepEqual(renameCategoryPath(categories, "EDEKA", "Edeka"), [{ id: "edeka-feinkost", name: "Edeka/Feinkost" }]);
});

test("moving a category below itself leaves its children in place", () => {
  assert.deepEqual(renameCategoryPath(categories, "ALDI", "ALDI/Allgemein"), [{ id: "aldi", name: "ALDI/Allgemein" }]);
});
