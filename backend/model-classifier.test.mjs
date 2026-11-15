import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { buildChoiceRequest, invalidClassifyRequest, letterProbabilities } from "../shared/model-classifier.mjs";
import { addSession, addUser, freePort, startTestServer } from "./test-support.mjs";

// A stand-in for OpenRouter: answers every chat completion with log probabilities that favour
// the letter `answer`, and records what it was asked.
function startModelServer() {
  const calls = [];
  const state = { answer: "B", status: 200, logprobs: true };
  const server = http.createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    calls.push({ url: request.url, headers: request.headers, body: JSON.parse(text) });
    if (state.status !== 200) {
      response.writeHead(state.status).end();
      return;
    }
    const top = [{ token: state.answer, logprob: Math.log(0.9) }, { token: "A", logprob: Math.log(0.1) }]
      .filter((entry, index, all) => all.findIndex((other) => other.token === entry.token) === index);
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      choices: [{
        message: { content: state.answer },
        logprobs: state.logprobs ? { content: [{ token: state.answer, logprob: Math.log(0.9), top_logprobs: top }] } : null,
      }],
    }));
  });
  return { server, calls, state };
}

const options = [
  { id: "kuehl", name: "Kühlregal", parent: "ALDI", keywords: ["Milch"], examples: ["schinken"] },
  { id: "obst", name: "Obst", parent: "EDEKA" },
  { id: "drogerie", name: "Drogerie" },
];

describe("the classify request", () => {
  test("puts the options first, the item last and the household's rules into the system prompt", () => {
    const { letters, body } = buildChoiceRequest({ model: "m", item: "Gouda", options, instructions: " Käse kommt ins Kühlregal. " });
    assert.deepEqual([...letters], [["A", "kuehl"], ["B", "obst"], ["C", "drogerie"]]);
    assert.match(body.messages[0].content, /How this household sorts:\nKäse kommt ins Kühlregal\.\n\nAnswer with the letter/);
    assert.equal(body.messages[1].content, [
      "Options:",
      'A) Section "Kühlregal"; in "ALDI"; typical items: Milch; sorted here before: schinken',
      'B) Section "Obst"; in "EDEKA"',
      'C) Section "Drogerie"',
      "",
      "Item: Gouda",
    ].join("\n"));
    assert.equal(body.max_tokens, 1);
    assert.equal(body.logprobs, true);
  });

  test("letter probabilities ignore tokens that are not options", () => {
    const letters = new Map([["A", "x"], ["B", "y"]]);
    const result = letterProbabilities({ choices: [{ logprobs: { content: [{ token: "A", logprob: 0, top_logprobs: [
      { token: "A", logprob: Math.log(0.6) }, { token: "B)", logprob: Math.log(0.2) }, { token: "Z", logprob: Math.log(0.2) },
    ] }] } }] }, letters);
    assert.ok(Math.abs(result.get("A") - 0.75) < 1e-9);
    assert.equal(letterProbabilities({ choices: [{ message: { content: "A" } }] }, letters), null);
  });

  test("requests from the browser are checked before anything is sent", () => {
    assert.equal(invalidClassifyRequest({ item: "Milch", options }), null);
    assert.match(invalidClassifyRequest({ item: "", options }), /Item/);
    assert.match(invalidClassifyRequest({ item: "Milch", options: options.slice(0, 1) }), /options/);
    assert.match(invalidClassifyRequest({ item: "Milch", options: [...options, options[0]] }), /id/);
    assert.match(invalidClassifyRequest({ item: "Milch", options: [{ id: "a", name: "A" }, { id: "b", name: "B", examples: "x" }] }), /examples/);
    assert.match(invalidClassifyRequest({ item: "x".repeat(201), options }), /Item/);
  });
});

