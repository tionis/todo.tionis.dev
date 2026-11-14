import assert from "node:assert/strict";
import test from "node:test";
import { classifyTodoText, type ClassificationSample } from "../lib/classification";

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
