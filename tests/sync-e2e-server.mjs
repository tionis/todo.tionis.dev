// Runs the real backend and the built frontend (out/) for the browser sync tests.
// Two users share one private list; their session tokens are fixed test values.
import { addSession, addUser, startTestServer } from "../backend/test-support.mjs";

const server = await startTestServer({
  port: 4174,
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
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
