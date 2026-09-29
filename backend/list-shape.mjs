import { accessFor as calculateAccess } from "./access.mjs";
import { mayExposeMemberIdentities } from "./privacy.mjs";

// Row lookups and the JSON shapes the API and WebSocket metadata share.
export function createListShaper({ database }) {
  function listRowById(id) {
    return database.prepare("SELECT * FROM lists WHERE id = ?").get(id);
  }

  function accessFor(list, user) {
    return calculateAccess(database, list, user);
  }

  function dashboardUserIdsForList(listId) {
    return database.prepare(`
      SELECT owner_id AS user_id FROM lists WHERE id = ?
      UNION SELECT user_id FROM members WHERE list_id = ?
      UNION SELECT user_id FROM pins WHERE list_id = ?
      UNION SELECT memberships.user_id
        FROM list_group_grants grants
        JOIN directory_group_members memberships ON memberships.group_id = grants.group_id
        WHERE grants.list_id = ?
    `).all(listId, listId, listId, listId).map((row) => row.user_id);
  }

  function userShape(row) {
    return row ? {
      id: row.id,
      email: row.email,
      name: row.name,
      username: row.username,
      ...(row.active === undefined ? {} : { active: !!row.active }),
    } : null;
  }

  function listShape(row, user, full = false) {
    const access = accessFor(row, user);
    const exposeMemberIdentities = mayExposeMemberIdentities(access);
    const owner = exposeMemberIdentities
      ? database.prepare("SELECT id, email, name, username, active FROM users WHERE id = ?").get(row.owner_id)
      : null;
    const members = full && exposeMemberIdentities ? database.prepare(`
      SELECT members.id, members.role, members.added_at, users.id AS user_id,
        users.email, users.name, users.username, users.active
      FROM members JOIN users ON users.id = members.user_id
      WHERE members.list_id = ? ORDER BY members.added_at
    `).all(row.id).map((member) => ({
      id: member.id,
      role: member.role,
      addedAt: member.added_at,
      user: {
        id: member.user_id,
        email: member.email,
        name: member.name,
        username: member.username,
        active: !!member.active,
      },
    })) : [];
    const groupGrants = full && exposeMemberIdentities ? database.prepare(`
      SELECT grants.id, grants.role, grants.added_at, groups.id AS group_id,
        groups.display_name, groups.external_id
      FROM list_group_grants grants
      JOIN directory_groups groups ON groups.id = grants.group_id
      WHERE grants.list_id = ? AND groups.active = 1
      ORDER BY groups.display_name
    `).all(row.id).map((grant) => ({
      id: grant.id,
      role: grant.role,
      addedAt: grant.added_at,
      group: { id: grant.group_id, name: grant.display_name, externalId: grant.external_id },
    })) : [];
    const pin = user ? database.prepare(
      "SELECT id, created_at FROM pins WHERE list_id = ? AND user_id = ?"
    ).get(row.id, user.id) : null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      permission: row.permission,
      tags: row.tags,
      hideCompleted: !!row.hide_completed,
      autoSortTodos: !!row.auto_sort_todos,
      classifierAggressiveness: row.classifier_aggressiveness,
      classifierResetAt: row.classifier_reset_at,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      owner: userShape(owner),
      members,
      groupGrants,
      pins: pin && user ? [{ id: pin.id, createdAt: pin.created_at, user: userShape(user) }] : [],
      access,
    };
  }


  return { listRowById, accessFor, dashboardUserIdsForList, userShape, listShape };
}
