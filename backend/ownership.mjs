import crypto from "node:crypto";

export function transferListOwnership(database, {
  listId,
  currentOwnerId,
  newOwnerId,
  now = new Date().toISOString(),
  createId = () => crypto.randomUUID(),
}) {
  database.transaction(() => {
    const membership = database.prepare(`
      SELECT members.id FROM members
      JOIN users ON users.id = members.user_id
      WHERE members.list_id = ? AND members.user_id = ? AND users.active = 1
    `).get(listId, newOwnerId);
    if (!membership) throw Object.assign(new Error("The new owner must already be an active list member"), { status: 400 });

    const updated = database.prepare("UPDATE lists SET owner_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
      .run(newOwnerId, now, listId, currentOwnerId);
    if (updated.changes !== 1) throw Object.assign(new Error("List ownership changed before the transfer completed"), { status: 409 });
    database.prepare("DELETE FROM members WHERE id = ?").run(membership.id);
    database.prepare("INSERT INTO members (id, list_id, user_id, role, added_at) VALUES (?, ?, ?, 'member', ?)")
      .run(createId(), listId, currentOwnerId, now);
  })();
}
