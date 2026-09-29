import { NOT_HANDLED } from "./route-result.mjs";
import crypto from "node:crypto";
import { rankDirectoryEntries } from "./directory-search.mjs";
import { fail, json, readJson, safeDecode } from "./http-helpers.mjs";
import { transferListOwnership } from "./ownership.mjs";

// Directory search, members, group grants and ownership transfer.
// A handler answers the request and returns, or returns NOT_HANDLED so the next group can try.
export function createRoutesSharing(ctx) {
  const { database, requireUser, trustedMutation, listRowById, accessFor, userShape, realtime } = ctx;

  return async function handle(request, response, url) {
    const shareTargetsMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/share-targets$/);
    if (shareTargetsMatch && request.method === "GET") {
      const user = requireUser(request, response);
      if (!user) return;
      const listId = safeDecode(shareTargetsMatch[1]);
      const list = listRowById(listId);
      if (!accessFor(list, user).owner) return fail(response, 403, "Only the owner can search directory identities");
      const query = (url.searchParams.get("q") || "").trim().slice(0, 128);
      const cacheWarmup = url.searchParams.get("cache") === "1";
      if (query.length < 2 && !cacheWarmup) return json(response, 200, { users: [], groups: [] });
      const eligibleUsers = database.prepare(`
        SELECT id, email, name, username FROM users
        WHERE active = 1 AND id != ?
          AND NOT EXISTS (SELECT 1 FROM members WHERE members.list_id = ? AND members.user_id = users.id)
      `).all(list.owner_id, listId).map(userShape);
      const eligibleGroups = database.prepare(`
        SELECT id, external_id, display_name FROM directory_groups
        WHERE active = 1
          AND NOT EXISTS (SELECT 1 FROM list_group_grants WHERE list_id = ? AND group_id = directory_groups.id)
      `).all(listId).map((group) => ({ id: group.id, externalId: group.external_id, name: group.display_name }));
      const users = cacheWarmup ? eligibleUsers.slice(0, 5_000) : rankDirectoryEntries(eligibleUsers, query);
      const groups = cacheWarmup ? eligibleGroups.slice(0, 5_000) : rankDirectoryEntries(eligibleGroups, query);
      json(response, 200, { users, groups });
      return;
    }

    const listMembersMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/members$/);
    if (listMembersMatch && request.method === "POST") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const listId = safeDecode(listMembersMatch[1]);
      const list = listRowById(listId);
      if (!accessFor(list, user).owner) return fail(response, 403, "Only the owner can add members");
      const body = await readJson(request);
      const target = database.prepare("SELECT id FROM users WHERE id = ? AND active = 1").get(body.userId);
      if (!target || target.id === list.owner_id) return fail(response, 400, "Invalid member");
      const existing = database.prepare("SELECT id FROM members WHERE list_id = ? AND user_id = ?").get(listId, target.id);
      const id = existing?.id || body.id || crypto.randomUUID();
      database.prepare("INSERT OR IGNORE INTO members (id, list_id, user_id, role, added_at) VALUES (?, ?, ?, 'member', ?)")
        .run(id, listId, target.id, new Date().toISOString());
      realtime.refreshListConnections(listId);
      realtime.notifyDashboardUsers([target.id]);
      json(response, existing ? 200 : 201, { id });
      return;
    }

    const listGroupsMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/groups$/);
    if (listGroupsMatch && request.method === "POST") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const listId = safeDecode(listGroupsMatch[1]);
      if (!accessFor(listRowById(listId), user).owner) return fail(response, 403, "Only the owner can share with groups");
      const body = await readJson(request);
      const group = database.prepare("SELECT id FROM directory_groups WHERE id = ? AND active = 1").get(body.groupId);
      if (!group) return fail(response, 400, "Invalid group");
      const existing = database.prepare("SELECT id FROM list_group_grants WHERE list_id = ? AND group_id = ?").get(listId, group.id);
      const id = existing?.id || body.id || crypto.randomUUID();
      database.prepare("INSERT OR IGNORE INTO list_group_grants (id, list_id, group_id, role, added_at) VALUES (?, ?, ?, 'member', ?)")
        .run(id, listId, group.id, new Date().toISOString());
      realtime.refreshListConnections(listId);
      realtime.notifyDashboardUsers(database.prepare("SELECT user_id FROM directory_group_members WHERE group_id = ?").all(group.id).map((row) => row.user_id));
      json(response, existing ? 200 : 201, { id });
      return;
    }

    const groupGrantMatch = url.pathname.match(/^\/api\/group-grants\/([^/]+)$/);
    if (groupGrantMatch && request.method === "DELETE") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const grant = database.prepare("SELECT * FROM list_group_grants WHERE id = ?").get(safeDecode(groupGrantMatch[1]));
      if (!grant) return json(response, 200, { ok: true });
      if (!accessFor(listRowById(grant.list_id), user).owner) return fail(response, 403, "Only the owner can remove group access");
      const affectedUserIds = database.prepare("SELECT user_id FROM directory_group_members WHERE group_id = ?").all(grant.group_id).map((row) => row.user_id);
      database.prepare("DELETE FROM list_group_grants WHERE id = ?").run(grant.id);
      realtime.refreshListConnections(grant.list_id);
      realtime.notifyDashboardUsers(affectedUserIds);
      json(response, 200, { ok: true });
      return;
    }

    const transferMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/transfer$/);
    if (transferMatch && request.method === "POST") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const listId = safeDecode(transferMatch[1]);
      const row = listRowById(listId);
      const body = await readJson(request);
      if (typeof body.userId !== "string") return fail(response, 400, "userId is required");
      if (row?.owner_id === body.userId) return json(response, 200, { ok: true });
      if (!accessFor(row, user).owner) return fail(response, 403, "Only the owner can transfer this list");
      transferListOwnership(database, { listId, currentOwnerId: user.id, newOwnerId: body.userId });
      realtime.refreshListConnections(listId);
      realtime.notifyDashboardUsers([user.id, body.userId]);
      json(response, 200, { ok: true });
      return;
    }

    const memberMatch = url.pathname.match(/^\/api\/members\/([^/]+)$/);
    if (memberMatch && request.method === "DELETE") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const member = database.prepare("SELECT * FROM members WHERE id = ?").get(safeDecode(memberMatch[1]));
      if (!member) return json(response, 200, { ok: true });
      const access = accessFor(listRowById(member.list_id), user);
      if (!access.owner && member.user_id !== user.id) return fail(response, 403, "Member access denied");
      database.prepare("DELETE FROM members WHERE id = ?").run(member.id);
      realtime.refreshListConnections(member.list_id);
      realtime.notifyDashboardUsers([member.user_id]);
      json(response, 200, { ok: true });
      return;
    }

    return NOT_HANDLED;
  };
}
