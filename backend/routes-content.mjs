import { NOT_HANDLED } from "./route-result.mjs";
import crypto from "node:crypto";
import { MAX_DOCUMENT_BYTES } from "./documents.mjs";
import { decodeDocument, fail, json, readJson, safeDecode } from "./http-helpers.mjs";

// Document uploads, pins and classifier resets for a list.
// A handler answers the request and returns, or returns NOT_HANDLED so the next group can try.
export function createRoutesContent(ctx) {
  const { database, documents, requestUser, requireUser, trustedMutation, listRowById, accessFor, allowWrite, requestAddress, realtime } = ctx;

  return async function handle(request, response, url) {
    const listDocumentMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/document$/);
    if (listDocumentMatch && request.method === "POST") {
      if (!trustedMutation(request, response)) return;
      const user = requestUser(request);
      const listId = safeDecode(listDocumentMatch[1]);
      const row = listRowById(listId);
      if (!accessFor(row, user).write) return fail(response, row ? 403 : 404, row ? "List is read-only" : "List not found");
      if (!allowWrite(user, requestAddress(request))) {
        response.setHeader("Retry-After", "60");
        return fail(response, 429, "Too many document updates; slow down");
      }
      const body = await readJson(request, Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 16_384);
      if (typeof body.document !== "string" || !body.document) return fail(response, 400, "Document is required");
      let merged;
      try {
        merged = await documents.mergeChanges(listId, decodeDocument(body.document));
      } catch {
        return fail(response, 400, "Invalid document update");
      }
      realtime.broadcastChange(listId, merged);
      json(response, 200, { ok: true });
      return;
    }

    const pinMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/pin$/);
    if (pinMatch && request.method === "POST") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const row = listRowById(safeDecode(pinMatch[1]));
      if (!row || !["public-read", "public-write"].includes(row.permission)) return fail(response, 403, "Only public lists can be pinned");
      const existing = database.prepare("SELECT id FROM pins WHERE list_id = ? AND user_id = ?").get(row.id, user.id);
      const id = existing?.id || crypto.randomUUID();
      database.prepare("INSERT OR IGNORE INTO pins (id, list_id, user_id, created_at) VALUES (?, ?, ?, ?)")
        .run(id, row.id, user.id, new Date().toISOString());
      realtime.notifyDashboardUsers([user.id]);
      json(response, 200, { id });
      return;
    }
    if (pinMatch && request.method === "DELETE") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      database.prepare("DELETE FROM pins WHERE list_id = ? AND user_id = ?").run(safeDecode(pinMatch[1]), user.id);
      realtime.notifyDashboardUsers([user.id]);
      json(response, 200, { ok: true });
      return;
    }

    const classifierResetMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/classifier\/reset$/);
    if (classifierResetMatch && request.method === "POST") {
      if (!trustedMutation(request, response)) return;
      const user = requireUser(request, response);
      if (!user) return;
      const listId = safeDecode(classifierResetMatch[1]);
      if (!accessFor(listRowById(listId), user).owner) return fail(response, 403, "Only the owner can reset classifier history");
      const body = await readJson(request);
      const resetAt = typeof body.resetAt === "string" && !Number.isNaN(Date.parse(body.resetAt))
        ? new Date(body.resetAt).toISOString()
        : new Date().toISOString();
      const document = await documents.resetClassifierHistory(listId, resetAt);
      database.prepare("UPDATE lists SET classifier_reset_at = ?, updated_at = ? WHERE id = ?")
        .run(resetAt, resetAt, listId);
      realtime.broadcastDocument(listId, document);
      json(response, 200, { resetAt });
      return;
    }

    return NOT_HANDLED;
  };
}
