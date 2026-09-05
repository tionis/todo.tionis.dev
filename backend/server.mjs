import crypto from "node:crypto";
import http from "node:http";
import * as Automerge from "@automerge/automerge";
import { WebSocketServer } from "ws";
import {
  beginLogin,
  clearSessionCookie,
  finishLogin,
  OIDC_BINDING_COOKIE,
  oidcBindingCookie,
  sessionCookie,
} from "./auth.mjs";
import { accessFor as calculateAccess } from "./access.mjs";
import { loadConfig } from "./config.mjs";
import { getUserForSession, hashToken, openDatabase } from "./database.mjs";
import { deleteClassifierHistoryThrough, DocumentStore, MAX_DOCUMENT_BYTES } from "./documents.mjs";
import { rankDirectoryEntries } from "./directory-search.mjs";
import { transferListOwnership } from "./ownership.mjs";
import { mayExposeMemberIdentities } from "./privacy.mjs";
import { createFixedWindowRateLimiter } from "./rate-limit.mjs";
import { handleScimRequest } from "./scim.mjs";
import { applySecurityHeaders } from "./security-headers.mjs";
import { serveStatic } from "./static.mjs";

const PERMISSIONS = new Set(["public-write", "public-read", "private-write", "private-read", "owner"]);
const config = loadConfig();
const database = openDatabase(config.dataDir);
const documents = new DocumentStore(config.dataDir);
await documents.initialize();
const allowLoginForClient = createFixedWindowRateLimiter({ limit: config.authLoginLimit, windowMs: 10 * 60_000 });
const allowLoginGlobally = createFixedWindowRateLimiter({ limit: 2_000, windowMs: 10 * 60_000, maxKeys: 1 });

function cookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").flatMap((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [] : [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))]];
  }));
}

function requestUser(request) {
  return getUserForSession(database, cookies(request).smart_todos_session);
}

