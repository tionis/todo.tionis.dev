import { getUserForSession } from "./database.mjs";

export function decodeDocument(value) {
  if (!value) return undefined;
  return Buffer.from(value, "base64");
}

export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw Object.assign(new Error("Malformed URL encoding"), { status: 400 });
  }
}

export function cookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").flatMap((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [] : [[part.slice(0, index).trim(), safeDecode(part.slice(index + 1))]];
  }));
}


export function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

export function fail(response, status, message) {
  json(response, status, { error: message });
}


export async function readJson(request, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("JSON object expected"), { status: 400 });
  }
  return value;
}

export const AGGRESSIVENESS = new Set(["conservative", "normal", "aggressive"]);
export const optionalString = (value) => value === undefined || value === null || typeof value === "string";

// Helpers that depend on the loaded configuration and the session store.
export function createRequestHelpers({ config, database }) {
  function requestUser(request) {
    return getUserForSession(database, cookies(request).smart_todos_session);
  }

  function requestAddress(request) {
    if (config.trustProxy) {
      const forwarded = request.headers["x-forwarded-for"];
      // The proxy appends the address it saw last; earlier entries are client-supplied.
      const chain = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded || "").split(",");
      const last = chain[chain.length - 1]?.trim();
      if (last) return last;
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

  return { requestUser, requestAddress, setCors, requireUser, trustedMutation };
}
