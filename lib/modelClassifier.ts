// Sorting new items with the list's chat model (when the server has one and the list owner
// turned it on): the browser describes the categories as the evaluation does and asks the
// backend (POST /api/lists/:id/classify), which adds the owner's steering text and caches the
// answer. Any failure — offline, slow, not configured — returns null, and the local
// classifier decides as before.
import { categoryOptions, type EvalContext } from "./classifier-eval";
import { api } from "./db-api";
import { MODEL_CLASSIFIER_LIMITS, MODEL_CLASSIFIER_THRESHOLDS } from "../shared/model-classifier.mjs";

export interface ModelDecision {
  sublistId: string;
  confidence: number;
  /** Sure enough to sort the item without asking. */
  auto: boolean;
  /** Worth offering as a suggestion. */
  suggest: boolean;
}

/** The list fields the model needs (a materialized list from lib/db.ts has them). */
export interface ModelSortableList {
  id: string;
  todos: Array<{ text: string; done?: boolean; createdAt?: any; updatedAt?: any; sublist?: { id: string } | null }>;
  sublists: Array<{ id: string; name: string; group?: string | null; classifierKeywords?: string | null; order?: number }>;
  todoClassifications: Array<{ text: string; normalizedText?: string; source?: string; createdAt?: any; sublist?: { id: string } | null }>;
  autoSortTodos?: boolean;
  classifierModel?: boolean;
  classifierModelAvailable?: boolean;
  classifierResetAt?: any;
  classifierAggressiveness?: any;
}

const TIMEOUT_MS = 5000;
const time = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

export function modelSortingEnabled(todoList: ModelSortableList): boolean {
  return !!todoList.autoSortTodos && !!todoList.classifierModel && !!todoList.classifierModelAvailable
    && todoList.sublists.length >= 2 && todoList.sublists.length <= MODEL_CLASSIFIER_LIMITS.options;
}

/** The categories as options: own name, parent path, keywords, recent items (see categoryOptions). */
export function modelOptions(todoList: ModelSortableList, now = Date.now()) {
  const context: EvalContext = {
    at: now,
    categories: todoList.sublists.map((sublist) => ({
      id: sublist.id, name: sublist.name, group: sublist.group ?? null, classifierKeywords: sublist.classifierKeywords ?? null,
    })),
    aggressiveness: todoList.classifierAggressiveness || "normal",
    resetAt: time(todoList.classifierResetAt),
    doneTodos: todoList.todos.filter((todo) => todo.done).map((todo, index) => ({
      id: String(index), text: todo.text, done: true, categoryId: todo.sublist?.id ?? null,
      createdAt: todo.createdAt ?? null, updatedAt: todo.updatedAt ?? null,
    })),
    samples: todoList.todoClassifications.map((sample, index) => ({
      id: String(index), text: sample.text, normalizedText: sample.normalizedText ?? null,
      source: sample.source || "unknown", categoryId: sample.sublist?.id ?? null, createdAt: sample.createdAt ?? null,
    })),
    labels: [],
  };
  return categoryOptions(context).map(({ keywords, examples, parent, ...option }) => ({
    ...option,
    ...(parent ? { parent } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(examples.length ? { examples } : {}),
  }));
}

/** Asks the list's model where `text` goes; null when it can't help (the caller falls back). */
export async function classifyWithModel(todoList: ModelSortableList, text: string): Promise<ModelDecision | null> {
  if (!modelSortingEnabled(todoList)) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  const item = text.trim().slice(0, MODEL_CLASSIFIER_LIMITS.item);
  if (!item) return null;
  try {
    const result = await api(`/api/lists/${encodeURIComponent(todoList.id)}/classify`, {
      method: "POST",
      body: JSON.stringify({ item, options: modelOptions(todoList) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ranked = Object.entries((result?.probabilities ?? {}) as Record<string, number>)
      .filter(([sublistId, confidence]) => typeof confidence === "number" && todoList.sublists.some((sublist) => sublist.id === sublistId))
      .sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return null;
    const [sublistId, confidence] = ranked[0];
    const auto = confidence >= MODEL_CLASSIFIER_THRESHOLDS.auto;
    return { sublistId, confidence, auto, suggest: auto || confidence >= MODEL_CLASSIFIER_THRESHOLDS.suggest };
  } catch (error) {
    console.warn("Sorting with the model failed; using the local classifier", error);
    return null;
  }
}