function requestAddress(request) {
  if (config.trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
    if (first?.trim()) return first.trim();
  }
  return request.socket.remoteAddress || "unknown";
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin === config.appOrigin.origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function fail(response, status, message) {
  json(response, status, { error: message });
}

async function readJson(request, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function requireUser(request, response) {
  const user = requestUser(request);
  if (!user) fail(response, 401, "Authentication required");
  return user;
}

function trustedMutation(request, response) {
  const origin = request.headers.origin;
  if (origin && origin !== config.appOrigin.origin) {
    fail(response, 403, "Untrusted request origin");
    return false;
  }
  return true;
}

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

function decodeDocument(value) {
  if (!value) return undefined;
  return Buffer.from(value, "base64");
}

async function handleApi(request, response, url) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    json(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/auth/login") {
    if (!allowLoginForClient(requestAddress(request)) || !allowLoginGlobally("global")) {
      response.setHeader("Retry-After", "600");
      return fail(response, 429, "Too many login attempts; try again later");
    }
    const login = await beginLogin(
      database,
      config,
      url.searchParams.get("returnTo") || "/",
      cookies(request)[OIDC_BINDING_COOKIE],
    );
    response.writeHead(302, {
      Location: login.authorizationUrl.href,
      "Set-Cookie": oidcBindingCookie(config, login.browserBinding, login.expiresAt),
    });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/auth/callback") {
    const session = await finishLogin(database, config, url, cookies(request)[OIDC_BINDING_COOKIE]);
    response.writeHead(302, {
      Location: new URL(session.returnTo, config.appOrigin).href,
      "Set-Cookie": sessionCookie(config, session.sessionToken, session.expiresAt),
    });
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    json(response, 200, { user: userShape(requestUser(request)) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!trustedMutation(request, response)) return;
    const token = cookies(request).smart_todos_session;
    if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    response.setHeader("Set-Cookie", clearSessionCookie(config));
    json(response, 200, { ok: true });
    return;
  }

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
    if (!body.name?.trim() || !body.slug?.trim()) return fail(response, 400, "List name and slug are required");
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
    notifyDashboardUsers([user.id]);
    json(response, 201, { list: listShape(listRowById(id), user, true) });
    return;
  }

  const listMatch = url.pathname.match(/^\/api\/lists\/([^/]+)$/);
  if (listMatch && request.method === "GET") {
    const row = database.prepare("SELECT * FROM lists WHERE slug = ? OR id = ?").get(
      decodeURIComponent(listMatch[1]), decodeURIComponent(listMatch[1])
    );
    const user = requestUser(request);
    const access = accessFor(row, user);
    if (!access.read) return fail(response, row ? 403 : 404, row ? "List access denied" : "List not found");
    const document = Buffer.from(Automerge.save(await documents.load(row.id))).toString("base64");
    json(response, 200, { list: listShape(row, user, true), document });
    return;
  }
  if (listMatch && request.method === "PATCH") {
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    const id = decodeURIComponent(listMatch[1]);
    const row = listRowById(id);
    if (!accessFor(row, user).owner) return fail(response, 403, "Only the owner can change list settings");
    const affectedUserIds = dashboardUserIdsForList(id);
    const body = await readJson(request);
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
    refreshListConnections(id);
    notifyDashboardUsers(affectedUserIds);
    json(response, 200, { list: listShape(listRowById(id), user, true) });
    return;
  }
  if (listMatch && request.method === "DELETE") {
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    const id = decodeURIComponent(listMatch[1]);
    const row = listRowById(id);
    if (!row) return json(response, 200, { ok: true });
    if (!accessFor(row, user).owner) return fail(response, 403, "Only the owner can delete this list");
    const affectedUserIds = dashboardUserIdsForList(id);
    database.prepare("DELETE FROM lists WHERE id = ?").run(id);
    await documents.delete(id);
    for (const client of clientsByList.get(id) || []) client.close(1000, "List deleted");
    clientsByList.delete(id);
    notifyDashboardUsers(affectedUserIds);
    json(response, 200, { ok: true });
    return;
  }

  const listDocumentMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/document$/);
  if (listDocumentMatch && request.method === "POST") {
    if (!trustedMutation(request, response)) return;
    const user = requestUser(request);
    const listId = decodeURIComponent(listDocumentMatch[1]);
    const row = listRowById(listId);
    if (!accessFor(row, user).write) return fail(response, row ? 403 : 404, row ? "List is read-only" : "List not found");
    const body = await readJson(request, Math.ceil(MAX_DOCUMENT_BYTES * 4 / 3) + 16_384);
    if (typeof body.document !== "string" || !body.document) return fail(response, 400, "Document is required");
    let document;
    try {
      document = await documents.merge(listId, decodeDocument(body.document));
    } catch {
      return fail(response, 400, "Invalid document update");
    }
    broadcastDocument(listId, document);
    json(response, 200, { ok: true });
    return;
  }

  const pinMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/pin$/);
  if (pinMatch && request.method === "POST") {
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    const row = listRowById(decodeURIComponent(pinMatch[1]));
    if (!row || !["public-read", "public-write"].includes(row.permission)) return fail(response, 403, "Only public lists can be pinned");
    const existing = database.prepare("SELECT id FROM pins WHERE list_id = ? AND user_id = ?").get(row.id, user.id);
    const id = existing?.id || crypto.randomUUID();
    database.prepare("INSERT OR IGNORE INTO pins (id, list_id, user_id, created_at) VALUES (?, ?, ?, ?)")
      .run(id, row.id, user.id, new Date().toISOString());
    notifyDashboardUsers([user.id]);
    json(response, 200, { id });
    return;
  }
  if (pinMatch && request.method === "DELETE") {
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    database.prepare("DELETE FROM pins WHERE list_id = ? AND user_id = ?").run(decodeURIComponent(pinMatch[1]), user.id);
    notifyDashboardUsers([user.id]);
    json(response, 200, { ok: true });
    return;
  }

  const shareTargetsMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/share-targets$/);
  if (shareTargetsMatch && request.method === "GET") {
    const user = requireUser(request, response);
    if (!user) return;
    const listId = decodeURIComponent(shareTargetsMatch[1]);
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
    const listId = decodeURIComponent(listMembersMatch[1]);
    const list = listRowById(listId);
    if (!accessFor(list, user).owner) return fail(response, 403, "Only the owner can add members");
    const body = await readJson(request);
    const target = database.prepare("SELECT id FROM users WHERE id = ? AND active = 1").get(body.userId);
    if (!target || target.id === list.owner_id) return fail(response, 400, "Invalid member");
    const existing = database.prepare("SELECT id FROM members WHERE list_id = ? AND user_id = ?").get(listId, target.id);
    const id = existing?.id || body.id || crypto.randomUUID();
    database.prepare("INSERT OR IGNORE INTO members (id, list_id, user_id, role, added_at) VALUES (?, ?, ?, 'member', ?)")
      .run(id, listId, target.id, new Date().toISOString());
    refreshListConnections(listId);
    notifyDashboardUsers([target.id]);
    json(response, existing ? 200 : 201, { id });
    return;
  }

  const listGroupsMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/groups$/);
  if (listGroupsMatch && request.method === "POST") {
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    const listId = decodeURIComponent(listGroupsMatch[1]);
    if (!accessFor(listRowById(listId), user).owner) return fail(response, 403, "Only the owner can share with groups");
    const body = await readJson(request);
    const group = database.prepare("SELECT id FROM directory_groups WHERE id = ? AND active = 1").get(body.groupId);
    if (!group) return fail(response, 400, "Invalid group");
    const existing = database.prepare("SELECT id FROM list_group_grants WHERE list_id = ? AND group_id = ?").get(listId, group.id);
    const id = existing?.id || body.id || crypto.randomUUID();
    database.prepare("INSERT OR IGNORE INTO list_group_grants (id, list_id, group_id, role, added_at) VALUES (?, ?, ?, 'member', ?)")
      .run(id, listId, group.id, new Date().toISOString());
    refreshListConnections(listId);
    notifyDashboardUsers(database.prepare("SELECT user_id FROM directory_group_members WHERE group_id = ?").all(group.id).map((row) => row.user_id));
    json(response, existing ? 200 : 201, { id });
    return;
  }

  const groupGrantMatch = url.pathname.match(/^\/api\/group-grants\/([^/]+)$/);
  if (groupGrantMatch && request.method === "DELETE") {
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    const grant = database.prepare("SELECT * FROM list_group_grants WHERE id = ?").get(decodeURIComponent(groupGrantMatch[1]));
    if (!grant) return json(response, 200, { ok: true });
    if (!accessFor(listRowById(grant.list_id), user).owner) return fail(response, 403, "Only the owner can remove group access");
    const affectedUserIds = database.prepare("SELECT user_id FROM directory_group_members WHERE group_id = ?").all(grant.group_id).map((row) => row.user_id);
    database.prepare("DELETE FROM list_group_grants WHERE id = ?").run(grant.id);
    refreshListConnections(grant.list_id);
    notifyDashboardUsers(affectedUserIds);
    json(response, 200, { ok: true });
    return;
  }

  const transferMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/transfer$/);
  if (transferMatch && request.method === "POST") {
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    const listId = decodeURIComponent(transferMatch[1]);
    const row = listRowById(listId);
    const body = await readJson(request);
    if (row?.owner_id === body.userId) return json(response, 200, { ok: true });
    if (!accessFor(row, user).owner) return fail(response, 403, "Only the owner can transfer this list");
    transferListOwnership(database, { listId, currentOwnerId: user.id, newOwnerId: body.userId });
    refreshListConnections(listId);
    notifyDashboardUsers([user.id, body.userId]);
    json(response, 200, { ok: true });
    return;
  }

  const classifierResetMatch = url.pathname.match(/^\/api\/lists\/([^/]+)\/classifier\/reset$/);
  if (classifierResetMatch && request.method === "POST") {
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    const listId = decodeURIComponent(classifierResetMatch[1]);
    if (!accessFor(listRowById(listId), user).owner) return fail(response, 403, "Only the owner can reset classifier history");
    const body = await readJson(request);
    const resetAt = typeof body.resetAt === "string" ? body.resetAt : new Date().toISOString();
    const document = await documents.change(listId, (draft) => {
      deleteClassifierHistoryThrough(draft, resetAt);
    });
    database.prepare("UPDATE lists SET classifier_reset_at = ?, updated_at = ? WHERE id = ?")
      .run(resetAt, resetAt, listId);
    broadcastDocument(listId, document);
    json(response, 200, { resetAt });
    return;
  }

  const memberMatch = url.pathname.match(/^\/api\/members\/([^/]+)$/);
  if (memberMatch && request.method === "DELETE") {
    if (!trustedMutation(request, response)) return;
    const user = requireUser(request, response);
    if (!user) return;
    const member = database.prepare("SELECT * FROM members WHERE id = ?").get(decodeURIComponent(memberMatch[1]));
    if (!member) return json(response, 200, { ok: true });
    const access = accessFor(listRowById(member.list_id), user);
    if (!access.owner && member.user_id !== user.id) return fail(response, 403, "Member access denied");
    database.prepare("DELETE FROM members WHERE id = ?").run(member.id);
    refreshListConnections(member.list_id);
    notifyDashboardUsers([member.user_id]);
    json(response, 200, { ok: true });
    return;
  }

  fail(response, 404, "Not found");
}

