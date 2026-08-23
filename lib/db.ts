"use client";

import { useEffect, useSyncExternalStore } from "react";
import * as Automerge from "@automerge/automerge/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { mayUseOfflineFallback, scopedCacheKey } from "../shared/cache-policy.mjs";
import { refreshFullListDetails } from "../shared/list-refresh-policy.mjs";
import { userDisplayName } from "../shared/identity.mjs";
import {
  applyContentOperationsToDraft,
  collectListAssociations,
  explicitListId,
  groupContentOperations,
} from "../shared/transaction-routing.mjs";

export interface User { id: string; email?: string | null; name?: string | null; username?: string | null; active?: boolean }
type EntityName = "todoLists" | "todos" | "sublists" | "todoClassifications" | "listMembers" | "invitations" | "pinnedLists";
type Operation = { entity: EntityName; id: string; kind: "update" | "delete" | "link" | "unlink"; data?: Record<string, any>; links?: Record<string, string> };
interface ListDocument { [key: string]: unknown; schemaVersion: 1; todos: Record<string, any>; categories: Record<string, any>; classifierHistory: Record<string, any> }
interface ListState { metadata: any; document?: Automerge.Doc<ListDocument>; socket?: WebSocket; access?: "read" | "write" }

class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const apiBase = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
const MAX_DOCUMENT_BYTES = 2_000_000;
const wasmReady = Automerge.initializeBase64Wasm(automergeWasmBase64);
const listeners = new Set<() => void>();
const lists = new Map<string, ListState>();
let user: User | null = null;
let authLoading = true;
let authError: Error | null = null;
let dashboardLoading = false;
let dashboardLoaded = false;
let dashboardError: Error | null = null;
let dashboardIds: string[] = [];
let invitations: any[] = [];
let invitationsLoading = false;
let invitationsLoaded = false;
let invitationsError: Error | null = null;
let revision = 0;

function emit() { revision += 1; for (const listener of listeners) listener(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
function snapshot() { return revision; }

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(value.message || value.error || `Request failed (${response.status})`, response.status, value.error);
  return value;
}

function cachedMetadata(key: string): any {
  if (typeof localStorage === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(`smart-todos:${key}`) || "null"); } catch { return null; }
}
function cacheMetadata(key: string, value: any) { if (typeof localStorage !== "undefined") localStorage.setItem(`smart-todos:${key}`, JSON.stringify(value)); }
function cacheScope() { return user?.id || "anonymous"; }
function listCacheKey(slug: string) { return scopedCacheKey("list", cacheScope(), slug); }
function documentCacheKey(listId: string) { return scopedCacheKey("document", cacheScope(), listId); }

function openDocumentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("smart-todos-automerge", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("documents");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readLocalDocument(listId: string): Promise<Automerge.Doc<ListDocument> | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const database = await openDocumentDatabase();
  return new Promise<Automerge.Doc<ListDocument> | undefined>((resolve, reject) => {
    const request = database.transaction("documents", "readonly").objectStore("documents").get(documentCacheKey(listId));
    request.onsuccess = () => {
      if (!request.result) return resolve(undefined);
      const bytes = new Uint8Array(request.result);
      resolve(bytes.byteLength <= MAX_DOCUMENT_BYTES ? Automerge.load<ListDocument>(bytes) : undefined);
    };
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}
async function writeLocalDocument(listId: string, document: Automerge.Doc<ListDocument>) {
  if (typeof indexedDB === "undefined") return;
  const bytes = Automerge.save(document);
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("This list is too large to store or synchronize safely");
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction("documents", "readwrite").objectStore("documents").put(bytes, documentCacheKey(listId));
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  database.close();
}
async function clearLocalDocuments() {
  if (typeof indexedDB === "undefined") return;
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction("documents", "readwrite").objectStore("documents").clear();
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  database.close();
}
function clearMetadataForUser(userId: string) {
  if (typeof localStorage === "undefined") return;
  const prefixes = [
    `smart-todos:dashboard:${userId}`,
    `smart-todos:list:${userId}:`,
  ];
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key && prefixes.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key);
  }
}
function clearLoadedLists() {
  for (const state of lists.values()) state.socket?.close(1000, "Account changed");
  lists.clear();
  dashboardLoaded = false;
  dashboardIds = [];
}
function emptyDocument() { return Automerge.from<ListDocument>({ schemaVersion: 1, todos: {}, categories: {}, classifierHistory: {} }); }

