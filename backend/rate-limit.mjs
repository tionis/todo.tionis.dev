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
