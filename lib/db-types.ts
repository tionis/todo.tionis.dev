import type * as Automerge from "@automerge/automerge/slim";

export interface User { id: string; email?: string | null; name?: string | null; username?: string | null; active?: boolean }
export type EntityName = "todoLists" | "todos" | "sublists" | "todoClassifications" | "listMembers" | "pinnedLists";
export type Operation = { entity: EntityName; id: string; kind: "update" | "delete" | "link" | "unlink"; data?: Record<string, any>; links?: Record<string, string> };
export interface ListDocument { [key: string]: unknown; schemaVersion: 1; todos: Record<string, any>; categories: Record<string, any>; classifierHistory: Record<string, any> }
export interface ListState { metadata: any; document?: Automerge.Doc<ListDocument>; socket?: WebSocket; access?: "read" | "write"; serverHeads?: string[] }
export interface QueuedRequest {
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

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
