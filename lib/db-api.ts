import { ApiError } from "./db-types";

export const apiBase = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");

export async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(value.message || value.error || `Request failed (${response.status})`, response.status, value.error);
  return value;
}

export function base64ToBytes(value: string) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
export function bytesToBase64(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