const server = http.createServer(async (request, response) => {
  applySecurityHeaders(response, config.publicUrl);
  setCors(request, response);
  try {
    const url = new URL(request.url || "/", config.publicUrl);
    if (url.pathname.startsWith("/scim/v2")) {
      await handleScimRequest(request, response, url, {
        database,
        config,
        onAccessChanged(listIds) {
          for (const listId of new Set(listIds)) refreshListConnections(listId);
          notifyAllDashboards();
        },
      });
    } else if (url.pathname.startsWith("/api/") || url.pathname === "/sync") {
      await handleApi(request, response, url);
    } else if (!await serveStatic(request, response, url, config.staticDir)) {
      fail(response, 404, "Not found");
    }
  } catch (error) {
    console.error(error);
    if (!response.headersSent) fail(response, error.status || 500, error.status ? error.message : "Internal server error");
    else response.end();
  }
});

const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_DOCUMENT_BYTES });
const clientsByList = new Map();
const eventClientsByUser = new Map();

function notifyDashboardUsers(userIds) {
  for (const userId of new Set(userIds.filter(Boolean))) {
    for (const client of eventClientsByUser.get(userId) || []) {
      if (client.readyState === 1) client.send(JSON.stringify({ type: "dashboard-changed" }));
    }
  }
}

