import {
  classifyTodoText,
  normalizeItemText,
  shouldAutoSortClassification,
  shouldSuggestClassification,
  type ClassificationResult,
} from "./classification";
import { db } from "./db";
import { id } from "./id";

interface TodoForDeletion {
  id: string;
  text: string;
  sublist?: { id: string } | null;
}

export function createClassificationTransaction(listId: string, sublistId: string, text: string, source: string) {
  return db.tx.todoClassifications[id()]
    .update({
      text,
      normalizedText: normalizeItemText(text),
      source,
      createdAt: new Date().toISOString(),
    })
    .link({ list: listId, sublist: sublistId });
}

export function createTodoTransaction(listId: string, text: string, order: number, sublistId?: string) {
  let transaction = db.tx.todos[id()]
    .update({
      text,
      done: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order,
    })
    .link({ list: listId });
  if (sublistId) transaction = transaction.link({ sublist: sublistId });
  return transaction;
}

export function createTodoDeleteTransactions(listId: string, todos: TodoForDeletion[]) {
  const archiveTransactions = todos.flatMap((todo) => todo.sublist?.id
    ? [createClassificationTransaction(listId, todo.sublist.id, todo.text, "deleted")]
    : []);
  return [...archiveTransactions, ...todos.map((todo) => db.tx.todos[todo.id].delete())];
}

export interface CreateTodoResult {
  transactions: any[];
  classification: ClassificationResult | null;
  suggestedClassification: ClassificationResult | null;
}

/** The list fields needed to classify and order a new todo. */
export interface ClassifiableList {
  id: string;
  todos: Array<{ text: string; order?: number; [key: string]: any }>;
  sublists: any[];
  todoClassifications: any[];
  autoSortTodos?: boolean;
  classifierAggressiveness?: any;
  classifierResetAt?: any;
}

/**
 * Create a todo, sorted into a category by the list's classifier when auto-sort is on.
 * `order` places it explicitly, e.g. when adding several todos at once.
 */
export function createTodoTransactions(
  todoList: ClassifiableList,
  text: string,
  explicitSublistId?: string,
  explicitSource = "explicit",
  order?: number,
): CreateTodoResult {
  const maxOrder = order !== undefined ? order - 1 : Math.max(0, ...todoList.todos.map((todo) => todo.order || 0));
  const classification = explicitSublistId || !todoList.autoSortTodos
    ? null
    : classifyTodoText(text, todoList.sublists, todoList.todos, todoList.todoClassifications, {
      aggressiveness: todoList.classifierAggressiveness,
      resetAt: todoList.classifierResetAt,
    });
  const shouldAutoSort = shouldAutoSortClassification(classification, {
    aggressiveness: todoList.classifierAggressiveness,
    resetAt: todoList.classifierResetAt,
  });
  const suggestedClassification = !explicitSublistId && classification && !shouldAutoSort && shouldSuggestClassification(classification, {
    aggressiveness: todoList.classifierAggressiveness,
    resetAt: todoList.classifierResetAt,
  })
    ? classification
    : null;
  const sublistId = explicitSublistId || (shouldAutoSort ? classification?.sublistId : undefined);
  const source = explicitSublistId ? explicitSource : "auto";

  const transactions: any[] = [createTodoTransaction(todoList.id, text, maxOrder + 1, sublistId)];
  if (sublistId && source !== "auto") {
    transactions.push(createClassificationTransaction(todoList.id, sublistId, text, source));
  }

  return { transactions, classification: shouldAutoSort ? classification : null, suggestedClassification };
}
