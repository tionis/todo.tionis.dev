export function createFixedWindowRateLimiter({ limit, windowMs, maxKeys = 10_000 }) {
  const windows = new Map();

  return function allow(key, now = Date.now()) {
    if (windows.size >= maxKeys) {
      for (const [candidate, entry] of windows) {
        if (entry.resetAt <= now) windows.delete(candidate);
      }
      if (!windows.has(key) && windows.size >= maxKeys) return false;
    }
    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  };
}

// Same fixed-window policy, but kept in SQLite so restarts do not reset the counters.
// Meant for low-volume, security-relevant limits such as login attempts.
export function createPersistentRateLimiter(database, { name, limit, windowMs }) {
  const select = database.prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?");
  const upsert = database.prepare(`
    INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at
  `);
  return database.transaction((key, now = Date.now()) => {
    const id = `${name}:${key}`;
    const current = select.get(id);
    if (!current || current.reset_at <= now) {
      upsert.run(id, 1, now + windowMs);
      return true;
    }
    if (current.count >= limit) return false;
    upsert.run(id, current.count + 1, current.reset_at);
    return true;
  });
}
