import crypto from "node:crypto";

export function consumeInvitation(database, invitation, userId, status, now = new Date().toISOString()) {
  const transaction = database.transaction(() => {
    const result = database.prepare(
      "UPDATE invitations SET status = ? WHERE id = ? AND status = 'pending'"
    ).run(status, invitation.id);
    if (result.changes !== 1) {
      throw Object.assign(new Error("Invitation has already been used"), { status: 409 });
    }
    if (status === "accepted") {
      database.prepare(
        "INSERT OR IGNORE INTO members (id, list_id, user_id, role, added_at) VALUES (?, ?, ?, ?, ?)"
      ).run(crypto.randomUUID(), invitation.list_id, userId, invitation.role, now);
    }
  });
  transaction();
}
