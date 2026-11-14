import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildJevRequest,
  contextAt,
  currentMethod,
  jevFallbackMethod,
  jevMethod,
  labelEvents,
  lookupFirst,
  naiveBayesMethod,
  parseExport,
  replay,
  thresholdSweep,
  type EvalContext,
  type EvalExport,
  type EvalMethod,
  type JevRequest,
} from "../lib/classifier-eval";

const fixture = parseExport(JSON.parse(readFileSync(new URL("./fixtures/classifier-eval-list.json", import.meta.url), "utf8")));

const day = (n: number, hour = 9) => new Date(Date.UTC(2026, 9, n, hour)).toISOString();

function smallList(): EvalExport {
  const categories = [
    { id: "obst", name: "Obst & Gemüse", classifierKeywords: "Apfel, Banane" },
    { id: "kuehl", name: "Kühlregal", classifierKeywords: "Milch, Joghurt, Käse" },
    { id: "trocken", name: "Konserven & Trockenware", classifierKeywords: "Nudeln, Reis" },
    { id: "edeka", name: "EDEKA", group: "EDEKA", classifierKeywords: null },
  ];
  const classifierHistory = [
    { id: "1", text: "Tahini", source: "quick-add", categoryId: "edeka", createdAt: day(1) },
    { id: "2", text: "Tahini", source: "checked", categoryId: "edeka", createdAt: day(2) },
    { id: "3", text: "Bananen", source: "checked", categoryId: "obst", createdAt: day(2) },
    { id: "4", text: "Gouda", source: "checked", categoryId: "kuehl", createdAt: day(2) },
    { id: "5", text: "Spaghetti", source: "checked", categoryId: "trocken", createdAt: day(2) },
    { id: "6", text: "Tahini", source: "checked", categoryId: "edeka", createdAt: day(9) },
    // ALDI starts carrying it: moved by hand, then checked in the new aisle.
    { id: "7", text: "Tahini", source: "negative", categoryId: "edeka", createdAt: day(16) },
    { id: "8", text: "Tahini", source: "manual-move", categoryId: "trocken", createdAt: day(16) },
    { id: "9", text: "Tahini", source: "checked", categoryId: "trocken", createdAt: day(17) },
    // A sample in a category that was deleted later: never a label.
    { id: "10", text: "Kerzen", source: "checked", categoryId: "gone", createdAt: day(3) },
  ];
  const todos = [
    // Same tap as sample 9: counted once.
    { id: "t1", text: "Tahini", done: true, categoryId: "trocken", createdAt: day(16), updatedAt: day(17) },
    // Older data without a sample: a label of its own.
    { id: "t2", text: "Milch", done: true, categoryId: "kuehl", createdAt: day(1), updatedAt: day(1, 8) },
    { id: "t3", text: "Kaffee", done: false, categoryId: null, createdAt: day(18) },
  ];
  return { format: "smart-todos-list", version: 1, list: { name: "Klein", classifierAggressiveness: "normal" }, categories, todos, classifierHistory };
}

test("label events are the human placements in time order, without duplicates or deleted categories", () => {
  const events = labelEvents(smallList());
  assert.deepEqual(events.map((event) => [event.text, event.categoryId, event.origin]), [
    ["Milch", "kuehl", "done-todo"],
    ["Tahini", "edeka", "checked"],
    ["Bananen", "obst", "checked"],
    ["Gouda", "kuehl", "checked"],
    ["Spaghetti", "trocken", "checked"],
    ["Tahini", "edeka", "checked"],
    ["Tahini", "trocken", "manual-move"],
    ["Tahini", "trocken", "checked"],
  ]);
});

test("the replay only shows a method what happened before each event", async () => {
  let checked = 0;
  const spy: EvalMethod = {
    name: "spy",
    predict(_text, context: EvalContext) {
      for (const sample of context.samples) assert.ok(new Date(sample.createdAt!).getTime() < context.at);
      for (const todo of context.doneTodos) assert.ok(new Date(todo.updatedAt || todo.createdAt!).getTime() < context.at);
      for (const label of context.labels) assert.ok(label.at < context.at);
      checked += 1;
      return null;
    },
  };
  const [report] = await replay(fixture, [spy]);
  assert.equal(checked, labelEvents(fixture).length);
  assert.equal(report.outcome.abstained, checked);
});

