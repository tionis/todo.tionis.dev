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

export function createTodoTransaction(listId: string, text: string, order: number, sublistId?: string, later = false) {
  let transaction = db.tx.todos[id()]
    .update({
      text,
      done: false,
      ...(later ? { later: true } : {}),
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
 * `order` places it explicitly, e.g. when adding several todos at once; `later` marks it as
 * restocking that isn't urgent.
 */
export function createTodoTransactions(
  todoList: ClassifiableList,
  text: string,
  explicitSublistId?: string,
  explicitSource = "explicit",
  order?: number,
  options: { later?: boolean } = {},
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

  const transactions: any[] = [createTodoTransaction(todoList.id, text, maxOrder + 1, sublistId, options.later)];
  if (sublistId && source !== "auto") {
    transactions.push(createClassificationTransaction(todoList.id, sublistId, text, source));
  }

  return { transactions, classification: shouldAutoSort ? classification : null, suggestedClassification };
}

export interface CategoryToRestockResult {
  transactions: any[];
  /** Items the classifier sorted into another category. */
  sorted: number;
  /** Items left without a category, to sort by hand. */
  unsorted: number;
}

/**
 * Turn a category that stood for "not urgent" (e.g. "Nachfüllen") into the restock flag: its
 * items get `later` and are sorted into the remaining categories where the classifier is sure
 * enough, the rest are left uncategorized; the category and its classifier samples go.
 */
export function createCategoryToRestockTransactions(
  todoList: ClassifiableList,
  sublistId: string,
): CategoryToRestockResult {
  const inCategory = (item: any) => item.sublist?.id === sublistId;
  const remainingSublists = todoList.sublists.filter((sublist) => sublist.id !== sublistId);
  const trainingTodos = todoList.todos.filter((todo) => !inCategory(todo));
  const trainingSamples = todoList.todoClassifications.filter((sample) => !inCategory(sample));
  const options = { aggressiveness: todoList.classifierAggressiveness, resetAt: todoList.classifierResetAt };
  const now = new Date().toISOString();
  const transactions: any[] = [];
  let sorted = 0;
  let unsorted = 0;

  for (const todo of todoList.todos.filter(inCategory)) {
    const classification = classifyTodoText(todo.text, remainingSublists, trainingTodos, trainingSamples, options);
    let transaction = db.tx.todos[todo.id].update({ later: true, updatedAt: now });
    if (classification && shouldAutoSortClassification(classification, options)) {
      transaction = transaction.link({ sublist: classification.sublistId });
      sorted += 1;
    } else {
      transaction = transaction.unlink({ sublist: sublistId });
      unsorted += 1;
    }
    transactions.push(transaction);
  }
  for (const sample of todoList.todoClassifications.filter(inCategory)) {
    transactions.push(db.tx.todoClassifications[sample.id].delete());
  }
  transactions.push(db.tx.sublists[sublistId].delete());
  return { transactions, sorted, unsorted };
}
