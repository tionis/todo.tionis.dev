import assert from "node:assert/strict";
import test from "node:test";
import { groupNames, groupSectionId, layoutCategorySections, normalizeGroupName } from "../lib/categoryGroups";

const categories = [
  { id: "obst", name: "Obst & Gemüse", order: 1 },
  { id: "kuehl", name: "Kühlregal", order: 2 },
  { id: "edeka-drogerie", name: "Drogerie", order: 5, group: "EDEKA" },
  { id: "tk", name: "Tiefkühl", order: 3 },
  { id: "edeka-feinkost", name: "Feinkost", order: 4, group: " edeka " },
];

test("groups take the place of their first category and keep their categories in order", () => {
  const sections = layoutCategorySections(categories);
  assert.deepEqual(sections.map((section) => section.kind === "group"
    ? `${section.name}: ${section.categories.map((category) => category.id).join(",")}`
    : section.category.id), ["obst", "kuehl", "tk", "edeka: edeka-feinkost,edeka-drogerie"]);
});

test("group names are trimmed, compared case-insensitively and listed once", () => {
  assert.equal(normalizeGroupName("  EDEKA  Markt "), "EDEKA Markt");
  assert.equal(normalizeGroupName("   "), null);
  assert.equal(normalizeGroupName(null), null);
  assert.deepEqual(groupNames(categories), ["edeka"]);
  assert.equal(groupSectionId("EDEKA"), groupSectionId("edeka"));
});

test("a list without groups is laid out as before", () => {
  const sections = layoutCategorySections(categories.filter((category) => !category.group));
  assert.deepEqual(sections.map((section) => section.kind), ["category", "category", "category"]);
});