function notifyAllDashboards() {
  notifyDashboardUsers([...eventClientsByUser.keys()]);
}

function presenceName(user) {
  return user?.name || user?.username || user?.email || "Anonymous";
}

function broadcastPresence(listId) {
  const clients = [...(clientsByList.get(listId) || [])].filter((client) => client.presence && client.readyState === 1);
  for (const receiver of clients) {
    const peers = {};
    for (const peer of clients) {
      if (peer === receiver || (receiver.user?.id && peer.user?.id === receiver.user.id)) continue;
      const key = peer.user?.id || peer.connectionId;
      peers[key] = peer.presence;
    }
    receiver.send(JSON.stringify({ type: "presence", peers }));
  }
}

function broadcastDocument(listId, document) {
  const bytes = Automerge.save(document);
  for (const client of clientsByList.get(listId) || []) {
    const currentUser = getUserForSession(database, client.sessionToken);
    const list = listRowById(listId);
    const access = accessFor(list, currentUser);
    if (!access.read) client.close(1008, "List access revoked");
    else if (client.readyState === 1) {
      client.access = access;
      client.send(JSON.stringify({ type: "ready", access: access.write ? "write" : "read" }));
      client.send(JSON.stringify({ type: "metadata", list: listShape(list, currentUser, true) }));
      client.send(bytes);
    }
  }
}

