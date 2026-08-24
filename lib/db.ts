"use client";

import { useEffect, useSyncExternalStore } from "react";
import * as Automerge from "@automerge/automerge/slim";
import { automergeWasmBase64 } from "@automerge/automerge/automerge.wasm.base64";
import { mayUseOfflineFallback, scopedCacheKey } from "../shared/cache-policy.mjs";
import { commitPersistedDocument } from "../shared/content-commit.mjs";
import { userDisplayName } from "../shared/identity.mjs";
import { deliveryDisposition, orderedPendingCommands, summarizeOutbox } from "../shared/offline-outbox.mjs";
import { rankDirectoryEntries } from "../backend/directory-search.mjs";
import { reconcileRemoteDocument } from "../shared/sync-policy.mjs";
import {
  applyContentOperationsToDraft,
  classifierResetPlan,
  collectListAssociations,
  explicitListId,
  groupContentOperations,
  withoutRedundantListContentDeletes,
} from "../shared/transaction-routing.mjs";
import { runTransactionPhases } from "../shared/transaction-phases.mjs";

export interface User { id: string; email?: string | null; name?: string | null; username?: string | null; active?: boolean }
type EntityName = "todoLists" | "todos" | "sublists" | "todoClassifications" | "listMembers" | "invitations" | "pinnedLists";
type Operation = { entity: EntityName; id: string; kind: "update" | "delete" | "link" | "unlink"; data?: Record<string, any>; links?: Record<string, string> };
interface ListDocument { [key: string]: unknown; schemaVersion: 1; todos: Record<string, any>; categories: Record<string, any>; classifierHistory: Record<string, any> }
interface ListState { metadata: any; document?: Automerge.Doc<ListDocument>; socket?: WebSocket; access?: "read" | "write" }
interface QueuedRequest {
  id: string;
  userId: string;
  listId?: string;
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: Record<string, any>;
  createdAt: string;
  status: "pending" | "rejected";
  error?: string;
}

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
let outbox: QueuedRequest[] = [];
let outboxLoaded = false;
let outboxSyncing = false;
let flushPromise: Promise<void> | null = null;
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
function invitationCacheKey() { return scopedCacheKey("invitations", cacheScope(), "all"); }
function directoryCacheKey(listId: string) { return scopedCacheKey("directory", cacheScope(), listId); }

function openDocumentDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("smart-todos-automerge", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("documents")) request.result.createObjectStore("documents");
      if (!request.result.objectStoreNames.contains("outbox")) request.result.createObjectStore("outbox", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readOutbox(): Promise<QueuedRequest[]> {
  if (typeof indexedDB === "undefined" || !user) return [];
  const database = await openDocumentDatabase();
  return new Promise<QueuedRequest[]>((resolve, reject) => {
    const request = database.transaction("outbox", "readonly").objectStore("outbox").getAll();
    request.onsuccess = () => resolve((request.result as QueuedRequest[]).filter((command) => command.userId === user?.id));
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}
async function putOutboxCommand(command: QueuedRequest) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction("outbox", "readwrite").objectStore("outbox").put(command);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  database.close();
}
async function deleteOutboxCommand(id: string) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction("outbox", "readwrite").objectStore("outbox").delete(id);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  database.close();
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
async function deleteLocalDocument(listId: string) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction("documents", "readwrite").objectStore("documents").delete(documentCacheKey(listId));
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  database.close();
}
async function clearLocalDocuments() {
  if (typeof indexedDB === "undefined") return;
  const database = await openDocumentDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["documents", "outbox"], "readwrite");
    transaction.objectStore("documents").clear();
    const request = transaction.objectStore("outbox").clear();
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  database.close();
}
function clearMetadataForUser(userId: string) {
  if (typeof localStorage === "undefined") return;
  const prefixes = [
    `smart-todos:dashboard:${userId}`,
    `smart-todos:list:${userId}:`,
    `smart-todos:invitations:${userId}:`,
    `smart-todos:directory:${userId}:`,
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
  outbox = [];
  outboxLoaded = false;
}
function emptyDocument() { return Automerge.from<ListDocument>({ schemaVersion: 1, todos: {}, categories: {}, classifierHistory: {} }); }
function base64ToBytes(value: string) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }

