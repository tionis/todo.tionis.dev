import assert from "node:assert/strict";
import test from "node:test";
import { contextAt, type EvalExport } from "../lib/classifier-eval";
import {
  buildChoiceRequest,
  embeddingMethod,
  letterProbabilities,
  llmChoiceMethod,
  neighbourVote,
} from "../lib/classifier-eval-models";

const data: EvalExport = {
  format: "smart-todos-list",
  version: 1,
  list: { name: "Einkauf" },
  categories: [
    { id: "kuehl", name: "Kühlwaren" },
    { id: "getraenke", name: "Getränke" },
    { id: "drogerie", name: "Drogerie", group: "EDEKA" },
  ],
  todos: [],
  classifierHistory: [
    { id: "1", text: "Käse", source: "checked", categoryId: "kuehl", createdAt: "2026-05-01T10:00:00Z" },
    { id: "2", text: "Cola", source: "checked", categoryId: "getraenke", createdAt: "2026-05-01T10:01:00Z" },
    { id: "3", text: "Zahnpasta", source: "checked", categoryId: "drogerie", createdAt: "2026-05-01T10:02:00Z" },
  ],
};
const context = contextAt(data, [], Date.parse("2026-06-01T00:00:00Z"));

function fakeFetch(respond: (url: string, body: any) => unknown) {
  const calls: Array<{ url: string; body: any; headers: any }> = [];
  const fetchImpl = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    return { ok: true, json: async () => respond(url, body), text: async () => "" };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

test("the choice request letters each category with its description and examples", () => {
  const { letters, body } = buildChoiceRequest("Gouda", context, "some/model");
  assert.deepEqual([...letters.values()], ["kuehl", "getraenke", "drogerie"]);
  const prompt = body.messages[1].content;
  assert.match(prompt, /^Options:\n/);
  assert.match(prompt, /\n\nItem: Gouda$/);
  assert.match(prompt, /A\) Section "Kühlwaren"; sorted here before: kase/);
  assert.match(prompt, /C\) Section "Drogerie"; in "EDEKA"/);
  assert.equal(body.logprobs, true);
  assert.equal(body.max_tokens, 1);
  assert.doesNotMatch(body.messages[0].content, /How this household sorts/);
});

test("a list's steering instructions go into the system prompt", () => {
  const { body } = buildChoiceRequest("Gouda", context, "some/model", "  Cheese goes to EDEKA.\n");
  assert.match(body.messages[0].content, /How this household sorts:\nCheese goes to EDEKA\.\n\nAnswer with the letter/);
});

test("letter probabilities come from the first token's alternatives, renormalised over the options", () => {
  const letters = new Map([["A", "kuehl"], ["B", "getraenke"]]);
  const probabilities = letterProbabilities({
    choices: [{ logprobs: { content: [{ token: "A", logprob: Math.log(0.6), top_logprobs: [
      { token: "A", logprob: Math.log(0.6) },
      { token: " B", logprob: Math.log(0.2) },
      { token: "Z", logprob: Math.log(0.2) },
    ] }] } }],
  }, letters)!;
  assert.ok(Math.abs(probabilities.get("A")! - 0.75) < 1e-9);
  assert.ok(Math.abs(probabilities.get("B")! - 0.25) < 1e-9);
  assert.equal(letterProbabilities({ choices: [{ message: { content: "A" } }] }, letters), null);
});

test("the LLM method sorts on a confident answer and only suggests without log probabilities", async () => {
  const confident = fakeFetch(() => ({
    choices: [{ logprobs: { content: [{ token: "A", logprob: Math.log(0.95), top_logprobs: [{ token: "A", logprob: Math.log(0.95) }, { token: "B", logprob: Math.log(0.05) }] }] } }],
    usage: { cost: 0.00001 },
  }));
  const method = llmChoiceMethod({ apiKey: "key", baseUrl: "https://openrouter.test/api/v1/", model: "m", fetch: confident.fetchImpl });
  const prediction = await method.predict("Gouda", context);
  assert.deepEqual({ ...prediction, confidence: Math.round(prediction!.confidence * 100) }, { categoryId: "kuehl", confidence: 95, auto: true, suggest: true });
  assert.equal(confident.calls[0].url, "https://openrouter.test/api/v1/chat/completions");
  assert.equal(confident.calls[0].headers.Authorization, "Bearer key");
  assert.equal(method.stats.usdSpent, 0.00001);

  const plain = fakeFetch(() => ({ choices: [{ message: { content: "B" } }] }));
  const local = llmChoiceMethod({ baseUrl: "http://localhost:11434/v1", model: "m", fetch: plain.fetchImpl });
  const suggestion = await local.predict("Spezi", context);
  assert.equal(suggestion!.categoryId, "getraenke");
  assert.equal(suggestion!.auto, false);
  assert.equal(suggestion!.suggest, true);
  assert.equal(plain.calls[0].headers.Authorization, undefined);
  assert.equal(local.stats.withoutLogprobs, 1);
});

test("neighbour vote favours the closest examples", () => {
  const vote = neighbourVote([1, 0], [
    { categoryId: "kuehl", vector: [0.99, 0.1] },
    { categoryId: "kuehl", vector: [0.95, 0.3] },
    { categoryId: "getraenke", vector: [0.2, 0.98] },
  ])!;
  assert.equal(vote.categoryId, "kuehl");
  assert.ok(vote.confidence > 0.99);
});

test("the embedding method embeds each text once and votes by similarity", async () => {
  const axis: Record<string, number[]> = {
    gouda: [1, 0, 0], kase: [0.95, 0.05, 0], kuhlwaren: [0.8, 0.2, 0],
    cola: [0, 1, 0], getranke: [0.1, 0.9, 0],
    zahnpasta: [0, 0, 1], drogerie: [0, 0.1, 0.9],
  };
  const { fetchImpl, calls } = fakeFetch((_url, body) => ({
    data: body.input.map((text: string, index: number) => ({ index, embedding: axis[text] ?? [0.3, 0.3, 0.3] })),
  }));
  const method = embeddingMethod({ apiKey: "key", baseUrl: "https://openrouter.test/api/v1", model: "e", fetch: fetchImpl });
  const first = await method.predict("Gouda", context);
  assert.equal(first!.categoryId, "kuehl");
  await method.predict("Gouda", context);
  assert.equal(calls.length, 1, "known texts are not embedded again");
  assert.equal(calls[0].url, "https://openrouter.test/api/v1/embeddings");
});
