"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which categories are collapsed is a per-device view preference, so it lives in
// localStorage rather than in the shared list document.

export const UNCATEGORIZED_SECTION_ID = "uncategorized";

const EMPTY: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: ReadonlySet<string> }>();

export function collapsedStorageKey(listId: string) {
  return `smart-todos:collapsed:${listId}`;
}

export function parseCollapsed(raw: string | null): ReadonlySet<string> {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return EMPTY;
  }
}

export function toggleCollapsed(current: ReadonlySet<string>, sectionId: string): string[] {
  const next = new Set(current);
  if (next.has(sectionId)) next.delete(sectionId);
  else next.add(sectionId);
  return [...next];
}

function readRaw(listId: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(collapsedStorageKey(listId));
  } catch {
    return null;
  }
}

function snapshot(listId: string): ReadonlySet<string> {
  const raw = readRaw(listId);
  const cached = cache.get(listId);
  if (cached && cached.raw === raw) return cached.value;
  const value = parseCollapsed(raw);
  cache.set(listId, { raw, value });
  return value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith("smart-todos:collapsed:")) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function useCollapsedCategories(listId: string) {
  const collapsed = useSyncExternalStore(subscribe, () => snapshot(listId), () => EMPTY);
  const toggle = useCallback((sectionId: string) => {
    const next = toggleCollapsed(snapshot(listId), sectionId);
    try {
      if (next.length === 0) localStorage.removeItem(collapsedStorageKey(listId));
      else localStorage.setItem(collapsedStorageKey(listId), JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode, quota): keep the state in memory for this tab.
      cache.set(listId, { raw: readRaw(listId), value: new Set(next) });
    }
    for (const listener of listeners) listener();
  }, [listId]);
  return { collapsed, toggle };
}
