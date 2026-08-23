export function mayUseOfflineFallback(error) {
  return error instanceof TypeError
    || (error?.status === 503 && error?.code === "offline");
}

export function scopedCacheKey(kind, userId, identifier) {
  return `${kind}:${userId || "anonymous"}:${identifier}`;
}
