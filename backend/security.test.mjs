import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { accessFor } from "./access.mjs";
import { openDatabase } from "./database.mjs";
import { transferListOwnership } from "./ownership.mjs";
import { mayExposeMemberIdentities } from "./privacy.mjs";

test("public outsiders cannot receive membership identities", () => {
  assert.equal(mayExposeMemberIdentities({ read: true, write: false, owner: false, member: false }), false);
  assert.equal(mayExposeMemberIdentities({ read: true, write: true, owner: false, member: true }), true);
  assert.equal(mayExposeMemberIdentities({ read: true, write: true, owner: true, member: false }), true);
});

test("ownership transfer swaps owner membership and rolls back completely on failure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-ownership-"));
  const database = openDatabase(directory);
  try {
    const now = new Date().toISOString();
    const insertUser = database.prepare("INSERT INTO users (id, issuer, subject, active, created_at, updated_at) VALUES (?, 'issuer', ?, 1, ?, ?)");
    insertUser.run("owner", "owner", now, now);
    insertUser.run("member", "member", now, now);
    insertUser.run("other", "other", now, now);
    database.prepare("INSERT INTO lists (id, owner_id, name, slug, permission, created_at, updated_at) VALUES ('list-1', 'owner', 'List', 'list', 'private-write', ?, ?)").run(now, now);
    database.prepare("INSERT INTO members (id, list_id, user_id, role, added_at) VALUES ('member-row', 'list-1', 'member', 'member', ?)").run(now);

    transferListOwnership(database, { listId: "list-1", currentOwnerId: "owner", newOwnerId: "member", now, createId: () => "former-owner-row" });
    assert.equal(database.prepare("SELECT owner_id FROM lists WHERE id = 'list-1'").get().owner_id, "member");
    assert.deepEqual(database.prepare("SELECT id, user_id FROM members WHERE list_id = 'list-1'").all(), [{ id: "former-owner-row", user_id: "owner" }]);

    database.prepare("INSERT INTO members (id, list_id, user_id, role, added_at) VALUES ('conflict-row', 'list-1', 'other', 'member', ?)").run(now);
    assert.throws(() => transferListOwnership(database, {
      listId: "list-1",
      currentOwnerId: "member",
      newOwnerId: "owner",
      now,
      createId: () => "conflict-row",
    }), /UNIQUE constraint failed/);
    assert.equal(database.prepare("SELECT owner_id FROM lists WHERE id = 'list-1'").get().owner_id, "member");
    assert.deepEqual(database.prepare("SELECT id, user_id FROM members WHERE list_id = 'list-1' ORDER BY id").all(), [
      { id: "conflict-row", user_id: "other" },
      { id: "former-owner-row", user_id: "owner" },
    ]);
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("directory group membership grants and revokes private list access", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-groups-"));
  const database = openDatabase(directory);
  try {
    const now = new Date().toISOString();
    const insertUser = database.prepare(`
      INSERT INTO users (id, issuer, subject, username, created_at, updated_at)
      VALUES (?, 'issuer', ?, ?, ?, ?)
    `);
    insertUser.run("owner", "owner-sub", "owner", now, now);
    insertUser.run("member", "member-sub", "member", now, now);
    database.prepare(`
      INSERT INTO lists (id, owner_id, name, slug, permission, created_at, updated_at)
      VALUES ('list-1', 'owner', 'Groceries', 'groceries', 'private-write', ?, ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO directory_groups (id, external_id, display_name, created_at, updated_at)
      VALUES ('group-1', 'external-group', 'Household', ?, ?)
    `).run(now, now);
    database.prepare("INSERT INTO directory_group_members (group_id, user_id) VALUES ('group-1', 'member')").run();
    database.prepare(`
      INSERT INTO list_group_grants (id, list_id, group_id, added_at)
      VALUES ('grant-1', 'list-1', 'group-1', ?)
    `).run(now);

    const list = database.prepare("SELECT * FROM lists WHERE id = 'list-1'").get();
    assert.deepEqual(accessFor(database, list, { id: "member" }), {
      read: true, write: true, owner: false, member: true, directMember: false, groupMember: true,
    });
    database.prepare("DELETE FROM directory_group_members WHERE group_id = 'group-1' AND user_id = 'member'").run();
    assert.equal(accessFor(database, list, { id: "member" }).read, false);
  } finally {
    database.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