function refreshListConnections(listId) {
  void documents.load(listId).then((document) => broadcastDocument(listId, document));
}

server.on("upgrade", (request, socket, head) => {
  try {
    const url = new URL(request.url || "/", config.publicUrl);
    if (!new Set(["/sync", "/events"]).has(url.pathname) || request.headers.origin !== config.appOrigin.origin) return socket.destroy();
    const currentUser = requestUser(request);
    if (url.pathname === "/events") {
      if (!currentUser) return socket.destroy();
      return webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSocket.channel = "events";
        webSocket.user = currentUser;
        webSockets.emit("connection", webSocket);
      });
    }
    const listId = url.searchParams.get("listId");
    const list = listId ? listRowById(listId) : null;
    const access = accessFor(list, currentUser);
    if (!list || !access.read) return socket.destroy();
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.channel = "list";
      webSocket.listId = listId;
      webSocket.access = access;
      webSocket.user = currentUser;
      webSocket.sessionToken = cookies(request).smart_todos_session;
      webSockets.emit("connection", webSocket);
    });
  } catch {
    socket.destroy();
  }
});

webSockets.on("connection", async (webSocket) => {
  if (webSocket.channel === "events") {
    const userId = webSocket.user.id;
    if (!eventClientsByUser.has(userId)) eventClientsByUser.set(userId, new Set());
    eventClientsByUser.get(userId).add(webSocket);
    webSocket.on("close", () => {
      const clients = eventClientsByUser.get(userId);
      clients?.delete(webSocket);
      if (!clients?.size) eventClientsByUser.delete(userId);
    });
    return;
  }
  const { listId, access } = webSocket;
  webSocket.connectionId = crypto.randomUUID();
  webSocket.pendingUpdates = 0;
  if (!clientsByList.has(listId)) clientsByList.set(listId, new Set());
  clientsByList.get(listId).add(webSocket);
  webSocket.send(JSON.stringify({ type: "ready", access: access.write ? "write" : "read" }));
  webSocket.send(JSON.stringify({ type: "metadata", list: listShape(listRowById(listId), webSocket.user, true) }));
  webSocket.send(Automerge.save(await documents.load(listId)));

  webSocket.on("message", async (data, isBinary) => {
    if (!isBinary) {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "presence") {
          webSocket.presence = { name: presenceName(webSocket.user), userId: webSocket.user?.id };
          broadcastPresence(listId);
        } else if (message.type === "presence-leave") {
          webSocket.presence = null;
          broadcastPresence(listId);
        }
      } catch {
        webSocket.close(1008, "Invalid realtime message");
      }
      return;
    }
    if (webSocket.pendingUpdates >= 4) {
      webSocket.close(1008, "Too many pending updates");
      return;
    }
    webSocket.pendingUpdates += 1;
    try {
      const currentAccess = accessFor(listRowById(listId), getUserForSession(database, webSocket.sessionToken));
      if (!currentAccess.write) {
        webSocket.send(JSON.stringify({ type: "error", message: "This list is read-only" }));
        return;
      }
      const merged = await documents.merge(listId, new Uint8Array(data));
      broadcastDocument(listId, merged);
    } catch (error) {
      console.error("Rejected Automerge update", error);
      if (webSocket.readyState === 1) webSocket.send(JSON.stringify({ type: "error", message: "Invalid document update" }));
    } finally {
      webSocket.pendingUpdates -= 1;
    }
  });
  webSocket.on("close", () => {
    const clients = clientsByList.get(listId);
    clients?.delete(webSocket);
    if (!clients?.size) clientsByList.delete(listId);
    else if (webSocket.presence) broadcastPresence(listId);
  });
});

server.listen(config.port, config.host, () => {
  console.log(`Smart Todos listening on http://${config.host}:${config.port}`);
});

function shutdown() {
  webSockets.close();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
