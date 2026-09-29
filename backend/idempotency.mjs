import { IDEMPOTENCY_TTL_MS } from "./database.mjs";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_STORED_BODY = 64_000;

// Replays the stored response when a queued offline command is retried with the
// same Idempotency-Key. Returns true when the request was answered from the store.
// Otherwise it hooks the response so the outcome is recorded once it is sent.
export function withIdempotency(database, request, response, getUser, url) {
  const key = request.headers["idempotency-key"];
  const user = typeof key === "string" ? getUser() : null;
  if (!user || typeof key !== "string" || !KEY_PATTERN.test(key)) return false;
  if (!["POST", "PATCH", "DELETE"].includes(request.method) || !url.pathname.startsWith("/api/")) return false;

  const stored = database.prepare(
    "SELECT method, path, status, body FROM idempotency_keys WHERE user_id = ? AND key = ? AND created_at > ?"
  ).get(user.id, key, Date.now() - IDEMPOTENCY_TTL_MS);
  const send = (status, body) => {
    response.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
      "Idempotency-Replayed": "true",
    });
    response.end(body);
  };
  if (stored) {
    if (stored.method !== request.method || stored.path !== url.pathname) {
      send(422, JSON.stringify({ error: "Idempotency-Key was already used for a different request" }));
    } else {
      send(stored.status, stored.body);
    }
    return true;
  }

  const end = response.end.bind(response);
  response.end = (chunk, ...rest) => {
    const status = response.statusCode;
    // Only deterministic outcomes are recorded; access or server errors must stay retryable.
    if ((status < 300 || status === 400) && typeof chunk === "string" && chunk.length <= MAX_STORED_BODY) {
      database.prepare(
        "INSERT OR IGNORE INTO idempotency_keys (user_id, key, method, path, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(user.id, key, request.method, url.pathname, status, chunk, Date.now());
    }
    return end(chunk, ...rest);
  };
  return false;
}