describe("POST /api/lists/:id/classify", () => {
  let model;
  let server;
  let listId;

  before(async () => {
    model = startModelServer();
    const modelPort = await freePort();
    await new Promise((resolve) => model.server.listen(modelPort, "127.0.0.1", resolve));
    server = await startTestServer({
      env: { CLASSIFIER_MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/v1`, CLASSIFIER_MODEL_API_KEY: "test-key", CLASSIFIER_MODEL: "test/model" },
      seed(database) {
        for (const id of ["owner", "bob"]) {
          addUser(database, id);
          addSession(database, id, `${id}-session`);
        }
      },
    });
    const created = await server.api("owner-session", "POST", "/api/lists", { name: "Einkauf", slug: "einkauf" });
    listId = created.json.list.id;
    assert.equal(created.json.list.classifierModel, false);
    assert.equal(created.json.list.classifierModelAvailable, true);
  });

  after(async () => {
    await server?.stop();
    await new Promise((resolve) => model?.server.close(resolve));
  });

  test("is refused while the list has it off, and the owner turns it on with steering text", async () => {
    assert.equal((await server.api("owner-session", "POST", `/api/lists/${listId}/classify`, { item: "Milch", options })).status, 409);
    assert.equal((await server.api("owner-session", "PATCH", `/api/lists/${listId}`, { classifierModel: "yes" })).status, 400);
    assert.equal((await server.api("owner-session", "PATCH", `/api/lists/${listId}`, { classifierInstructions: "x".repeat(2001) })).status, 400);
    const updated = await server.api("owner-session", "PATCH", `/api/lists/${listId}`, {
      classifierModel: true, classifierInstructions: "  Käse kommt ins Kühlregal.  ",
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.list.classifierModel, true);
    assert.equal(updated.json.list.classifierInstructions, "Käse kommt ins Kühlregal.");
    assert.equal(model.calls.length, 0);
  });

  test("answers with a probability per category and caches the model's answer", async () => {
    const first = await server.api("owner-session", "POST", `/api/lists/${listId}/classify`, { item: "Äpfel", options });
    assert.equal(first.status, 200);
    assert.deepEqual(Object.keys(first.json.probabilities), ["obst", "kuehl"]);
    assert.ok(Math.abs(first.json.probabilities.obst - 0.9) < 1e-9);
    assert.equal(first.json.cached, false);
    assert.equal(model.calls.length, 1);
    const [call] = model.calls;
    assert.equal(call.url, "/v1/chat/completions");
    assert.equal(call.headers.authorization, "Bearer test-key");
    assert.equal(call.body.model, "test/model");
    assert.match(call.body.messages[0].content, /Käse kommt ins Kühlregal\./);
    assert.match(call.body.messages[1].content, /\n\nItem: Äpfel$/);

    const again = await server.api("owner-session", "POST", `/api/lists/${listId}/classify`, { item: "Äpfel", options });
    assert.equal(again.json.cached, true);
    assert.deepEqual(again.json.probabilities, first.json.probabilities);
    assert.equal(model.calls.length, 1);
  });

  test("an answer without log probabilities is only good enough for a suggestion", async () => {
    model.state.logprobs = false;
    model.state.answer = "C";
    const result = await server.api("owner-session", "POST", `/api/lists/${listId}/classify`, { item: "Zahnpasta", options });
    model.state.logprobs = true;
    model.state.answer = "B";
    assert.deepEqual(result.json.probabilities, { drogerie: 0.5 });
  });

  test("a failing model answers 503 so the browser falls back to its own classifier", async () => {
    model.state.status = 500;
    const result = await server.api("owner-session", "POST", `/api/lists/${listId}/classify`, { item: "Brot", options });
    model.state.status = 200;
    assert.equal(result.status, 503);
  });

  test("needs a signed-in person who may write to the list, and valid options", async () => {
    assert.equal((await server.api(undefined, "POST", `/api/lists/${listId}/classify`, { item: "Milch", options })).status, 401);
    assert.equal((await server.api("bob-session", "POST", `/api/lists/${listId}/classify`, { item: "Milch", options })).status, 403);
    assert.equal((await server.api("owner-session", "POST", `/api/lists/${listId}/classify`, { item: "Milch", options: [] })).status, 400);
    assert.equal((await server.api("owner-session", "POST", `/api/lists/${listId}/classify`, { item: "Milch", options },
      { Origin: "https://elsewhere.example" })).status, 403);
  });
});

test("a server without CLASSIFIER_MODEL_* says the model is unavailable", async () => {
  const server = await startTestServer({
    env: { CLASSIFIER_MODEL_BASE_URL: "", CLASSIFIER_MODEL_API_KEY: "", OPENROUTER_API_KEY: "" },
    seed(database) {
      addUser(database, "owner");
      addSession(database, "owner", "owner-session");
    },
  });
  try {
    const created = await server.api("owner-session", "POST", "/api/lists", { name: "L", slug: "l", classifierModel: true });
    assert.equal(created.json.list.classifierModelAvailable, false);
    assert.equal((await server.api("owner-session", "POST", `/api/lists/${created.json.list.id}/classify`, { item: "Milch", options })).status, 503);
  } finally {
    await server.stop();
  }
});
