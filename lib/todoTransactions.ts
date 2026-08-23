import { normalizeItemText } from "./classification";
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
