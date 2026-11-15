import assert from "node:assert/strict";
import test from "node:test";
import { classifyWithModel, modelOptions, modelSortingEnabled, type ModelSortableList } from "../lib/modelClassifier";
import { createTodoTransactions } from "../lib/todoTransactions";

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 9)).toISOString();

function list(overrides: Partial<ModelSortableList> = {}): ModelSortableList & { todos: any[] } {
  const kuehl = { id: "kuehl", name: "ALDI/Kühlregal", classifierKeywords: "Milch, Joghurt", order: 0 };
  const obst = { id: "obst", name: "Obst", group: "EDEKA", order: 1 };
  const drogerie = { id: "drogerie", name: "Drogerie", order: 2 };
  return {
    id: "list-1",
    autoSortTodos: true,
    classifierModel: true,
    classifierModelAvailable: true,
    sublists: [kuehl, obst, drogerie],
    todos: [
      { text: "Gouda", done: true, order: 1, sublist: { id: "kuehl" }, createdAt: day(1), updatedAt: day(2) },
      { text: "Bananen", done: false, order: 2, sublist: { id: "obst" }, createdAt: day(3) },
    ],
    todoClassifications: [
      { text: "2 Becher Sahne", source: "checked", sublist: { id: "kuehl" }, createdAt: day(4) },
      { text: "Äpfel", source: "quick-add", sublist: { id: "obst" }, createdAt: day(5) },
      { text: "Seife", source: "negative", sublist: { id: "drogerie" }, createdAt: day(6) },
    ],
    ...overrides,
  };
}

function withFetch(respond: (url: string, init: any) => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: any }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return respond(url, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const answer = (probabilities: Record<string, number>) => new Response(JSON.stringify({ probabilities }), { status: 200 });

test("the options describe each category by name, parent, keywords and recent items", () => {
  assert.deepEqual(modelOptions(list()), [
    { id: "kuehl", name: "Kühlregal", parent: "ALDI", keywords: ["Milch", "Joghurt"], examples: ["sahne", "gouda"] },
    { id: "obst", name: "Obst", parent: "EDEKA", examples: ["apfel"] },
    { id: "drogerie", name: "Drogerie" },
  ]);
});

test("the model is only asked when the server has one and the list turned it on", () => {
  assert.equal(modelSortingEnabled(list()), true);
  assert.equal(modelSortingEnabled(list({ classifierModel: false })), false);
  assert.equal(modelSortingEnabled(list({ classifierModelAvailable: false })), false);
  assert.equal(modelSortingEnabled(list({ autoSortTodos: false })), false);
  assert.equal(modelSortingEnabled(list({ sublists: [{ id: "a", name: "A" }] })), false);
});

test("a confident answer sorts, a medium one is a suggestion, a weak one nothing", async () => {
  const fake = withFetch((_url, init) => {
    const item = JSON.parse(init.body).item;
    return answer(item === "Milch" ? { kuehl: 0.95, obst: 0.05 } : item === "Tomaten" ? { obst: 0.6, kuehl: 0.4 } : { drogerie: 0.3, obst: 0.2 });
  });
  try {
    assert.deepEqual(await classifyWithModel(list(), " Milch "), { sublistId: "kuehl", confidence: 0.95, auto: true, suggest: true });
    assert.deepEqual(await classifyWithModel(list(), "Tomaten"), { sublistId: "obst", confidence: 0.6, auto: false, suggest: true });
    assert.deepEqual(await classifyWithModel(list(), "Kerzen"), { sublistId: "drogerie", confidence: 0.3, auto: false, suggest: false });
    assert.equal(fake.calls[0].url, "/api/lists/list-1/classify");
    assert.equal(fake.calls[0].body.item, "Milch");
    assert.equal(fake.calls[0].body.options.length, 3);
  } finally {
    fake.restore();
  }
});

test("errors, unknown categories and a list without the model give null, so the local classifier decides", async () => {
  const failing = withFetch(() => new Response(JSON.stringify({ error: "down" }), { status: 503 }));
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await classifyWithModel(list(), "Milch"), null);
  } finally {
    failing.restore();
    console.warn = warn;
  }
  const unknown = withFetch(() => answer({ elsewhere: 0.99 }));
  try {
    assert.equal(await classifyWithModel(list(), "Milch"), null);
  } finally {
    unknown.restore();
  }
  const untouched = withFetch(() => answer({ kuehl: 1 }));
  try {
    assert.equal(await classifyWithModel(list({ classifierModel: false }), "Milch"), null);
    assert.equal(untouched.calls.length, 0);
  } finally {
    untouched.restore();
  }
});

function categoryOf(transactions: any[]) {
  return transactions[0].operations.find((operation: any) => operation.kind === "link" && operation.links?.sublist)?.links.sublist;
}

test("a new todo follows the model's decision instead of the local classifier", () => {
  const todoList = list();
  const sorted = createTodoTransactions(todoList, "Gouda", undefined, "explicit", undefined, {
    decision: { sublistId: "drogerie", confidence: 0.9, auto: true, suggest: true },
  });
  assert.equal(categoryOf(sorted.transactions), "drogerie");
  assert.equal(sorted.classification?.reason, "model");
  // Auto-sorted items record no sample, like the local classifier's.
  assert.equal(sorted.transactions.length, 1);

  const suggested = createTodoTransactions(todoList, "Gouda", undefined, "explicit", undefined, {
    decision: { sublistId: "obst", confidence: 0.6, auto: false, suggest: true },
  });
  assert.equal(categoryOf(suggested.transactions), undefined);
  assert.equal(suggested.suggestedClassification?.sublistId, "obst");

  // A category picked by hand wins over the model.
  const explicit = createTodoTransactions(todoList, "Gouda", "kuehl", "explicit", undefined, {
    decision: { sublistId: "drogerie", confidence: 0.9, auto: true, suggest: true },
  });
  assert.equal(categoryOf(explicit.transactions), "kuehl");
});
