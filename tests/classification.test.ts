import assert from "node:assert/strict";
import test from "node:test";
import { classifyTodoText, normalizeItemText, type ClassificationSample } from "../lib/classification";

const sublists = [
  { id: "edeka", name: "EDEKA" },
  { id: "trocken", name: "Konserven & Trockenware" },
  { id: "obst", name: "Obst & Gemüse" },
];
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 9)).toISOString();
const sample = (text: string, source: string, sublistId: string, n: number): ClassificationSample => ({
  text, source, sublist: { id: sublistId }, createdAt: day(n),
});
const background = [
  sample("Bananen", "checked", "obst", 1),
  sample("Äpfel", "checked", "obst", 1),
  sample("Spaghetti", "checked", "trocken", 1),
  sample("Reis", "checked", "trocken", 1),
];

test("a manual move overrides an older check-off of the same item", () => {
  const samples = [
    ...background,
    sample("Tahini", "checked", "edeka", 2),
    sample("Tahini", "checked", "edeka", 5),
    sample("Tahini", "negative", "edeka", 9),
    sample("Tahini", "manual-move", "trocken", 9),
  ];
  assert.equal(classifyTodoText("Tahini", sublists, [], samples)?.sublistId, "trocken");
});

test("a check-off after a manual move still wins", () => {
  const samples = [
    ...background,
    sample("Tahini", "manual-move", "trocken", 2),
    sample("Tahini", "checked", "edeka", 5),
  ];
  assert.equal(classifyTodoText("Tahini", sublists, [], samples)?.sublistId, "edeka");
});

test("quantities and units from recipes don't count as part of the item", () => {
  const cases: Array<[string, string]> = [
    ["1 Packung Mozzarella", "mozzarella"],
    ["½ Packung Curry-Roux", "curry roux"],
    ["2 Stück Hähnchenschenkel", "hahnchenschenkel"],
    ["1–2 cm Ingwer", "ingwer"],
    ["2 Zehen Knoblauch", "knoblauch"],
    ["2 Pck. Vanillezucker", "vanillezucker"],
    ["4 Scheiben Schinken", "schinken"],
    ["1 EL Öl", "ol"],
    ["30–40 g Pistazien, ungesalzen", "pistazien ungesalzen"],
    ["Schinken x2", "schinken"],
    ["2x Mehl", "mehl"],
    ["Lachs zum braten (~500g)", "lachs zum braten"],
    // A unit word that is the whole item stays.
    ["Becher", "becher"],
  ];
  for (const [text, expected] of cases) {
    assert.equal(normalizeItemText(text), expected, text);
    assert.equal(normalizeItemText(normalizeItemText(text)), expected, `${text} (again)`);
  }
});

test("samples stored with an older normalization still match the item", () => {
  const samples = [
    ...background,
    // Recorded before units like "Packung" were stripped.
    { ...sample("1 Packung Feta", "checked", "edeka", 3), normalizedText: "packung feta" },
  ];
  const result = classifyTodoText("Feta", sublists, [], samples);
  assert.equal(result?.sublistId, "edeka");
  assert.equal(result?.reason, "exact");
});