function websocketUrl(listId: string) {
  const base = new URL(apiBase || window.location.origin, window.location.origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/sync`;
  base.search = new URLSearchParams({ listId }).toString();
  return base.href;
}
function connectList(listId: string) {
  const state = lists.get(listId);
  if (!state || state.socket || typeof WebSocket === "undefined") return;
  const socket = new WebSocket(websocketUrl(listId)); socket.binaryType = "arraybuffer"; state.socket = socket;
  socket.onmessage = async (event) => {
    if (typeof event.data === "string") { const message = JSON.parse(event.data); if (message.type === "ready") state.access = message.access; return; }
    const remoteBytes = new Uint8Array(event.data);
    if (remoteBytes.byteLength > MAX_DOCUMENT_BYTES) { socket.close(1009, "Document too large"); return; }
    const remote = Automerge.load<ListDocument>(remoteBytes);
    const local = state.document;
    const merged = state.access === "read" || !local ? remote : Automerge.merge(local, remote);
    const shouldUpload = state.access === "write" && !!local
      && Automerge.getHeads(merged).join(",") !== Automerge.getHeads(remote).join(",");
    await writeLocalDocument(listId, merged);
    state.document = merged;
    if (shouldUpload && socket.readyState === WebSocket.OPEN) {
      const bytes = Automerge.save(state.document);
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("This list is too large to synchronize safely");
      socket.send(bytes);
    }
    emit();
  };
  socket.onclose = () => { if (state.socket === socket) state.socket = undefined; setTimeout(() => connectList(listId), 2_000); };
}
async function registerList(metadata: any) {
  await wasmReady;
  let state = lists.get(metadata.id);
  if (!state) { state = { metadata, document: await readLocalDocument(metadata.id) }; lists.set(metadata.id, state); }
  else state.metadata = state.metadata._full && !metadata._full
    ? {
      ...metadata,
      _full: true,
      members: state.metadata.members,
      invitations: state.metadata.invitations,
      groupGrants: state.metadata.groupGrants,
    }
    : metadata;
  connectList(metadata.id);
}

async function loadAuth() {
  const cachedUser = cachedMetadata("auth:user") as User | null;
  try {
    user = (await api("/api/auth/session")).user;
    if (cachedUser?.id && cachedUser.id !== user?.id) {
      clearMetadataForUser(cachedUser.id);
      await clearLocalDocuments();
      clearLoadedLists();
    }
    cacheMetadata("auth:user", user);
    authError = null;
  } catch (error) {
    if (mayUseOfflineFallback(error)) {
      user = cachedUser;
      authError = null;
    } else {
      user = null;
      authError = error as Error;
    }
  }
  finally { authLoading = false; emit(); }
}
if (typeof window !== "undefined") void loadAuth();

async function loadDashboard(force = false) {
  if (dashboardLoading || (dashboardLoaded && !force)) return;
  dashboardLoading = true; dashboardError = null; emit();
  try {
    const result = await api("/api/lists"); dashboardIds = result.lists.map((list: any) => list.id);
    await Promise.all(result.lists.map(registerList)); cacheMetadata(`dashboard:${user?.id}`, result); dashboardLoaded = true;
  } catch (error) {
    const cached = mayUseOfflineFallback(error) ? cachedMetadata(`dashboard:${user?.id}`) : null;
    if (cached?.lists) { dashboardIds = cached.lists.map((list: any) => list.id); await Promise.all(cached.lists.map(registerList)); dashboardLoaded = true; dashboardError = null; }
    else dashboardError = error as Error;
  } finally { dashboardLoading = false; emit(); }
}
async function loadList(slug: string, force = false) {
  if ([...lists.values()].some((state) => state.metadata.slug === slug && state.metadata._full) && !force) return;
  try { const result = await api(`/api/lists/${encodeURIComponent(slug)}`); result.list._full = true; await registerList(result.list); cacheMetadata(listCacheKey(slug), result.list); emit(); }
  catch (error) {
    const cached = mayUseOfflineFallback(error) ? cachedMetadata(listCacheKey(slug)) : null;
    if (cached) { await registerList(cached); emit(); }
    else {
      for (const [id, state] of lists) if (state.metadata.slug === slug) { state.socket?.close(1000, "List access denied"); lists.delete(id); }
      lists.set(`error:${slug}`, { metadata: { slug, error } }); emit();
    }
  }
}
async function loadInvitations(force = false) {
  if (invitationsLoading || (invitationsLoaded && !force) || !user) return;
  invitationsLoading = true; emit();
  try { invitations = (await api("/api/invitations")).invitations; invitationsLoaded = true; invitationsError = null; }
  catch (error) { invitationsError = error as Error; }
  finally { invitationsLoading = false; emit(); }
}

function materialize(state: ListState) {
  const document = state.document || emptyDocument(); const metadata = state.metadata;
  const sublists = Object.values(document.categories).map((category: any) => ({ ...category, todos: [] as any[] }));
  const categories = new Map(sublists.map((category: any) => [category.id, category]));
  const todos = Object.values(document.todos).map((todo: any) => ({ ...todo, sublist: todo.categoryId ? categories.get(todo.categoryId) : undefined }));
  for (const todo of todos) if (todo.sublist) todo.sublist.todos.push(todo);
  const todoClassifications = Object.values(document.classifierHistory).map((sample: any) => ({ ...sample, sublist: sample.categoryId ? categories.get(sample.categoryId) : undefined }));
  return { ...metadata, todos, sublists, todoClassifications };
}
function queryResult(query: any) {
  if (!query) return { isLoading: false, error: null, data: null };
  if (query.todoLists) {
    const slug = query.todoLists.$?.where?.slug;
    if (slug) { const state = [...lists.values()].find((candidate) => candidate.metadata.slug === slug && !candidate.metadata.error); const failed = lists.get(`error:${slug}`); return { isLoading: !state && !failed, error: failed?.metadata.error || null, data: { todoLists: state ? [materialize(state)] : [] } }; }
    const values = dashboardIds.flatMap((id) => { const state = lists.get(id); return state && (state.metadata.access?.owner || state.metadata.access?.member) ? [materialize(state)] : []; });
    return { isLoading: dashboardLoading || !dashboardLoaded, error: dashboardError, data: { todoLists: values } };
  }
  if (query.pinnedLists) {
    const values = dashboardIds.flatMap((id) => { const state = lists.get(id); const pin = state?.metadata.pins?.[0]; return state && pin && !state.metadata.access?.owner && !state.metadata.access?.member ? [{ ...pin, list: materialize(state), user }] : []; });
    return { isLoading: dashboardLoading || !dashboardLoaded, error: dashboardError, data: { pinnedLists: values } };
  }
  if (query.invitations) { const pendingOnly = query.invitations.$?.where?.status === "pending"; return { isLoading: invitationsLoading || !invitationsLoaded, error: invitationsError, data: { invitations: pendingOnly ? invitations.filter((item) => item.status === "pending") : invitations } }; }
  return { isLoading: false, error: new Error("Unsupported query"), data: null };
}
function useQuery(query: any) {
  useSyncExternalStore(subscribe, snapshot, () => 0);
  const slug = query?.todoLists?.$?.where?.slug;
  const queryType = query ? Object.keys(query)[0] : "none";
  const hasQuery = !!query;
  useEffect(() => {
    if (!hasQuery) return;
    if (slug) void loadList(slug);
    else if (queryType === "todoLists" || queryType === "pinnedLists") void loadDashboard();
    else if (queryType === "invitations") void loadInvitations();
  }, [queryType, slug, hasQuery]);
  return queryResult(query);
}

class TransactionBuilder {
  operations: Operation[];
  constructor(operation: Operation) { this.operations = [operation]; }
  link(links: Record<string, string>) { this.operations.push({ ...this.operations[0], kind: "link", links }); return this; }
  unlink(links: Record<string, string>) { this.operations.push({ ...this.operations[0], kind: "unlink", links }); return this; }
}
function operationList(input: any): Operation[] { return (Array.isArray(input) ? input : [input]).flatMap((item) => item?.operations || []); }
function entityListId(operation: Operation, listAssociations?: Map<string, string>) {
  const linkedListId = listAssociations ? explicitListId(operation, listAssociations) : operation.links?.list;
  if (linkedListId) return linkedListId; if (operation.entity === "todoLists") return operation.id;
  for (const [listId, state] of lists) { const document = state.document; if (document && (document.todos[operation.id] || document.categories[operation.id] || document.classifierHistory[operation.id])) return listId; if (state.metadata.members?.some((member: any) => member.id === operation.id)) return listId; if (state.metadata.invitations?.some((item: any) => item.id === operation.id)) return listId; }
}
function applyContentOperations(document: Automerge.Doc<ListDocument>, operations: Operation[]) {
  return Automerge.change(document, (draft) => {
    applyContentOperationsToDraft(draft, operations);
  });
}
function bytesToBase64(bytes: Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }

async function transact(input: any) {
  const operations = operationList(input);
  const listAssociations = collectListAssociations(operations);
  const deletedListIds = new Set(operations.filter((operation) => operation.entity === "todoLists" && operation.kind === "delete").map((operation) => operation.id));
  const classifierReset = operations.find((operation) => operation.entity === "todoLists" && operation.kind === "update" && operation.data?.classifierResetAt);
  if (classifierReset && operations.some((operation) => operation.entity === "todoClassifications" && operation.kind === "delete")) {
    await api(`/api/lists/${classifierReset.id}/classifier/reset`, { method: "POST" });
    const state = lists.get(classifierReset.id);
    if (state) await loadList(state.metadata.slug, true);
    return;
  }
  const newList = operations.find((operation) => operation.entity === "todoLists" && operation.kind === "update" && !lists.has(operation.id));
  if (newList) {
    const ownerLink = operations.find((operation) => operation.entity === "todoLists" && operation.id === newList.id && operation.kind === "link");
    if (!ownerLink?.links?.owner) throw new Error("A new list requires an owner");
    const content = operations.filter((operation) => ["todos", "sublists", "todoClassifications"].includes(operation.entity));
    const document = applyContentOperations(emptyDocument(), content);
    const result = await api("/api/lists", { method: "POST", body: JSON.stringify({ id: newList.id, ...newList.data, document: bytesToBase64(Automerge.save(document)) }) });
    await registerList(result.list); dashboardLoaded = false; await loadDashboard(true); return;
  }
  const contentByList = groupContentOperations(
    operations,
    listAssociations,
    (operation: Operation) => entityListId(operation),
  ) as Map<string, Operation[]>;
  for (const [listId, content] of contentByList) {
    const state = lists.get(listId);
    if (!state) throw new Error("List is not loaded");
    const nextDocument = applyContentOperations(state.document || emptyDocument(), content);
    await writeLocalDocument(listId, nextDocument);
    state.document = nextDocument;
    if (state.socket?.readyState === WebSocket.OPEN && state.access === "write") {
      const bytes = Automerge.save(state.document);
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("This list is too large to synchronize safely");
      state.socket.send(bytes);
    }
  }
  for (const operation of operations.filter((candidate) => candidate.entity === "todoLists")) { if (operation.kind === "update") await api(`/api/lists/${operation.id}`, { method: "PATCH", body: JSON.stringify(operation.data) }); if (operation.kind === "delete") await api(`/api/lists/${operation.id}`, { method: "DELETE" }); }
  const ownerTransfer = operations.find((candidate) => candidate.entity === "todoLists" && candidate.kind === "link" && candidate.links?.owner);
  if (ownerTransfer?.links?.owner) await api(`/api/lists/${ownerTransfer.id}/transfer`, { method: "POST", body: JSON.stringify({ userId: ownerTransfer.links.owner }) });
  for (const operation of operations.filter((candidate) => candidate.entity === "pinnedLists")) { const listId = operation.links?.list || [...lists.values()].find((state) => state.metadata.pins?.some((pin: any) => pin.id === operation.id))?.metadata.id; if (listId && operation.kind === "link") await api(`/api/lists/${listId}/pin`, { method: "POST" }); if (listId && operation.kind === "delete") await api(`/api/lists/${listId}/pin`, { method: "DELETE" }); }
  for (const operation of operations.filter((candidate) => candidate.entity === "invitations" && !deletedListIds.has(entityListId(candidate, listAssociations) || ""))) { if (operation.kind === "delete") await api(`/api/invitations/${operation.id}`, { method: "DELETE" }); else if (operation.kind === "update" && operation.data?.status) await api(`/api/invitations/${operation.id}`, { method: "PATCH", body: JSON.stringify({ status: operation.data.status }) }); else if (operation.kind === "update") { const link = operations.find((candidate) => candidate.entity === "invitations" && candidate.id === operation.id && candidate.links?.list); if (link?.links?.list) await api(`/api/lists/${link.links.list}/invitations`, { method: "POST", body: JSON.stringify(operation.data) }); } }
  if (!ownerTransfer) for (const operation of operations.filter((candidate) => candidate.entity === "listMembers" && candidate.kind === "delete" && !deletedListIds.has(entityListId(candidate, listAssociations) || ""))) await api(`/api/members/${operation.id}`, { method: "DELETE" });
  emit(); dashboardLoaded = false; invitationsLoaded = false;
  if (user) await Promise.all([
    loadDashboard(true),
    loadInvitations(true),
    refreshFullListDetails(lists.values(), loadList),
  ]);
}

const tx = new Proxy({}, { get(_target, entity: EntityName) { return new Proxy({}, { get(_entityTarget, entityId: string) { return { update(data: Record<string, any>) { return new TransactionBuilder({ entity, id: entityId, kind: "update", data }); }, delete() { return new TransactionBuilder({ entity, id: entityId, kind: "delete" }); }, link(links: Record<string, string>) { return new TransactionBuilder({ entity, id: entityId, kind: "link", links }); }, unlink(links: Record<string, string>) { return new TransactionBuilder({ entity, id: entityId, kind: "unlink", links }); } }; } }); } }) as any;

export const db = {
  tx, transact, useQuery,
  room(type: string, id: string) { return { type, id }; },
  useAuth() { useSyncExternalStore(subscribe, snapshot, () => 0); return { isLoading: authLoading, user, error: authError }; },
  auth: {
    signIn() { const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`; window.location.href = `${apiBase}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`; },
    async signOut() {
      await api("/api/auth/logout", { method: "POST" });
      const signedOutUserId = user?.id;
      clearLoadedLists();
      if (signedOutUserId) clearMetadataForUser(signedOutUserId);
      await clearLocalDocuments();
      user = null;
      cacheMetadata("auth:user", null);
      invitations = [];
      invitationsLoaded = false;
      emit();
    },
  },
  sharing: {
    search(listId: string, query: string) {
      return api(`/api/lists/${encodeURIComponent(listId)}/share-targets?q=${encodeURIComponent(query)}`);
    },
    async addUser(listId: string, userId: string) {
      await api(`/api/lists/${encodeURIComponent(listId)}/members`, { method: "POST", body: JSON.stringify({ userId }) });
      const state = lists.get(listId); if (state) await loadList(state.metadata.slug, true);
    },
    async addGroup(listId: string, groupId: string) {
      await api(`/api/lists/${encodeURIComponent(listId)}/groups`, { method: "POST", body: JSON.stringify({ groupId }) });
      const state = lists.get(listId); if (state) await loadList(state.metadata.slug, true);
    },
    async removeGroup(listId: string, grantId: string) {
      await api(`/api/group-grants/${encodeURIComponent(grantId)}`, { method: "DELETE" });
      const state = lists.get(listId); if (state) await loadList(state.metadata.slug, true);
    },
  },
  rooms: { usePresence(_room?: any, _options?: any) { return { peers: {}, publishPresence: presenceNoop, user: user ? { name: userDisplayName(user), userId: user.id } : null }; } },
};

function presenceNoop(_presence?: any) {}
