import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase, upsertOidcUser } from "./database.mjs";
import {
  deactivateScimUser,
  handleScimRequest,
  replaceGroupMembers,
  scimGroupShape,
  scimUserShape,
  upsertScimGroup,
  upsertScimUser,
} from "./scim.mjs";

const issuer = "https://auth.example/application/o/todo/";
const config = { publicUrl: new URL("https://todo.example"), oidc: { issuer: new URL(issuer) } };

async function requestScim(database, method, pathname, body, token = "directory-secret") {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const request = {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    async *[Symbol.asyncIterator]() { yield* payload; },
  };
  const response = {
    headers: {}, status: null, body: "",
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(value = "") { this.body = String(value); },
  };
  await handleScimRequest(request, response, new URL(pathname, config.publicUrl), {
    database,
    config: { ...config, scimToken: "directory-secret" },
  });
  return response;
}

test("correlates SCIM users with OIDC subjects and preserves directory profiles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-scim-"));
  const database = openDatabase(directory);
  try {
    const provisioned = upsertScimUser(database, issuer, {
      externalId: "stable-subject",
      userName: "ada",
      displayName: "Ada Lovelace",
      emails: [{ value: "ada@example.com", primary: true }],
      active: true,
    });
    const loggedIn = upsertOidcUser(database, issuer, { sub: "stable-subject" });
    assert.equal(loggedIn.id, provisioned.id);
    assert.equal(loggedIn.username, "ada");
    assert.equal(loggedIn.name, "Ada Lovelace");
    assert.equal(loggedIn.emailVerified, 0);
    assert.equal(upsertOidcUser(database, issuer, { sub: "stable-subject", email: "ada@example.com" }).emailVerified, 1);
    assert.deepEqual(scimUserShape(provisioned, config).emails, [{ value: "ada@example.com", type: "work", primary: true }]);
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("serves Authentik-compatible bearer-authenticated SCIM resources and filters", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-scim-http-"));
  const database = openDatabase(directory);
  try {
    const unauthorized = await requestScim(database, "GET", "/scim/v2/ServiceProviderConfig", undefined, null);
    assert.equal(unauthorized.status, 401);

    const created = await requestScim(database, "POST", "/scim/v2/Users", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId: "http-subject",
      userName: "grace",
      displayName: "Grace Hopper",
      active: true,
    });
    assert.equal(created.status, 201);
    const user = JSON.parse(created.body);
    assert.equal(user.userName, "grace");

    const filtered = await requestScim(
      database,
      "GET",
      `/scim/v2/Users?filter=${encodeURIComponent('externalId eq "http-subject"')}`,
    );
    assert.equal(filtered.status, 200);
    assert.equal(JSON.parse(filtered.body).Resources[0].id, user.id);

    const groupResponse = await requestScim(database, "POST", "/scim/v2/Groups", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      externalId: "http-group",
      displayName: "Engineering",
      members: [{ value: user.id }],
    });
    assert.equal(groupResponse.status, 201);
    const group = JSON.parse(groupResponse.body);
    assert.equal(group.members[0].value, user.id);

    const patched = await requestScim(database, "PATCH", `/scim/v2/Groups/${group.id}`, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "Remove", path: `members[value eq "${user.id}"]` }],
    });
    assert.equal(patched.status, 200);
    assert.deepEqual(JSON.parse(patched.body).members, []);
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("synchronizes group membership and tombstones deprovisioned users", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-scim-"));
  const database = openDatabase(directory);
  try {
    const now = new Date().toISOString();
    const owner = upsertScimUser(database, issuer, { externalId: "owner-sub", userName: "owner" });
    const member = upsertScimUser(database, issuer, { externalId: "member-sub", userName: "member" });
    const group = upsertScimGroup(database, {
      externalId: "group-external",
      displayName: "Household",
      members: [{ value: member.id }],
    });
    database.prepare(`
      INSERT INTO lists (id, owner_id, name, slug, permission, created_at, updated_at)
      VALUES ('list-1', ?, 'Groceries', 'groceries', 'private-write', ?, ?)
    `).run(owner.id, now, now);
    database.prepare(`
      INSERT INTO list_group_grants (id, list_id, group_id, added_at)
      VALUES ('grant-1', 'list-1', ?, ?)
    `).run(group.id, now);
    database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('token', ?, ?)")
      .run(member.id, Date.now() + 60_000);

    assert.equal(scimGroupShape(database, group, config).members[0].value, member.id);
    assert.deepEqual(deactivateScimUser(database, member.id), ["list-1"]);
    assert.equal(database.prepare("SELECT active FROM users WHERE id = ?").get(member.id).active, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?").get(member.id).count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM directory_group_members WHERE user_id = ?").get(member.id).count, 0);

    assert.throws(
      () => replaceGroupMembers(database, group.id, [{ value: member.id }]),
      (error) => error.status === 400,
    );
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
