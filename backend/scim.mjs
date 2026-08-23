import crypto from "node:crypto";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

function scimJson(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/scim+json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(body);
}

function scimEmpty(response, status) {
  response.writeHead(status, { "Cache-Control": "no-store" });
  response.end();
}

function scimError(response, status, detail, scimType) {
  scimJson(response, status, {
    schemas: [ERROR_SCHEMA],
    ...(scimType ? { scimType } : {}),
    detail,
    status: String(status),
  });
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

function authorized(request, token) {
  if (!token) return false;
  const header = request.headers.authorization || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedHash = crypto.createHash("sha256").update(token).digest();
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  return crypto.timingSafeEqual(expectedHash, suppliedHash) && supplied.length === token.length;
}

function locationFor(config, type, id) {
  return new URL(`/scim/v2/${type}/${encodeURIComponent(id)}`, config.publicUrl).href;
}

function primaryEmail(resource) {
  if (!Array.isArray(resource.emails)) return null;
  const email = resource.emails.find((item) => item?.primary)?.value || resource.emails[0]?.value;
  return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}

function displayName(resource) {
  const candidates = [
    resource.displayName,
    resource.name?.formatted,
    [resource.name?.givenName, resource.name?.familyName].filter(Boolean).join(" "),
    resource.userName,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || null;
}

function assertLength(value, field, maximum) {
  if (value && value.length > maximum) {
    throw Object.assign(new Error(`${field} is too long`), { status: 400, scimType: "invalidValue" });
  }
}

function affectedListsForUser(database, userId) {
  return database.prepare(`
    SELECT list_id AS id FROM members WHERE user_id = ?
    UNION SELECT id FROM lists WHERE owner_id = ?
    UNION SELECT grants.list_id AS id
      FROM list_group_grants grants
      JOIN directory_group_members memberships ON memberships.group_id = grants.group_id
      WHERE memberships.user_id = ?
  `).all(userId, userId, userId).map((row) => row.id);
}

function affectedListsForGroup(database, groupId) {
  return database.prepare("SELECT list_id AS id FROM list_group_grants WHERE group_id = ?")
    .all(groupId).map((row) => row.id);
}

export function scimUserShape(row, config) {
  return {
    schemas: [USER_SCHEMA],
    id: row.id,
    externalId: row.scim_external_id,
    userName: row.username,
    displayName: row.name || row.username,
    name: { formatted: row.name || row.username },
    active: !!row.active,
    emails: row.email ? [{ value: row.email, type: "work", primary: true }] : [],
    meta: {
      resourceType: "User",
      created: row.created_at,
      lastModified: row.updated_at,
      location: locationFor(config, "Users", row.id),
    },
  };
}

export function scimGroupShape(database, row, config) {
  const members = database.prepare(`
    SELECT users.id AS value, users.name, users.username
    FROM directory_group_members memberships
    JOIN users ON users.id = memberships.user_id
    WHERE memberships.group_id = ? AND users.active = 1
    ORDER BY COALESCE(users.name, users.username, users.id)
  `).all(row.id).map((member) => ({
    value: member.value,
    display: member.name || member.username || member.value,
    $ref: locationFor(config, "Users", member.value),
  }));
  return {
    schemas: [GROUP_SCHEMA],
    id: row.id,
    externalId: row.external_id,
    displayName: row.display_name,
    members,
    meta: {
      resourceType: "Group",
      created: row.created_at,
      lastModified: row.updated_at,
      location: locationFor(config, "Groups", row.id),
    },
  };
}

export function upsertScimUser(database, issuer, resource, id) {
  const externalId = typeof resource.externalId === "string" ? resource.externalId.trim() : "";
  const username = typeof resource.userName === "string" ? resource.userName.trim() : "";
  if (!externalId || !username) throw Object.assign(new Error("externalId and userName are required"), { status: 400 });
  assertLength(externalId, "externalId", 512);
  assertLength(username, "userName", 255);
  const current = id
    ? database.prepare("SELECT * FROM users WHERE id = ?").get(id)
    : database.prepare("SELECT * FROM users WHERE scim_external_id = ? OR (issuer = ? AND subject = ?)").get(externalId, issuer, externalId);
  if (id && !current) throw Object.assign(new Error("User not found"), { status: 404 });
  const now = new Date().toISOString();
  const userId = current?.id || crypto.randomUUID();
  const active = resource.active === false ? 0 : 1;
  const email = primaryEmail(resource);
  const emailVerified = current && current.email === email ? current.email_verified : 0;
  const name = displayName(resource);
  assertLength(email, "email", 320);
  assertLength(name, "displayName", 255);
  if (current) {
    database.prepare(`
      UPDATE users SET issuer = ?, subject = ?, scim_external_id = ?, username = ?,
        name = ?, email = ?, email_verified = ?, active = ?, updated_at = ? WHERE id = ?
    `).run(issuer, externalId, externalId, username, name, email, emailVerified, active, now, userId);
  } else {
    database.prepare(`
      INSERT INTO users (id, issuer, subject, email, email_verified, name, username, scim_external_id, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(userId, issuer, externalId, email, name, username, externalId, active, now, now);
  }
  if (!active) {
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM directory_group_members WHERE user_id = ?").run(userId);
  }
  return database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

export function deactivateScimUser(database, id) {
  const current = database.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!current) return null;
  const affected = affectedListsForUser(database, id);
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare("UPDATE users SET active = 0, updated_at = ? WHERE id = ?").run(now, id);
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    database.prepare("DELETE FROM directory_group_members WHERE user_id = ?").run(id);
  })();
  return affected;
}

export function replaceGroupMembers(database, groupId, members = []) {
  const values = [...new Set((Array.isArray(members) ? members : []).map((member) => member?.value).filter(Boolean))];
  if (values.length > 10_000) throw Object.assign(new Error("Group contains too many members"), { status: 413 });
  if (values.length) {
    const placeholders = values.map(() => "?").join(", ");
    const found = database.prepare(`SELECT id FROM users WHERE active = 1 AND id IN (${placeholders})`).all(...values);
    if (found.length !== values.length) throw Object.assign(new Error("Group contains an unknown or inactive user"), { status: 400 });
  }
  database.transaction(() => {
    database.prepare("DELETE FROM directory_group_members WHERE group_id = ?").run(groupId);
    const insert = database.prepare("INSERT INTO directory_group_members (group_id, user_id) VALUES (?, ?)");
    for (const userId of values) insert.run(groupId, userId);
  })();
}

export function upsertScimGroup(database, resource, id) {
  const externalId = typeof resource.externalId === "string" ? resource.externalId.trim() : "";
  const groupName = typeof resource.displayName === "string" ? resource.displayName.trim() : "";
  if (!externalId || !groupName) throw Object.assign(new Error("externalId and displayName are required"), { status: 400 });
  assertLength(externalId, "externalId", 512);
  assertLength(groupName, "displayName", 255);
  const current = id
    ? database.prepare("SELECT * FROM directory_groups WHERE id = ?").get(id)
    : database.prepare("SELECT * FROM directory_groups WHERE external_id = ?").get(externalId);
  if (id && !current) throw Object.assign(new Error("Group not found"), { status: 404 });
  const now = new Date().toISOString();
  const groupId = current?.id || crypto.randomUUID();
  if (current) {
    database.prepare("UPDATE directory_groups SET external_id = ?, display_name = ?, active = 1, updated_at = ? WHERE id = ?")
      .run(externalId, groupName, now, groupId);
  } else {
    database.prepare(`
      INSERT INTO directory_groups (id, external_id, display_name, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(groupId, externalId, groupName, now, now);
  }
  replaceGroupMembers(database, groupId, resource.members);
  return database.prepare("SELECT * FROM directory_groups WHERE id = ?").get(groupId);
}

function parseFilter(filter) {
  if (!filter) return null;
  if (filter.length > 1_024) throw Object.assign(new Error("Filter is too long"), { status: 400, scimType: "invalidFilter" });
  const match = /^\s*([A-Za-z][A-Za-z0-9.]*)\s+eq\s+"([^"\\]*)"\s*$/.exec(filter);
  if (!match) throw Object.assign(new Error("Only exact eq filters are supported"), { status: 400, scimType: "invalidFilter" });
  return { attribute: match[1], value: match[2] };
}

function listResponse(resources, url) {
  const startIndex = Math.max(1, Number.parseInt(url.searchParams.get("startIndex") || "1", 10) || 1);
  const count = Math.min(100, Math.max(0, Number.parseInt(url.searchParams.get("count") || "100", 10) || 100));
  const page = resources.slice(startIndex - 1, startIndex - 1 + count);
  return { schemas: [LIST_SCHEMA], totalResults: resources.length, startIndex, itemsPerPage: page.length, Resources: page };
}

function filteredRows(database, type, filter) {
  const parsed = parseFilter(filter);
  if (type === "Users") {
    if (!parsed) return database.prepare("SELECT * FROM users WHERE scim_external_id IS NOT NULL AND active = 1 ORDER BY username").all();
    const columns = { id: "id", externalId: "scim_external_id", userName: "username" };
    const column = columns[parsed.attribute];
    if (!column) throw Object.assign(new Error(`Filtering by ${parsed.attribute} is not supported`), { status: 400, scimType: "invalidFilter" });
    return database.prepare(`SELECT * FROM users WHERE active = 1 AND ${column} = ? COLLATE NOCASE`).all(parsed.value);
  }
  if (!parsed) return database.prepare("SELECT * FROM directory_groups WHERE active = 1 ORDER BY display_name").all();
  const columns = { id: "id", externalId: "external_id", displayName: "display_name" };
  const column = columns[parsed.attribute];
  if (!column) throw Object.assign(new Error(`Filtering by ${parsed.attribute} is not supported`), { status: 400, scimType: "invalidFilter" });
  return database.prepare(`SELECT * FROM directory_groups WHERE active = 1 AND ${column} = ? COLLATE NOCASE`).all(parsed.value);
}

function applyGroupPatch(database, group, operations) {
  let name = group.display_name;
  const current = database.prepare("SELECT user_id AS value FROM directory_group_members WHERE group_id = ?").all(group.id);
  const members = new Set(current.map((member) => member.value));
  for (const operation of operations || []) {
    const op = String(operation.op || "replace").toLowerCase();
    const path = operation.path || "";
    if (path.toLowerCase() === "displayname") {
      if (op === "remove") throw Object.assign(new Error("displayName cannot be removed"), { status: 400 });
      name = String(operation.value || "").trim();
      continue;
    }
    if (path.toLowerCase() === "members" || (!path && operation.value?.members)) {
      const values = operation.value?.members || operation.value || [];
      if (op === "replace") members.clear();
      for (const member of Array.isArray(values) ? values : [values]) {
        if (member?.value) {
          if (op === "remove") members.delete(member.value);
          else members.add(member.value);
        }
      }
      continue;
    }
    const memberFilter = /^members\[value eq "([^"]+)"\]$/i.exec(path);
    if (memberFilter && op === "remove") {
      members.delete(memberFilter[1]);
      continue;
    }
    throw Object.assign(new Error(`Unsupported PATCH path: ${path}`), { status: 400, scimType: "invalidPath" });
  }
  if (!name) throw Object.assign(new Error("displayName is required"), { status: 400 });
  database.prepare("UPDATE directory_groups SET display_name = ?, updated_at = ? WHERE id = ?")
    .run(name, new Date().toISOString(), group.id);
  replaceGroupMembers(database, group.id, [...members].map((value) => ({ value })));
}

function discovery(pathname) {
  if (pathname === "/scim/v2/ServiceProviderConfig") return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 }, changePassword: { supported: false },
    sort: { supported: false }, etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Static SCIM bearer token", primary: true }],
  };
  const resourceTypes = [
    { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: USER_SCHEMA },
    { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "Group", name: "Group", endpoint: "/Groups", schema: GROUP_SCHEMA },
  ];
  const schemas = [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"], id: USER_SCHEMA, name: "User",
      attributes: [
        { name: "userName", type: "string", multiValued: false, required: true, mutability: "readWrite", returned: "default", uniqueness: "server" },
        { name: "displayName", type: "string", multiValued: false, required: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
        { name: "active", type: "boolean", multiValued: false, required: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
        { name: "emails", type: "complex", multiValued: true, required: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
      ],
    },
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"], id: GROUP_SCHEMA, name: "Group",
      attributes: [
        { name: "displayName", type: "string", multiValued: false, required: true, mutability: "readWrite", returned: "default", uniqueness: "server" },
        { name: "members", type: "complex", multiValued: true, required: false, mutability: "readWrite", returned: "default", uniqueness: "none" },
      ],
    },
  ];
  if (pathname === "/scim/v2/ResourceTypes") return listResponse(resourceTypes, new URL("http://localhost"));
  if (pathname.startsWith("/scim/v2/ResourceTypes/")) {
    return resourceTypes.find((resource) => resource.id === decodeURIComponent(pathname.slice("/scim/v2/ResourceTypes/".length))) || null;
  }
  if (pathname === "/scim/v2/Schemas") return listResponse(schemas, new URL("http://localhost"));
  if (pathname.startsWith("/scim/v2/Schemas/")) {
    return schemas.find((schema) => schema.id === decodeURIComponent(pathname.slice("/scim/v2/Schemas/".length))) || null;
  }
  return null;
}

