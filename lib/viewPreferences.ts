"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-device, per-list view switches (e.g. hiding restock items). Like the collapsed
// categories, they are a view preference and stay out of the shared list document.

const PREFIX = "smart-todos:view:";
const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();

export function viewPreferenceKey(listId: string, name: string) {
  return `${PREFIX}${listId}:${name}`;
}

function read(key: string): boolean {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(key);
      if (stored !== null) return stored === "1";
    }
  } catch {
    // Fall through to the in-memory value.
  }
  return memory.get(key) ?? false;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function useListViewPreference(listId: string, name: string): [boolean, (value: boolean) => void] {
  const key = viewPreferenceKey(listId, name);
  const value = useSyncExternalStore(subscribe, () => read(key), () => false);
  const setValue = useCallback((next: boolean) => {
    memory.set(key, next);
    try {
      if (next) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch {
      // Storage unavailable: the in-memory value lasts for this tab.
    }
    for (const listener of listeners) listener();
  }, [key]);
  return [value, setValue];
}
