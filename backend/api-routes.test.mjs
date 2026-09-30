import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import * as Automerge from "@automerge/automerge";
import { addGroup, addSession, addUser, startTestServer } from "./test-support.mjs";

let server;
let api;

before(async () => {
  server = await startTestServer({
    seed(database) {
      addUser(database, "owner", { username: "olivia", name: "Olivia Owner" });
      addUser(database, "alice", { username: "alice", name: "Alice Anders", email: "alice@example.test" });
      addUser(database, "bob", { username: "bob", name: "Bob Baker" });
      addUser(database, "carol", { username: "carol", name: "Carol Clark" });
      for (const id of ["owner", "alice", "bob", "carol"]) addSession(database, id, `${id}-session`);
      addSession(database, "alice", "alice-second-session");
      addGroup(database, "team", "Kitchen Team", ["carol"]);
    },
  });
  api = server.api;
});

after(async () => { await server?.stop(); });

async function createList(slug, permission = "private-write", owner = "owner-session") {
  const created = await api(owner, "POST", "/api/lists", { name: `List ${slug}`, slug, permission });
  assert.equal(created.status, 201);
  return created.json.list.id;
}

describe("lists", () => {
  test("creating validates input and refuses a duplicate slug", async () => {
    await createList("validation");
    assert.equal((await api("owner-session", "POST", "/api/lists", { name: "Again", slug: "validation" })).status, 409);
    assert.equal((await api("owner-session", "POST", "/api/lists", { name: "x", slug: "y", id: "../escape" })).status, 400);
    assert.equal((await api("owner-session", "POST", "/api/lists", { name: "x", slug: "z", classifierAggressiveness: "wild" })).status, 400);
    assert.equal((await api("owner-session", "POST", "/api/lists", { name: 5, slug: "n" })).status, 400);
    assert.equal((await api("owner-session", "POST", "/api/lists", "{not json")).status, 400);
    assert.equal((await api(undefined, "POST", "/api/lists", { name: "a", slug: "anon" })).status, 401);
  });

  test("private lists are only readable by people with access", async () => {
    await createList("private-one");
    assert.equal((await api("owner-session", "GET", "/api/lists/private-one")).status, 200);
    assert.equal((await api("bob-session", "GET", "/api/lists/private-one")).status, 403);
    assert.equal((await api(undefined, "GET", "/api/lists/private-one")).status, 403);
    assert.equal((await api("bob-session", "GET", "/api/lists/missing")).status, 404);
    assert.equal((await api("bob-session", "GET", "/api/lists/%E0%A4%A")).status, 400);
  });

  test("public-read lists are readable but not writable by outsiders", async () => {
    const id = await createList("public-read-list", "public-read");
    assert.equal((await api(undefined, "GET", "/api/lists/public-read-list")).status, 200);
    const read = await api(undefined, "GET", "/api/lists/public-read-list");
    const document = Automerge.change(Automerge.load(Buffer.from(read.json.document, "base64")), (draft) => {
      draft.todos.x = { id: "x", text: "x", done: false };
    });
    const upload = { document: Buffer.from(Automerge.save(document)).toString("base64") };
    assert.equal((await api("bob-session", "POST", `/api/lists/${id}/document`, upload)).status, 403);
    // public-read is read-only for everyone, the owner included.
    assert.equal((await api("owner-session", "POST", `/api/lists/${id}/document`, upload)).status, 403);
  });

  test("anonymous callers may write only to public-write lists", async () => {
    const id = await createList("public-write-list", "public-write");
    const read = await api(undefined, "GET", "/api/lists/public-write-list");
    const document = Automerge.change(Automerge.load(Buffer.from(read.json.document, "base64")), (draft) => {
      draft.todos.y = { id: "y", text: "y", done: false };
    });
    const upload = { document: Buffer.from(Automerge.save(document)).toString("base64") };
    assert.equal((await api(undefined, "POST", `/api/lists/${id}/document`, upload)).status, 200);
    assert.equal((await api("owner-session", "POST", `/api/lists/${id}/document`, { document: "bm90IGF1dG9tZXJnZQ==" })).status, 400);
  });

  test("only the owner can change settings or delete", async () => {
    const id = await createList("settings");
    assert.equal((await api("bob-session", "PATCH", `/api/lists/${id}`, { name: "Hijack" })).status, 403);
    assert.equal((await api("owner-session", "PATCH", `/api/lists/${id}`, { tags: 5 })).status, 400);
    const patched = await api("owner-session", "PATCH", `/api/lists/${id}`, { name: "Renamed", hideCompleted: true });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.list.name, "Renamed");
    assert.equal(patched.json.list.hideCompleted, true);
    assert.equal((await api("bob-session", "DELETE", `/api/lists/${id}`)).status, 403);
    assert.equal((await api("owner-session", "DELETE", `/api/lists/${id}`)).status, 200);
    assert.equal((await api("owner-session", "GET", `/api/lists/${id}`)).status, 404);
  });

  test("state-changing requests from another origin are refused", async () => {
    const response = await api("owner-session", "POST", "/api/lists", { name: "x", slug: "cross" }, { Origin: "https://evil.example" });
    assert.equal(response.status, 403);
  });
});