export async function handleScimRequest(request, response, url, { database, config, onAccessChanged = () => {} }) {
  if (!config.scimToken) return scimError(response, 404, "SCIM is not configured");
  if (!authorized(request, config.scimToken)) {
    response.setHeader("WWW-Authenticate", "Bearer");
    return scimError(response, 401, "Invalid SCIM bearer token");
  }
  try {
    const discovered = request.method === "GET" ? discovery(url.pathname) : null;
    if (discovered) return scimJson(response, 200, discovered);
    const match = /^\/scim\/v2\/(Users|Groups)(?:\/([^/]+))?$/.exec(url.pathname);
    if (!match) return scimError(response, 404, "SCIM resource not found");
    const [, type, rawId] = match;
    const id = rawId ? decodeURIComponent(rawId) : null;
    const shape = type === "Users"
      ? (row) => scimUserShape(row, config)
      : (row) => scimGroupShape(database, row, config);
    if (request.method === "GET" && !id) {
      return scimJson(response, 200, listResponse(filteredRows(database, type, url.searchParams.get("filter")), url));
    }
    const table = type === "Users" ? "users" : "directory_groups";
    const row = id ? database.prepare(`SELECT * FROM ${table} WHERE id = ? AND active = 1`).get(id) : null;
    if (request.method === "GET") return row ? scimJson(response, 200, shape(row)) : scimError(response, 404, `${type.slice(0, -1)} not found`);
    if (request.method === "POST" && !id) {
      const body = await readJson(request);
      const created = type === "Users"
        ? upsertScimUser(database, config.oidc.issuer.href, body)
        : upsertScimGroup(database, body);
      if (type === "Groups") onAccessChanged(affectedListsForGroup(database, created.id));
      return scimJson(response, 201, shape(created), { Location: locationFor(config, type, created.id) });
    }
    if (!row) return scimError(response, 404, `${type.slice(0, -1)} not found`);
    if (request.method === "PUT") {
      const body = await readJson(request);
      const affected = type === "Users" ? affectedListsForUser(database, id) : affectedListsForGroup(database, id);
      const updated = type === "Users"
        ? upsertScimUser(database, config.oidc.issuer.href, body, id)
        : upsertScimGroup(database, body, id);
      onAccessChanged(affected);
      return scimJson(response, 200, shape(updated));
    }
    if (request.method === "PATCH") {
      const body = await readJson(request);
      const affected = type === "Users" ? affectedListsForUser(database, id) : affectedListsForGroup(database, id);
      if (type === "Groups") applyGroupPatch(database, row, body.Operations);
      else {
        const resource = scimUserShape(row, config);
        for (const operation of body.Operations || []) {
          const key = operation.path;
          if (!key || !(key in resource)) throw Object.assign(new Error(`Unsupported PATCH path: ${key}`), { status: 400, scimType: "invalidPath" });
          resource[key] = operation.op?.toLowerCase() === "remove" ? undefined : operation.value;
        }
        upsertScimUser(database, config.oidc.issuer.href, resource, id);
      }
      onAccessChanged(affected);
      const updated = database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      return scimJson(response, 200, shape(updated));
    }
    if (request.method === "DELETE") {
      const affected = type === "Users" ? deactivateScimUser(database, id) : affectedListsForGroup(database, id);
      if (type === "Groups") database.transaction(() => {
        database.prepare("UPDATE directory_groups SET active = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
        database.prepare("DELETE FROM directory_group_members WHERE group_id = ?").run(id);
      })();
      onAccessChanged(affected || []);
      return scimEmpty(response, 204);
    }
    return scimError(response, 405, "Method not allowed");
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) return scimError(response, 409, "A user or group with that identifier already exists", "uniqueness");
    return scimError(response, error.status || 400, error.message || "Invalid SCIM request", error.scimType);
  }
}
