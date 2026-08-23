const EXPORT_FORMAT = "smart-todos-list";
const EXPORT_VERSION = 1;

type ExportDate = string | number | Date | null;

interface ExportSublist {
  id: string;
  name: string;
  order?: number | null;
  classifierKeywords?: string | null;
  createdAt?: ExportDate;
}

interface ExportTodo {
  id: string;
  text: string;
  done: boolean;
  order?: number | null;
  createdAt?: ExportDate;
  updatedAt?: ExportDate;
  sublist?: { id: string } | null;
}

interface ExportClassification {
  id: string;
  text: string;
  normalizedText?: string | null;
  source: string;
  createdAt?: ExportDate;
  sublist?: { id: string } | null;
}

export interface ExportableTodoList {
  id: string;
  name: string;
  slug: string;
  permission: string;
  tags?: string | null;
  hideCompleted?: boolean | null;
  autoSortTodos?: boolean | null;
  classifierAggressiveness?: string | null;
  classifierResetAt?: ExportDate;
  archivedAt?: ExportDate;
  createdAt?: ExportDate;
  updatedAt?: ExportDate;
  sublists: ExportSublist[];
  todos: ExportTodo[];
  todoClassifications: ExportClassification[];
}

function serializeDate(value?: ExportDate): string | null {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function buildListExport(todoList: ExportableTodoList, exportedAt = new Date()) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    list: {
      id: todoList.id,
      name: todoList.name,
      slug: todoList.slug,
      permission: todoList.permission,
      tags: todoList.tags ?? null,
      hideCompleted: !!todoList.hideCompleted,
      autoSortTodos: !!todoList.autoSortTodos,
      classifierAggressiveness: todoList.classifierAggressiveness ?? "normal",
      classifierResetAt: serializeDate(todoList.classifierResetAt),
      archivedAt: serializeDate(todoList.archivedAt),
      createdAt: serializeDate(todoList.createdAt),
      updatedAt: serializeDate(todoList.updatedAt),
    },
    categories: [...todoList.sublists]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((sublist) => ({
        id: sublist.id,
        name: sublist.name,
        order: sublist.order ?? null,
        classifierKeywords: sublist.classifierKeywords ?? null,
        createdAt: serializeDate(sublist.createdAt),
      })),
    todos: [...todoList.todos]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((todo) => ({
        id: todo.id,
        text: todo.text,
        done: todo.done,
        order: todo.order ?? null,
        categoryId: todo.sublist?.id ?? null,
        createdAt: serializeDate(todo.createdAt),
        updatedAt: serializeDate(todo.updatedAt),
      })),
    classifierHistory: [...todoList.todoClassifications]
      .sort((a, b) => {
        const aTime = serializeDate(a.createdAt);
        const bTime = serializeDate(b.createdAt);
        return (aTime ?? "").localeCompare(bTime ?? "");
      })
      .map((sample) => ({
        id: sample.id,
        text: sample.text,
        normalizedText: sample.normalizedText ?? null,
        source: sample.source,
        categoryId: sample.sublist?.id ?? null,
        createdAt: serializeDate(sample.createdAt),
      })),
  };
}

function safeFilenamePart(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "list";
}

export function downloadListExport(todoList: ExportableTodoList): void {
  const payload = buildListExport(todoList);
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `smart-todos-${safeFilenamePart(todoList.name)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
