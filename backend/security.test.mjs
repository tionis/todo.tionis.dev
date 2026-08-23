import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
    database.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("owner", "issuer", "owner-sub", "owner@example.com", "Owner", now, now);
    database.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)")
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
