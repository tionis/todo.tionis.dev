// Runs the real backend and the built frontend (out/) for the browser sync tests.
// Two users share one private list; their session tokens are fixed test values.
import http from "node:http";
import { addSession, addUser, startTestServer } from "../backend/test-support.mjs";

// A stand-in for the chat model (port 4175): it picks the option named "Modellziel" with 95 %,
// otherwise the first with 30 %, and GET /last shows the last request it got.
let lastModelRequest = null;
const model = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/last") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(lastModelRequest));
    return;
  }
  let text = "";
  for await (const chunk of request) text += chunk;
  lastModelRequest = JSON.parse(text);
  const options = lastModelRequest.messages[1].content.split("\n").filter((line) => /^[A-Z]\) /.test(line));
  const target = options.find((line) => line.includes('"Modellziel"'));
  const letter = (target ?? options[0]).charAt(0);
  const logprob = Math.log(target ? 0.95 : 0.3);
  response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    choices: [{ message: { content: letter }, logprobs: { content: [{ token: letter, logprob, top_logprobs: [{ token: letter, logprob }] }] } }],
  }));
});
await new Promise((resolve) => model.listen(4175, "127.0.0.1", resolve));

const server = await startTestServer({
  port: 4174,
  env: { CLASSIFIER_MODEL_BASE_URL: "http://127.0.0.1:4175/v1", CLASSIFIER_MODEL_API_KEY: "e2e", CLASSIFIER_MODEL: "e2e/model" },
  staticDir: new URL("../out", import.meta.url).pathname,
  seed(database) {
    addUser(database, "alice", { username: "alice", name: "Alice" });
    addUser(database, "bob", { username: "bob", name: "Bob" });
    addUser(database, "carol", { username: "carol", name: "Carol" });
    addSession(database, "carol", "carol-first-session");
    addSession(database, "carol", "carol-second-session");
    addSession(database, "alice", "alice-e2e-session");
    addSession(database, "bob", "bob-e2e-session");
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO lists (id, owner_id, name, slug, permission, created_at, updated_at)
      VALUES ('shared-list', 'alice', 'Shared groceries', 'shared', 'private-write', ?, ?)
    `).run(now, now);
    database.prepare("INSERT INTO members (id, list_id, user_id, added_at) VALUES ('member-bob', 'shared-list', 'bob', ?)").run(now);
  },
});
console.log(`Sync e2e backend ready at ${server.origin}`);

async function shutdown() {
  model.close();
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