test("after a manual move both the current classifier and lookup-first follow the item", async () => {
  const data = smallList();
  const events = labelEvents(data);
  const checkAfterMove = events.at(-1)!;
  const context = contextAt(data, events, checkAfterMove.at);
  assert.equal((currentMethod.predict("Tahini", context) as { categoryId: string }).categoryId, "trocken");
  assert.equal((lookupFirst(currentMethod).predict("Tahini", context) as { categoryId: string }).categoryId, "trocken");

  const [current, lookup] = await replay(fixture, [currentMethod, lookupFirst(currentMethod)]);
  // The synthetic list's moved items no longer trip the current classifier up.
  assert.deepEqual(lookup.outcome, current.outcome);
});

test("naive Bayes sorts unseen variants of known items and is unsure about strangers", () => {
  const data = smallList();
  const context = contextAt(data, labelEvents(data), new Date(day(20)).getTime());
  const method = naiveBayesMethod();
  const milk = method.predict("Milch fettarm", context) as { categoryId: string; confidence: number };
  assert.equal(milk.categoryId, "kuehl");
  const noodles = method.predict("Spaghettini", context) as { categoryId: string };
  assert.equal(noodles.categoryId, "trocken");
  const stranger = method.predict("Glühbirne", context) as { confidence: number; auto: boolean };
  assert.equal(stranger.auto, false);
});

test("the threshold sweep reuses the same predictions", async () => {
  const [report] = await replay(fixture, [naiveBayesMethod()]);
  const sweep = thresholdSweep(report.results);
  const autos = sweep.map(({ outcome }) => outcome.autoCorrect + outcome.autoWrong);
  assert.deepEqual([...autos].sort((a, b) => b - a), autos, "a higher threshold never sorts more");
  for (const { outcome } of sweep) assert.equal(outcome.events, report.outcome.events);
});

test("the Jev adapter asks one choice question with readable options and maps the answer back", async () => {
  const data = smallList();
  const context = contextAt(data, labelEvents(data), new Date(day(20)).getTime());
  const { request } = buildJevRequest("Kichererbsen", context, "typesafe/jev-1.14");
  assert.equal(request.model, "typesafe/jev-1.14");
  assert.deepEqual(request.state, { item: "Kichererbsen" });
  const question = request.questions.category;
  assert.equal(question.type, "choice");
  assert.match(question.instructions, /shopping list/);
  assert.deepEqual(Object.keys(question.criteria), ["Obst & Gemüse", "Kühlregal", "Konserven & Trockenware", "EDEKA / EDEKA"]);
  assert.match(question.criteria["Konserven & Trockenware"], /typical items: Nudeln, Reis/);
  assert.match(question.criteria["Konserven & Trockenware"], /sorted here before: tahini, spaghetti/);

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const store = new Map<string, unknown>();
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      answers: { category: { choice: "Konserven & Trockenware", confidence: 0.91, probabilities: { "Konserven & Trockenware": 0.91, EDEKA: 0.09 } } },
      meta: { usd_spent: 0.00002 },
    }), { status: 200 });
  }) as unknown as typeof fetch;
  const jev = jevMethod({
    apiKey: "test-key",
    fetch: fakeFetch,
    maxRequests: 1,
    cache: {
      get: async (key: JevRequest) => store.get(JSON.stringify(key)) as never,
      set: async (key: JevRequest, value) => void store.set(JSON.stringify(key), value),
    },
  });
  const first = await jev.predict("Kichererbsen", context);
  assert.deepEqual(first, { categoryId: "trocken", confidence: 0.91, auto: true, suggest: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.aimlapi.com/v1/decisions");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), request);

  await jev.predict("Kichererbsen", context);
  assert.equal(calls.length, 1, "the second identical request comes from the cache");
  assert.equal(await jev.predict("Linsen", context), null, "the request cap holds");
  assert.deepEqual({ requests: jev.stats.requests, cached: jev.stats.cached, skipped: jev.stats.skipped }, { requests: 1, cached: 1, skipped: 1 });

  const fallback = jevFallbackMethod(jev);
  const known = await fallback.predict("Tahini", context);
  assert.equal(known?.categoryId, "trocken", "known items never reach Jev");
  assert.equal(calls.length, 1);
});

test("a category created after an event is not offered for it", () => {
  const data = {
    format: "smart-todos-list", version: 1, list: {},
    categories: [
      { id: "old", name: "Obst", createdAt: "2026-01-01T00:00:00Z" },
      { id: "new", name: "Drogerie", createdAt: "2026-03-01T00:00:00Z" },
      { id: "untimed", name: "Kühlregal" },
    ],
    todos: [], classifierHistory: [],
  };
  const context = contextAt(data, [], Date.parse("2026-02-01T00:00:00Z"));
  assert.deepEqual(context.categories.map((category) => category.id), ["old", "untimed"]);
});