function websocketUrl(listId: string) {
  const base = new URL(apiBase || window.location.origin, window.location.origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/sync`;
  base.search = new URLSearchParams({ listId }).toString();
  return base.href;
}
function connectList(listId: string) {
  const state = lists.get(listId);
  if (!state || state.socket || state.metadata._localOnly || state.metadata._deleted || typeof WebSocket === "undefined") return;
  const socket = new WebSocket(websocketUrl(listId)); socket.binaryType = "arraybuffer"; state.socket = socket;
  socket.onmessage = async (event) => {
    if (typeof event.data === "string") { const message = JSON.parse(event.data); if (message.type === "ready") state.access = message.access; return; }
    const remoteBytes = new Uint8Array(event.data);
    if (remoteBytes.byteLength > MAX_DOCUMENT_BYTES) { socket.close(1009, "Document too large"); return; }
    const remote = Automerge.load<ListDocument>(remoteBytes);
    const reconciled = reconcileRemoteDocument(Automerge, state.document, remote, state.access);
    await writeLocalDocument(listId, reconciled.document);
    state.document = reconciled.document;
    if (reconciled.shouldUpload && socket.readyState === WebSocket.OPEN) {
      const bytes = Automerge.save(reconciled.document);
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("This list is too large to synchronize safely");
      socket.send(bytes);
    }
    emit();
  };
  socket.onclose = () => { if (state.socket === socket) state.socket = undefined; setTimeout(() => connectList(listId), 2_000); };
}
async function registerList(metadata: any, serializedDocument?: string) {
  await wasmReady;
  let state = lists.get(metadata.id);
  const fetchedDocument = serializedDocument ? Automerge.load<ListDocument>(base64ToBytes(serializedDocument)) : undefined;
  const metadataAccess = metadata.access?.write ? "write" : metadata.access?.read ? "read" : undefined;
  if (!state) { state = { metadata, document: (await readLocalDocument(metadata.id)) || fetchedDocument, access: metadataAccess }; lists.set(metadata.id, state); }
  else state.metadata = state.metadata._full && !metadata._full
    ? {
      ...metadata,
      _full: true,
      members: state.metadata.members,
      invitations: state.metadata.invitations,
      groupGrants: state.metadata.groupGrants,
    }
    : metadata;
  if (metadataAccess) state.access = metadataAccess;
  if (fetchedDocument) {
    const reconciled = reconcileRemoteDocument(Automerge, state.document, fetchedDocument, state.access);
    state.document = reconciled.document;
    await writeLocalDocument(metadata.id, reconciled.document);
  }
  connectList(metadata.id);
}

function persistMetadataCaches() {
  if (!user) return;
  const dashboardLists = dashboardIds.flatMap((listId) => lists.get(listId)?.metadata || []);
  cacheMetadata(`dashboard:${user.id}`, { lists: dashboardLists });
  for (const state of lists.values()) {
    if (state.metadata?._full && state.metadata.slug) cacheMetadata(listCacheKey(state.metadata.slug), state.metadata);
  }
  cacheMetadata(invitationCacheKey(), { invitations });
}

async function enqueueRequest(command: Omit<QueuedRequest, "id" | "userId" | "createdAt" | "status">) {
  if (!user) throw new Error("Authentication required");
  if (outbox.length >= 1_000) throw new Error("Too many offline changes are waiting to synchronize");
  const queued: QueuedRequest = {
    ...command,
    id: crypto.randomUUID(),
    userId: user.id,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  outbox.push(queued);
  await putOutboxCommand(queued);
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    void navigator.serviceWorker.ready.then((registration) => (registration as any).sync?.register("smart-todos-outbox")).catch(() => {});
  }
  emit();
  return queued;
}

async function flushOutbox() {
  if (flushPromise) return flushPromise;
  if (!user || !outboxLoaded || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  flushPromise = (async () => {
    outboxSyncing = true; emit();
    let delivered = false;
    try {
      for (const command of orderedPendingCommands(outbox) as QueuedRequest[]) {
        try {
          const result = await api(command.path, {
            method: command.method,
            body: command.body === undefined ? undefined : JSON.stringify(command.body),
            headers: { "Idempotency-Key": command.id },
          });
          if (result.list) {
            result.list._full = true;
            const current = lists.get(result.list.id);
            const hasLaterLocalChange = outbox.some((candidate) => candidate.id !== command.id && candidate.status === "pending" && candidate.listId === result.list.id);
            if (current && hasLaterLocalChange) result.list = { ...result.list, ...current.metadata, _localOnly: false };
            else if (current) result.list = { ...result.list, _localOnly: false, _deleted: false };
            await registerList(result.list, result.document);
          }
          if (command.method === "DELETE" && command.listId && command.path === `/api/lists/${command.listId}`) {
            const deleted = lists.get(command.listId);
            if (deleted?.metadata.slug && typeof localStorage !== "undefined") localStorage.removeItem(`smart-todos:${listCacheKey(deleted.metadata.slug)}`);
            deleted?.socket?.close(1000, "List deleted");
            lists.delete(command.listId);
            dashboardIds = dashboardIds.filter((id) => id !== command.listId);
            await deleteLocalDocument(command.listId);
          }
          outbox = outbox.filter((candidate) => candidate.id !== command.id);
          await deleteOutboxCommand(command.id);
          delivered = true;
        } catch (error) {
          if (deliveryDisposition(error) === "retry") break;
          command.status = "rejected";
          command.error = error instanceof Error ? error.message : "Server rejected this change";
          await putOutboxCommand(command);
        }
        emit();
      }
      if (delivered && typeof navigator !== "undefined" && navigator.onLine) {
        await Promise.allSettled([loadDashboard(true), loadInvitations(true)]);
      }
    } finally {
      outboxSyncing = false; emit();
    }
  })().finally(() => { flushPromise = null; });
  return flushPromise;
}

async function loadUserOutbox() {
  outbox = await readOutbox();
  outboxLoaded = true;
  const cached = cachedMetadata(`dashboard:${user?.id}`);
  if (cached?.lists) {
    dashboardIds = cached.lists.map((list: any) => list.id);
    await Promise.all(cached.lists.map((metadata: any) => registerList(metadata)));
  }
  await flushOutbox();
}

async function resumeOutboxSync() {
  if (!user || !outboxLoaded) return;
  if (flushPromise) await flushPromise;
  outbox = await readOutbox();
  emit();
  await flushOutbox();
}

async function loadAuth() {
  const cachedUser = cachedMetadata("auth:user") as User | null;
  const lastUser = (cachedMetadata("auth:last-user") || cachedUser) as User | null;
  try {
    user = (await api("/api/auth/session")).user;
    if (lastUser?.id && user?.id && lastUser.id !== user.id) {
      clearMetadataForUser(lastUser.id);
      await clearLocalDocuments();
      clearLoadedLists();
    }
    cacheMetadata("auth:user", user);
    if (user) cacheMetadata("auth:last-user", user);
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
  if (user) await loadUserOutbox();
  authLoading = false;
  emit();
}
if (typeof window !== "undefined") void loadAuth();
if (typeof window !== "undefined") {
  let lastResumeAt = 0;
  const resume = (force = false) => {
    const now = Date.now();
    if (!force && now - lastResumeAt < 15_000) return;
    lastResumeAt = now;
    void resumeOutboxSync();
  };
  window.addEventListener("online", () => resume(true));
  window.addEventListener("focus", () => resume());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resume();
  });
}

async function loadDashboard(force = false) {
  if (dashboardLoading || (dashboardLoaded && !force)) return;
  dashboardLoading = true; dashboardError = null; emit();
  try {
    const result = await api("/api/lists");
    const localIds = dashboardIds.filter((id) => lists.get(id)?.metadata._localOnly || lists.get(id)?.metadata._deleted);
    dashboardIds = [...new Set([...result.lists.map((list: any) => list.id), ...localIds])];
    await Promise.all(result.lists.map((metadata: any) => registerList(metadata)));
    for (const metadata of result.lists) {
      const full = await api(`/api/lists/${encodeURIComponent(metadata.id)}`);
      full.list._full = true;
      await registerList(full.list, full.document);
      cacheMetadata(listCacheKey(full.list.slug), full.list);
      if (full.list.access?.owner) {
        try {
          const directory = await api(`/api/lists/${encodeURIComponent(full.list.id)}/share-targets?cache=1`);
          cacheMetadata(directoryCacheKey(full.list.id), directory);
        } catch (error) {
          if (!mayUseOfflineFallback(error)) console.warn("Could not cache sharing directory", error);
        }
      }
    }
    persistMetadataCaches(); dashboardLoaded = true;
  } catch (error) {
    const cached = mayUseOfflineFallback(error) ? cachedMetadata(`dashboard:${user?.id}`) : null;
    if (cached?.lists) { dashboardIds = cached.lists.map((list: any) => list.id); await Promise.all(cached.lists.map(registerList)); dashboardLoaded = true; dashboardError = null; }
    else dashboardError = error as Error;
  } finally { dashboardLoading = false; emit(); }
}
async function loadList(slug: string, force = false) {
  if ([...lists.values()].some((state) => state.metadata.slug === slug && state.metadata._full) && !force) return;
  try { const result = await api(`/api/lists/${encodeURIComponent(slug)}`); result.list._full = true; await registerList(result.list, result.document); cacheMetadata(listCacheKey(slug), result.list); emit(); }
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
  try { invitations = (await api("/api/invitations")).invitations; invitationsLoaded = true; invitationsError = null; cacheMetadata(invitationCacheKey(), { invitations }); }
  catch (error) {
    const cached = mayUseOfflineFallback(error) ? cachedMetadata(invitationCacheKey()) : null;
    if (cached?.invitations) { invitations = cached.invitations; invitationsLoaded = true; invitationsError = null; }
    else if (mayUseOfflineFallback(error)) { invitations = []; invitationsLoaded = true; invitationsError = null; }
    else invitationsError = error as Error;
  }
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
    if (slug) { const state = [...lists.values()].find((candidate) => candidate.metadata.slug === slug && !candidate.metadata.error && !candidate.metadata._deleted); const failed = lists.get(`error:${slug}`); return { isLoading: !state && !failed, error: failed?.metadata.error || null, data: { todoLists: state ? [materialize(state)] : [] } }; }
    const values = dashboardIds.flatMap((id) => { const state = lists.get(id); return state && !state.metadata._deleted && (state.metadata.access?.owner || state.metadata.access?.member) ? [materialize(state)] : []; });
    return { isLoading: dashboardLoading || !dashboardLoaded, error: dashboardError, data: { todoLists: values } };
  }
  if (query.pinnedLists) {
    const values = dashboardIds.flatMap((id) => { const state = lists.get(id); const pin = state?.metadata.pins?.[0]; return state && !state.metadata._deleted && pin && !state.metadata.access?.owner && !state.metadata.access?.member ? [{ ...pin, list: materialize(state), user }] : []; });
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

function findStateForEntity(entity: "listMembers" | "invitations" | "pinnedLists", id: string) {
  return [...lists.values()].find((state) => state.metadata[entity === "listMembers" ? "members" : entity]?.some((item: any) => item.id === id));
}

function applyOptimisticMetadata(operations: Operation[], associations: Map<string, string>) {
  for (const operation of operations) {
    if (operation.entity === "todoLists") {
      const state = lists.get(operation.id);
      if (!state) continue;
      if (operation.kind === "update") state.metadata = { ...state.metadata, ...operation.data };
      if (operation.kind === "delete") state.metadata = { ...state.metadata, _deleted: true };
      if (operation.kind === "link" && operation.links?.owner) {
        state.metadata.owner = { id: operation.links.owner };
        state.metadata.access = { ...state.metadata.access, owner: operation.links.owner === user?.id };
      }
      continue;
    }
    if (operation.entity === "invitations") {
      const linkedListId = explicitListId(operation, associations);
      const state = linkedListId ? lists.get(linkedListId) : findStateForEntity("invitations", operation.id);
      if (operation.kind === "delete") {
        if (state) state.metadata.invitations = (state.metadata.invitations || []).filter((item: any) => item.id !== operation.id);
        invitations = invitations.filter((item) => item.id !== operation.id);
      } else if (operation.kind === "update") {
        const existing = state?.metadata.invitations?.find((item: any) => item.id === operation.id);
        const value = { id: operation.id, ...existing, ...operation.data, _localOnly: !existing };
        if (state) state.metadata.invitations = [...(state.metadata.invitations || []).filter((item: any) => item.id !== operation.id), value];
        invitations = invitations.map((item) => item.id === operation.id ? { ...item, ...operation.data } : item);
      }
      continue;
    }
    if (operation.entity === "listMembers") {
      const listId = explicitListId(operation, associations);
      const state = listId ? lists.get(listId) : findStateForEntity("listMembers", operation.id);
      if (!state) continue;
      if (operation.kind === "delete") state.metadata.members = (state.metadata.members || []).filter((item: any) => item.id !== operation.id);
      if (operation.kind === "update") {
        const userLink = operations.find((candidate) => candidate.entity === "listMembers" && candidate.id === operation.id && candidate.links?.user)?.links?.user;
        const existing = state.metadata.members?.find((item: any) => item.id === operation.id);
        const memberUser = userLink === user?.id ? user : { id: userLink };
        state.metadata.members = [...(state.metadata.members || []).filter((item: any) => item.id !== operation.id), { id: operation.id, ...existing, ...operation.data, user: existing?.user || memberUser, _localOnly: !existing }];
      }
      continue;
    }
    if (operation.entity === "pinnedLists") {
      const linkedListId = explicitListId(operation, associations);
      const state = linkedListId ? lists.get(linkedListId) : findStateForEntity("pinnedLists", operation.id);
      if (!state) continue;
      if (operation.kind === "delete") state.metadata.pins = (state.metadata.pins || []).filter((item: any) => item.id !== operation.id);
      if (operation.kind === "update") state.metadata.pins = [...(state.metadata.pins || []).filter((item: any) => item.id !== operation.id), { id: operation.id, ...operation.data, user, _localOnly: true }];
    }
  }
  persistMetadataCaches();
}

function authoritativeRequests(operations: Operation[], associations: Map<string, string>): Array<Omit<QueuedRequest, "id" | "userId" | "createdAt" | "status">> {
  const requests: Array<Omit<QueuedRequest, "id" | "userId" | "createdAt" | "status">> = [];
  const deletedListIds = new Set(operations.filter((operation) => operation.entity === "todoLists" && operation.kind === "delete").map((operation) => operation.id));
  for (const operation of operations.filter((candidate) => candidate.entity === "todoLists")) {
    if (operation.kind === "update") requests.push({ listId: operation.id, method: "PATCH", path: `/api/lists/${operation.id}`, body: operation.data });
    if (operation.kind === "delete") requests.push({ listId: operation.id, method: "DELETE", path: `/api/lists/${operation.id}` });
  }
  const transfer = operations.find((candidate) => candidate.entity === "todoLists" && candidate.kind === "link" && candidate.links?.owner);
  if (transfer?.links?.owner) requests.push({ listId: transfer.id, method: "POST", path: `/api/lists/${transfer.id}/transfer`, body: { userId: transfer.links.owner } });
  for (const operation of operations.filter((candidate) => candidate.entity === "pinnedLists")) {
    const listId = operation.links?.list || findStateForEntity("pinnedLists", operation.id)?.metadata.id;
    if (listId && deletedListIds.has(listId)) continue;
    if (listId && operation.kind === "link") requests.push({ listId, method: "POST", path: `/api/lists/${listId}/pin` });
    if (listId && operation.kind === "delete") requests.push({ listId, method: "DELETE", path: `/api/lists/${listId}/pin` });
  }
  for (const operation of operations.filter((candidate) => candidate.entity === "invitations")) {
    const listId = explicitListId(operation, associations) || findStateForEntity("invitations", operation.id)?.metadata.id;
    if (listId && deletedListIds.has(listId)) continue;
    if (operation.kind === "delete") requests.push({ listId, method: "DELETE", path: `/api/invitations/${operation.id}` });
    else if (operation.kind === "update" && operation.data?.status && !operation.links?.list) requests.push({ listId, method: "PATCH", path: `/api/invitations/${operation.id}`, body: { status: operation.data.status } });
    else if (operation.kind === "update" && listId) requests.push({ listId, method: "POST", path: `/api/lists/${listId}/invitations`, body: { id: operation.id, ...operation.data } });
  }
  if (!transfer) for (const operation of operations.filter((candidate) => candidate.entity === "listMembers" && candidate.kind === "delete")) {
    const listId = findStateForEntity("listMembers", operation.id)?.metadata.id;
    if (!listId || !deletedListIds.has(listId)) requests.push({ listId, method: "DELETE", path: `/api/members/${operation.id}` });
  }
  return requests;
}

async function transact(input: any) {
  const operations = operationList(input);
  const listAssociations = collectListAssociations(operations);
  const classifierReset = classifierResetPlan(operations);
  if (classifierReset) {
    const resetDeletes = operations.filter((operation) => operation.entity === "todoClassifications" && operation.kind === "delete");
    if (resetDeletes.some((operation) => entityListId(operation, listAssociations) !== classifierReset.listId)) {
      throw new Error("Classifier reset contains data from another list");
    }
    const state = lists.get(classifierReset.listId);
    if (!state) throw new Error("List is not loaded");
    const resetAt = operations.find((operation) => operation.entity === "todoLists")?.data?.classifierResetAt;
    const nextDocument = applyContentOperations(state.document || emptyDocument(), resetDeletes);
    await writeLocalDocument(classifierReset.listId, nextDocument);
    state.document = nextDocument;
    applyOptimisticMetadata(operations, listAssociations);
    const queued = await enqueueRequest({ listId: classifierReset.listId, method: "POST", path: `/api/lists/${classifierReset.listId}/classifier/reset`, body: { resetAt } });
    await flushOutbox();
    if (queued.status === "rejected") throw new Error(queued.error);
    return;
  }
  const newList = operations.find((operation) => operation.entity === "todoLists" && operation.kind === "update" && !lists.has(operation.id));
  if (newList) {
    const ownerLink = operations.find((operation) => operation.entity === "todoLists" && operation.id === newList.id && operation.kind === "link");
    if (!ownerLink?.links?.owner) throw new Error("A new list requires an owner");
    const content = operations.filter((operation) => ["todos", "sublists", "todoClassifications"].includes(operation.entity));
    const document = applyContentOperations(emptyDocument(), content);
    const metadata = {
      id: newList.id,
      ...newList.data,
      owner: user,
      members: [], invitations: [], groupGrants: [], pins: [],
      access: { read: true, write: true, owner: true, member: false },
      _full: true, _localOnly: true,
    };
    lists.set(newList.id, { metadata, document, access: "write" });
    dashboardIds = [newList.id, ...dashboardIds.filter((id) => id !== newList.id)];
    await writeLocalDocument(newList.id, document);
    persistMetadataCaches(); dashboardLoaded = true; emit();
    const queued = await enqueueRequest({ listId: newList.id, method: "POST", path: "/api/lists", body: { id: newList.id, ...newList.data, document: bytesToBase64(Automerge.save(document)) } });
    await flushOutbox();
    if (queued.status === "rejected") throw new Error(queued.error);
    return;
  }
  const routedOperations = withoutRedundantListContentDeletes(operations);
  const contentByList = groupContentOperations(
    routedOperations,
    listAssociations,
    (operation: Operation) => entityListId(operation),
  ) as Map<string, Operation[]>;
  await runTransactionPhases([
    async () => {
      for (const [listId, content] of contentByList) {
        const state = lists.get(listId);
        if (!state) throw new Error("List is not loaded");
        const nextDocument = applyContentOperations(state.document || emptyDocument(), content);
        const nextBytes = Automerge.save(nextDocument);
        if (nextBytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("This list is too large to synchronize safely");
        await commitPersistedDocument({
          document: nextDocument,
          persist: (document: Automerge.Doc<ListDocument>) => writeLocalDocument(listId, document),
          commit: (document: Automerge.Doc<ListDocument>) => { state.document = document; },
          publish: state.socket?.readyState === WebSocket.OPEN && state.access === "write"
            ? () => state.socket!.send(nextBytes)
            : undefined,
          recoverPublish: () => state.socket?.close(1011, "Sync retry required"),
        });
      }
    },
  ]);
  const requests = authoritativeRequests(operations, listAssociations);
  applyOptimisticMetadata(operations, listAssociations);
  const queued = [];
  for (const request of requests) queued.push(await enqueueRequest(request));
  emit();
  await flushOutbox();
  const rejected = queued.find((command) => command.status === "rejected");
  if (rejected) throw new Error(rejected.error);
}

const tx = new Proxy({}, { get(_target, entity: EntityName) { return new Proxy({}, { get(_entityTarget, entityId: string) { return { update(data: Record<string, any>) { return new TransactionBuilder({ entity, id: entityId, kind: "update", data }); }, delete() { return new TransactionBuilder({ entity, id: entityId, kind: "delete" }); }, link(links: Record<string, string>) { return new TransactionBuilder({ entity, id: entityId, kind: "link", links }); }, unlink(links: Record<string, string>) { return new TransactionBuilder({ entity, id: entityId, kind: "unlink", links }); } }; } }); } }) as any;

export const db = {
  tx, transact, useQuery,
  room(type: string, id: string) { return { type, id }; },
  useAuth() { useSyncExternalStore(subscribe, snapshot, () => 0); return { isLoading: authLoading, user, error: authError }; },
  useSyncStatus() {
    useSyncExternalStore(subscribe, snapshot, () => 0);
    return { ...summarizeOutbox(outbox, outboxSyncing), errors: outbox.filter((command) => command.status === "rejected").map((command) => command.error || "Server rejected a queued change") };
  },
  async syncNow() { await resumeOutboxSync(); },
  async refreshAfterBackgroundSync() {
    if (!user) return;
    outbox = await readOutbox();
    outboxLoaded = true;
    emit();
    await Promise.allSettled([loadDashboard(true), loadInvitations(true)]);
  },
  async retryRejected() {
    for (const command of outbox.filter((candidate) => candidate.status === "rejected")) {
      command.status = "pending"; delete command.error; await putOutboxCommand(command);
    }
    emit(); await flushOutbox();
  },
  async discardRejected() {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const rejected = outbox.filter((candidate) => candidate.status === "rejected");
    for (const command of rejected) {
      if (command.method === "POST" && command.path === "/api/lists" && command.listId) {
        lists.get(command.listId)?.socket?.close(1000, "Local list discarded");
        lists.delete(command.listId);
        dashboardIds = dashboardIds.filter((id) => id !== command.listId);
        await deleteLocalDocument(command.listId);
      }
      await deleteOutboxCommand(command.id);
    }
    outbox = outbox.filter((candidate) => candidate.status !== "rejected");
    emit();
    await Promise.allSettled([loadDashboard(true), loadInvitations(true)]);
  },
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
      cacheMetadata("auth:last-user", null);
      invitations = [];
      invitationsLoaded = false;
      emit();
    },
  },
  sharing: {
    async search(listId: string, query: string) {
      const cached = cachedMetadata(directoryCacheKey(listId)) || { users: [], groups: [] };
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return { users: rankDirectoryEntries(cached.users || [], query), groups: rankDirectoryEntries(cached.groups || [], query) };
      }
      try { return await api(`/api/lists/${encodeURIComponent(listId)}/share-targets?q=${encodeURIComponent(query)}`); }
      catch (error) {
        if (!mayUseOfflineFallback(error)) throw error;
        return { users: rankDirectoryEntries(cached.users || [], query), groups: rankDirectoryEntries(cached.groups || [], query) };
      }
    },
    async addUser(listId: string, target: User | string) {
      const targetUser = typeof target === "string" ? { id: target } : target;
      const state = lists.get(listId); if (!state) throw new Error("List is not loaded");
      const memberId = crypto.randomUUID();
      state.metadata.members = [...(state.metadata.members || []), { id: memberId, role: "member", addedAt: new Date().toISOString(), user: targetUser, _localOnly: true }];
      persistMetadataCaches(); emit();
      const queued = await enqueueRequest({ listId, method: "POST", path: `/api/lists/${encodeURIComponent(listId)}/members`, body: { id: memberId, userId: targetUser.id } });
      await flushOutbox();
      if (queued.status === "rejected") throw new Error(queued.error);
    },
    async addGroup(listId: string, target: { id: string; name?: string } | string) {
      const group = typeof target === "string" ? { id: target } : target;
      const state = lists.get(listId); if (!state) throw new Error("List is not loaded");
      const grantId = crypto.randomUUID();
      state.metadata.groupGrants = [...(state.metadata.groupGrants || []), { id: grantId, role: "member", addedAt: new Date().toISOString(), group, _localOnly: true }];
      persistMetadataCaches(); emit();
      const queued = await enqueueRequest({ listId, method: "POST", path: `/api/lists/${encodeURIComponent(listId)}/groups`, body: { id: grantId, groupId: group.id } });
      await flushOutbox();
      if (queued.status === "rejected") throw new Error(queued.error);
    },
    async removeGroup(listId: string, grantId: string) {
      const state = lists.get(listId); if (!state) throw new Error("List is not loaded");
      state.metadata.groupGrants = (state.metadata.groupGrants || []).filter((grant: any) => grant.id !== grantId);
      persistMetadataCaches(); emit();
      const queued = await enqueueRequest({ listId, method: "DELETE", path: `/api/group-grants/${encodeURIComponent(grantId)}` });
      await flushOutbox();
      if (queued.status === "rejected") throw new Error(queued.error);
    },
  },
  rooms: { usePresence(_room?: any, _options?: any) { return { peers: {}, publishPresence: presenceNoop, user: user ? { name: userDisplayName(user), userId: user.id } : null }; } },
};

function presenceNoop(_presence?: any) {}