describe("pins", () => {
  test("public lists can be pinned and unpinned, private ones cannot", async () => {
    const publicId = await createList("pin-public", "public-read");
    const privateId = await createList("pin-private");
    assert.equal((await api("bob-session", "POST", `/api/lists/${privateId}/pin`)).status, 403);
    assert.equal((await api("bob-session", "POST", `/api/lists/${publicId}/pin`)).status, 200);
    let lists = (await api("bob-session", "GET", "/api/lists")).json.lists;
    assert.ok(lists.some((list) => list.id === publicId));
    assert.equal((await api("bob-session", "DELETE", `/api/lists/${publicId}/pin`)).status, 200);
    lists = (await api("bob-session", "GET", "/api/lists")).json.lists;
    assert.ok(!lists.some((list) => list.id === publicId));
  });
});

describe("sharing", () => {
  test("directory search is owner-only and hides existing members", async () => {
    const id = await createList("search");
    assert.equal((await api("bob-session", "GET", `/api/lists/${id}/share-targets?q=ali`)).status, 403);
    const short = await api("owner-session", "GET", `/api/lists/${id}/share-targets?q=a`);
    assert.deepEqual(short.json, { users: [], groups: [] });
    const found = await api("owner-session", "GET", `/api/lists/${id}/share-targets?q=ali`);
    assert.deepEqual(found.json.users.map((user) => user.id), ["alice"]);
    const groups = await api("owner-session", "GET", `/api/lists/${id}/share-targets?q=kitchen`);
    assert.deepEqual(groups.json.groups.map((group) => group.id), ["team"]);

    await api("owner-session", "POST", `/api/lists/${id}/members`, { userId: "alice" });
    const after = await api("owner-session", "GET", `/api/lists/${id}/share-targets?q=ali`);
    assert.deepEqual(after.json.users, []);
  });

  test("members gain access and can leave; owners can remove them", async () => {
    const id = await createList("members");
    assert.equal((await api("bob-session", "POST", `/api/lists/${id}/members`, { userId: "bob" })).status, 403);
    assert.equal((await api("owner-session", "POST", `/api/lists/${id}/members`, { userId: "nobody" })).status, 400);
    assert.equal((await api("owner-session", "POST", `/api/lists/${id}/members`, { userId: "owner" })).status, 400);
    const added = await api("owner-session", "POST", `/api/lists/${id}/members`, { userId: "alice" });
    assert.equal(added.status, 201);
    assert.equal((await api("alice-session", "GET", `/api/lists/${id}`)).status, 200);
    assert.equal((await api("owner-session", "POST", `/api/lists/${id}/members`, { userId: "alice" })).status, 200);

    assert.equal((await api("bob-session", "DELETE", `/api/members/${added.json.id}`)).status, 403);
    assert.equal((await api("alice-session", "DELETE", `/api/members/${added.json.id}`)).status, 200);
    assert.equal((await api("alice-session", "GET", `/api/lists/${id}`)).status, 403);

    const again = await api("owner-session", "POST", `/api/lists/${id}/members`, { userId: "bob" });
    assert.equal((await api("owner-session", "DELETE", `/api/members/${again.json.id}`)).status, 200);
    assert.equal((await api("bob-session", "GET", `/api/lists/${id}`)).status, 403);
  });

  test("group grants give members of the group access until revoked", async () => {
    const id = await createList("groups");
    assert.equal((await api("carol-session", "GET", `/api/lists/${id}`)).status, 403);
    assert.equal((await api("bob-session", "POST", `/api/lists/${id}/groups`, { groupId: "team" })).status, 403);
    assert.equal((await api("owner-session", "POST", `/api/lists/${id}/groups`, { groupId: "unknown" })).status, 400);
    const granted = await api("owner-session", "POST", `/api/lists/${id}/groups`, { groupId: "team" });
    assert.equal(granted.status, 201);
    assert.equal((await api("carol-session", "GET", `/api/lists/${id}`)).status, 200);
    assert.equal((await api("carol-session", "DELETE", `/api/group-grants/${granted.json.id}`)).status, 403);
    assert.equal((await api("owner-session", "DELETE", `/api/group-grants/${granted.json.id}`)).status, 200);
    assert.equal((await api("carol-session", "GET", `/api/lists/${id}`)).status, 403);
  });

  test("ownership transfers only to an existing member", async () => {
    const id = await createList("transfer");
    assert.equal((await api("owner-session", "POST", `/api/lists/${id}/transfer`, { userId: "bob" })).status, 400);
    await api("owner-session", "POST", `/api/lists/${id}/members`, { userId: "bob" });
    assert.equal((await api("alice-session", "POST", `/api/lists/${id}/transfer`, { userId: "bob" })).status, 403);
    assert.equal((await api("owner-session", "POST", `/api/lists/${id}/transfer`, {})).status, 400);
    assert.equal((await api("owner-session", "POST", `/api/lists/${id}/transfer`, { userId: "bob" })).status, 200);
    const asBob = await api("bob-session", "GET", `/api/lists/${id}`);
    assert.equal(asBob.json.list.access.owner, true);
    const asFormerOwner = await api("owner-session", "GET", `/api/lists/${id}`);
    assert.equal(asFormerOwner.json.list.access.owner, false);
    assert.equal(asFormerOwner.json.list.access.read, true);
  });

  test("only the owner can reset the classifier", async () => {
    const id = await createList("classifier");
    assert.equal((await api("bob-session", "POST", `/api/lists/${id}/classifier/reset`, {})).status, 403);
    const reset = await api("owner-session", "POST", `/api/lists/${id}/classifier/reset`, { resetAt: "2026-05-01T00:00:00.000Z" });
    assert.equal(reset.status, 200);
    assert.equal(reset.json.resetAt, "2026-05-01T00:00:00.000Z");
  });
});

