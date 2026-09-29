import { NOT_HANDLED } from "./route-result.mjs";
import crypto from "node:crypto";
import { AGGRESSIVENESS, decodeDocument, fail, json, optionalString, readJson, safeDecode } from "./http-helpers.mjs";

const PERMISSIONS = new Set(["public-write", "public-read", "private-write", "private-read", "owner"]);

// List collection and settings routes: list, create, read, update, delete.
// A handler answers the request and returns, or returns NOT_HANDLED so the next group can try.
export function createRoutesLists(ctx) {
  const { database, documents, requestUser, requireUser, trustedMutation, listRowById, accessFor, listShape, dashboardUserIdsForList, realtime } = ctx;

  return async function handle(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/lists") {
      const user = requireUser(request, response);
      if (!user) return;
      const rows = database.prepare(`
        SELECT DISTINCT lists.* FROM lists
        LEFT JOIN members ON members.list_id = lists.id
        LEFT JOIN pins ON pins.list_id = lists.id
        WHERE lists.owner_id = ? OR members.user_id = ? OR pins.user_id = ? OR EXISTS (
          SELECT 1 FROM list_group_grants grants
          JOIN directory_groups groups ON groups.id = grants.group_id AND groups.active = 1
          JOIN directory_group_members memberships ON memberships.group_id = groups.id
          WHERE grants.list_id = lists.id AND memberships.user_id = ?
        )
        ORDER BY lists.created_at DESC
      `).all(user.id, user.id, user.id, user.id);
      json(response, 200, { lists: rows.map((row) => listShape(row, user)) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/lists") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const body = await readJson(request, 8_000_000);
      if (typeof body.name !== "string" || typeof body.slug !== "string" || !body.name.trim() || !body.slug.trim()) {
        return fail(response, 400, "List name and slug are required");
      }
      if (body.id !== undefined && (typeof body.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(body.id))) {
        return fail(response, 400, "Invalid list id");
      }
      if (!optionalString(body.tags) || !optionalString(body.classifierResetAt) || !optionalString(body.archivedAt)
        || !optionalString(body.createdAt) || (body.classifierAggressiveness !== undefined && !AGGRESSIVENESS.has(body.classifierAggressiveness))
        || (typeof body.document !== "string" && body.document !== undefined && body.document !== null)) {
        return fail(response, 400, "Invalid list settings");
      }
      const idInUse = body.id && listRowById(body.id);
      if (!idInUse && database.prepare("SELECT 1 FROM lists WHERE slug = ?").get(body.slug.trim())) {
        return fail(response, 409, "List slug is already in use");
      }
      const permission = PERMISSIONS.has(body.permission) ? body.permission : "private-write";
      const id = body.id || crypto.randomUUID();
      const existing = listRowById(id);
      if (existing) {
        if (existing.owner_id !== user.id) return fail(response, 409, "List id is already in use");
        json(response, 200, { list: listShape(existing, user, true) });
        return;
      }
      const now = new Date().toISOString();
      database.prepare(`
        INSERT INTO lists (id, owner_id, name, slug, permission, tags, hide_completed,
          auto_sort_todos, classifier_aggressiveness, classifier_reset_at, archived_at,
          created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, user.id, body.name.trim(), body.slug.trim(), permission, body.tags || null,
        body.hideCompleted ? 1 : 0, body.autoSortTodos ? 1 : 0,
        body.classifierAggressiveness || "normal", body.classifierResetAt || null,
        body.archivedAt || null, body.createdAt || now, now,
      );
      try {
        await documents.create(id, decodeDocument(body.document));
      } catch (error) {
        database.prepare("DELETE FROM lists WHERE id = ?").run(id);
        throw error;
      }
      realtime.notifyDashboardUsers([user.id]);
      json(response, 201, { list: listShape(listRowById(id), user, true) });
      return;
    }

    const listMatch = url.pathname.match(/^\/api\/lists\/([^/]+)$/);
    if (listMatch && request.method === "GET") {
      const row = database.prepare("SELECT * FROM lists WHERE slug = ? OR id = ?").get(
        safeDecode(listMatch[1]), safeDecode(listMatch[1])
      );
      const user = requestUser(request);
      const access = accessFor(row, user);
      if (!access.read) return fail(response, row ? 403 : 404, row ? "List access denied" : "List not found");
      const document = Buffer.from(await documents.load(row.id)).toString("base64");
      json(response, 200, { list: listShape(row, user, true), document });
      return;
    }
    if (listMatch && request.method === "PATCH") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const id = safeDecode(listMatch[1]);
      const row = listRowById(id);
      if (!accessFor(row, user).owner) return fail(response, 403, "Only the owner can change list settings");
      const body = await readJson(request);
      if (!optionalString(body.tags) || !optionalString(body.classifierResetAt) || !optionalString(body.archivedAt)
        || (body.classifierAggressiveness !== undefined && !AGGRESSIVENESS.has(body.classifierAggressiveness))) {
        return fail(response, 400, "Invalid list settings");
      }
      const affectedUserIds = dashboardUserIdsForList(id);
      const next = {
        name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : row.name,
        permission: PERMISSIONS.has(body.permission) ? body.permission : row.permission,
        tags: body.tags === undefined ? row.tags : body.tags,
        hideCompleted: body.hideCompleted === undefined ? row.hide_completed : body.hideCompleted ? 1 : 0,
        autoSortTodos: body.autoSortTodos === undefined ? row.auto_sort_todos : body.autoSortTodos ? 1 : 0,
        classifierAggressiveness: body.classifierAggressiveness || row.classifier_aggressiveness,
        classifierResetAt: body.classifierResetAt === undefined ? row.classifier_reset_at : body.classifierResetAt,
        archivedAt: body.archivedAt === undefined ? row.archived_at : body.archivedAt,
      };
      database.prepare(`
        UPDATE lists SET name = ?, permission = ?, tags = ?, hide_completed = ?,
          auto_sort_todos = ?, classifier_aggressiveness = ?, classifier_reset_at = ?,
          archived_at = ?, updated_at = ? WHERE id = ?
      `).run(next.name, next.permission, next.tags, next.hideCompleted, next.autoSortTodos,
        next.classifierAggressiveness, next.classifierResetAt, next.archivedAt, new Date().toISOString(), id);
      realtime.refreshListConnections(id);
      realtime.notifyDashboardUsers(affectedUserIds);
      json(response, 200, { list: listShape(listRowById(id), user, true) });
      return;
    }
    if (listMatch && request.method === "DELETE") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const id = safeDecode(listMatch[1]);
      const row = listRowById(id);
      if (!row) return json(response, 200, { ok: true });
      if (!accessFor(row, user).owner) return fail(response, 403, "Only the owner can delete this list");
      const affectedUserIds = dashboardUserIdsForList(id);
      database.prepare("DELETE FROM lists WHERE id = ?").run(id);
      await documents.delete(id);
      realtime.closeListClients(id, "List deleted");
      realtime.notifyDashboardUsers(affectedUserIds);
      json(response, 200, { ok: true });
      return;
    }

    return NOT_HANDLED;
  };
}
