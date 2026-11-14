import assert from "node:assert/strict";
import test from "node:test";
import { currentMethod, eventKey, labelEvents, lookupFirst, replay, type EvalExport, type EvalMethod } from "../lib/classifier-eval";
import { buildReviewSheet, parseCsv, parseVerdicts } from "../lib/classifier-eval-review";

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 9)).toISOString();

function list(): EvalExport {
  const categories = [
    { id: "obst", name: "Obst & Gemüse", classifierKeywords: "Banane" },
    { id: "kuehl", name: "Kühlregal", classifierKeywords: "Milch" },
    { id: "edeka", name: "EDEKA", classifierKeywords: null },
    { id: "edeka-kuehl", name: "EDEKA Kühlung", classifierKeywords: null },
  ];
  const classifierHistory = [
    // Added by hand into EDEKA, then checked there: a person chose it.
    { id: "1", text: "Tahini", source: "quick-add", categoryId: "edeka", createdAt: day(1) },
    { id: "2", text: "Tahini", source: "checked", categoryId: "edeka", createdAt: day(2) },
    // Checked without a placement by a person: maybe the classifier's uncorrected guess.
    { id: "3", text: "Bananen", source: "checked", categoryId: "kuehl", createdAt: day(3) },
    { id: "4", text: "Milch", source: "manual-move", categoryId: "kuehl", createdAt: day(4) },
    { id: "5", text: "Milch", source: "checked", categoryId: "kuehl", createdAt: day(5) },
  ];
  return { format: "smart-todos-list", version: 1, list: { name: "Klein", classifierAggressiveness: "normal" }, categories, todos: [], classifierHistory };
}

test("labels are trusted only when a person placed the item in that category", () => {
  assert.deepEqual(labelEvents(list()).map((event) => [event.text, event.origin, event.trusted]), [
    ["Tahini", "checked", true],
    ["Bananen", "checked", false],
    ["Milch", "manual-move", true],
    ["Milch", "checked", true],
  ]);
});

test("replay narrows scoring with trustedOnly and since but methods still see every label", async () => {
  const seen: number[] = [];
  const spy: EvalMethod = { name: "spy", predict(_text, context) { seen.push(context.labels.length); return null; } };
  const [trusted] = await replay(list(), [spy], { trustedOnly: true });
  assert.deepEqual(trusted.results.map(({ event }) => event.text), ["Tahini", "Milch", "Milch"]);
  assert.deepEqual(seen, [0, 2, 3]);
  const [recent] = await replay(list(), [spy], { since: Date.parse(day(4)) });
  assert.deepEqual(recent.results.map(({ event }) => event.origin), ["manual-move", "checked"]);
});

test("the review sheet lists disagreements and untrusted labels, and verdicts round-trip", async () => {
  const data = list();
  const reports = await replay(data, [lookupFirst(currentMethod)]);
  const sheet = buildReviewSheet(reports, data.categories);
  const [header, ...rows] = parseCsv(sheet);
  assert.deepEqual(header, ["key", "date", "item", "label", "label trusted", "methods", "verdict"]);
  const bananen = rows.find((row) => row[2] === "Bananen");
  assert.ok(bananen, "the untrusted label is up for review");
  assert.equal(bananen[4], "no");

  const events = labelEvents(data);
  const key = (text: string) => eventKey(events.find((event) => event.text === text)!);
  const filled = [
    "key,verdict",
    `${key("Bananen")},obst`,
    `${key("Tahini")},"edeka | edeka k"`,
    `${key("Milch")},skip`,
  ].join("\n");
  const verdicts = parseVerdicts(filled, data.categories, events);
  assert.deepEqual(verdicts.get(key("Bananen")), ["obst"]);
  assert.deepEqual(verdicts.get(key("Tahini")), ["edeka", "edeka-kuehl"]);
  assert.equal(verdicts.get(key("Milch")), null);

  const [scored] = await replay(data, [lookupFirst(currentMethod)], { verdicts });
  const bananenResult = scored.results.find(({ event }) => event.text === "Bananen")!;
  assert.deepEqual(bananenResult.event.acceptable, ["obst"]);
  assert.equal(bananenResult.event.trusted, true);
});

test("verdicts reject ambiguous or unknown categories and unknown events", () => {
  const data = list();
  const events = labelEvents(data);
  const key = eventKey(events[0]);
  assert.throws(() => parseVerdicts(`key,verdict\n${key},edeka k\n${key},e`, data.categories, events), /matches EDEKA, EDEKA Kühlung/);
  assert.throws(() => parseVerdicts(`key,verdict\n${key},Drogerie`, data.categories, events), /matches no category/);
  assert.throws(() => parseVerdicts("key,verdict\n2020-01-01T00:00:00.000Z x,ok", data.categories, events), /no event/);
  assert.throws(() => parseVerdicts("item,verdict\nx,ok", data.categories, events), /key and a verdict column/);
});

test("a sheet written before a change to the normalization still finds its events", () => {
  const data = list();
  data.classifierHistory.push({ id: "6", text: "1 Packung Tahini", source: "checked", categoryId: "edeka", createdAt: day(6) });
  const events = labelEvents(data);
  const oldKey = `${new Date(day(6)).toISOString()} packung tahini`;
  const verdicts = parseVerdicts(`key,verdict\n${oldKey},ok`, data.categories, events);
  assert.deepEqual([...verdicts.keys()], [`${new Date(day(6)).toISOString()} tahini`]);
});