describe("retries and sessions", () => {
  test("a retried command with the same Idempotency-Key gets the first response back", async () => {
    const id = await createList("idempotent");
    const headers = { "Idempotency-Key": "retry-key-0001" };
    const first = await api("owner-session", "POST", `/api/lists/${id}/members`, { userId: "carol" }, headers);
    assert.equal(first.status, 201);
    const retry = await api("owner-session", "POST", `/api/lists/${id}/members`, { userId: "carol" }, headers);
    assert.equal(retry.status, 201);
    assert.equal(retry.headers.get("idempotency-replayed"), "true");
    assert.equal(retry.json.id, first.json.id);
    const misuse = await api("owner-session", "PATCH", `/api/lists/${id}`, { name: "x" }, headers);
    assert.equal(misuse.status, 422);
  });

  test("anonymous writers can retry safely too", async () => {
    const id = await createList("anonymous-retry", "public-write");
    const read = await api(undefined, "GET", `/api/lists/${id}`);
    const document = Automerge.change(Automerge.load(Buffer.from(read.json.document, "base64")), (draft) => {
      draft.todos.z = { id: "z", text: "z", done: false };
    });
    const upload = { document: Buffer.from(Automerge.save(document)).toString("base64") };
    const headers = { "Idempotency-Key": "anonymous-retry-01" };
    assert.equal((await api(undefined, "POST", `/api/lists/${id}/document`, upload, headers)).status, 200);
    const retry = await api(undefined, "POST", `/api/lists/${id}/document`, upload, headers);
    assert.equal(retry.headers.get("idempotency-replayed"), "true");
  });

  test("signing out everywhere ends every session of the user", async () => {
    assert.equal((await api("alice-second-session", "GET", "/api/auth/session")).json.user.id, "alice");
    assert.equal((await api("alice-session", "POST", "/api/auth/logout", { all: true })).status, 200);
    assert.equal((await api("alice-second-session", "GET", "/api/auth/session")).json.user, null);
    assert.equal((await api("alice-session", "GET", "/api/auth/session")).json.user, null);
    assert.equal((await api("bob-session", "GET", "/api/auth/session")).json.user.id, "bob");
  });

  test("a plain sign-out only ends the current session", async () => {
    assert.equal((await api("carol-session", "POST", "/api/auth/logout", {})).status, 200);
    assert.equal((await api("carol-session", "GET", "/api/auth/session")).json.user, null);
  });
});
