import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { accessFor } from "./access.mjs";
import { openDatabase } from "./database.mjs";
import { consumeInvitation } from "./invitations.mjs";
import { mayExposeMemberIdentities } from "./privacy.mjs";

test("public outsiders cannot receive membership identities", () => {
  assert.equal(mayExposeMemberIdentities({ read: true, write: false, owner: false, member: false }), false);
  assert.equal(mayExposeMemberIdentities({ read: true, write: true, owner: false, member: true }), true);
  assert.equal(mayExposeMemberIdentities({ read: true, write: true, owner: true, member: false }), true);
});

test("an invitation is consumed once and cannot restore revoked membership", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "smart-todos-invitations-"));
  const database = openDatabase(directory);
  try {
    const now = new Date().toISOString();
    database.prepare("INSERT INTO users (id, issuer, subject, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("owner", "issuer", "owner-sub", "owner@example.com", "Owner", now, now);
    database.prepare("INSERT INTO users (id, issuer, subject, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("invitee", "issuer", "invitee-sub", "invitee@example.com", "Invitee", now, now);
    database.prepare(`
      INSERT INTO lists (id, owner_id, name, slug, permission, created_at, updated_at)
      VALUES ('list-1', 'owner', 'Groceries', 'groceries', 'private-write', ?, ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO invitations (id, list_id, inviter_id, email, role, status, invited_at)
      VALUES ('invite-1', 'list-1', 'owner', 'invitee@example.com', 'member', 'pending', ?)
    `).run(now);

    const invitation = database.prepare("SELECT * FROM invitations WHERE id = 'invite-1'").get();
    consumeInvitation(database, invitation, "invitee", "accepted", now);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM members WHERE user_id = 'invitee'").get().count, 1);

    database.prepare("DELETE FROM members WHERE user_id = 'invitee'").run();
    assert.throws(
      () => consumeInvitation(database, invitation, "invitee", "accepted", now),
      (error) => error.status === 409,
    );
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM members WHERE user_id = 'invitee'").get().count, 0);
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
