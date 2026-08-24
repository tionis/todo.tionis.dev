export type LaunchAction = "new" | "share" | null;
export type StorageNotice = { level: "info" | "warning" | "critical"; message: string } | null;
export const SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function composeSharedText(title?: string | null, text?: string | null, sharedUrl?: string | null): string | undefined {
  const parts: string[] = [];
  for (const value of [title, text, sharedUrl]) {
    const normalized = value?.trim();
    if (normalized && !parts.includes(normalized)) parts.push(normalized);
  }
  return parts.join("\n").slice(0, 20_000) || undefined;
}

export function isStoredShareFresh(createdAt: unknown, now = Date.now()): boolean {
  return typeof createdAt === "number" && Number.isFinite(createdAt) && createdAt >= now - SHARE_MAX_AGE_MS && createdAt <= now;
}

export function consumeLaunchAction(href: string): { action: LaunchAction; nextUrl: string; sharedText?: string; shareId?: string } {
  const url = new URL(href);
  const requestedAction = url.searchParams.get("action");
  const action = requestedAction === "new" || requestedAction === "share" ? requestedAction : null;
  let sharedText: string | undefined;
  let shareId: string | undefined;
  if (action === "share") {
    const text = url.searchParams.get("text")?.trim();
    const title = url.searchParams.get("title")?.trim();
    const sharedUrl = url.searchParams.get("url")?.trim();
    sharedText = composeSharedText(title, text, sharedUrl);
    const requestedShareId = url.searchParams.get("shareId")?.trim();
    shareId = requestedShareId && /^[a-zA-Z0-9-]{1,100}$/.test(requestedShareId) ? requestedShareId : undefined;
    for (const parameter of ["title", "text", "url", "shareId"]) url.searchParams.delete(parameter);
  }
  if (action) url.searchParams.delete("action");
  return {
    action,
    nextUrl: `${url.pathname}${url.search}${url.hash}`,
    ...(sharedText ? { sharedText } : {}),
    ...(shareId ? { shareId } : {}),
  };
}

export async function consumeStoredShare(shareId: string): Promise<string | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("smart-todos-pwa", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("shares")) {
        request.result.createObjectStore("shares", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<string | undefined>((resolve, reject) => {
      const transaction = database.transaction("shares", "readwrite");
      const store = transaction.objectStore("shares");
      const request = store.get(shareId);
      let text: string | undefined;
      request.onsuccess = () => {
        text = isStoredShareFresh(request.result?.createdAt) && typeof request.result?.text === "string"
          ? request.result.text.slice(0, 20_000)
          : undefined;
        store.delete(shareId);
      };
      transaction.oncomplete = () => resolve(text || undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iphone|ipad|ipod/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function storageNotice(
  persisted: boolean,
  estimate: { usage?: number; quota?: number },
): StorageNotice {
  const ratio = estimate.quota ? (estimate.usage || 0) / estimate.quota : 0;
  if (ratio >= 0.9) return { level: "critical", message: "Offline storage is almost full. Export important lists and free some browser storage." };
  if (ratio >= 0.75) return { level: "warning", message: "Offline storage is running low. Consider exporting important lists." };
  if (!persisted) return { level: "info", message: "Offline data is browser-managed and may be removed under storage pressure." };
  return null;
}
