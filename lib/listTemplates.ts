import { id } from "@instantdb/react";
import { db } from "./db";
import { normalizeItemText } from "./classification";
import { formatListTags } from "./tags";

export interface TemplateCopyOptions {
  categories: boolean;
  todos: boolean;
  classifier: boolean;
}

interface TemplateSublist {
  id: string;
  name: string;
  order?: number | null;
  classifierKeywords?: string | null;
}

interface TemplateTodo {
  id: string;
  text: string;
  done: boolean;
  order?: number | null;
  sublist?: { id: string } | null;
}

interface TemplateClassification {
  id: string;
  text: string;
  normalizedText?: string | null;
  source: string;
  createdAt?: string | Date | null;
  sublist?: { id: string } | null;
}

export interface TemplateList {
  id: string;
  name: string;
  hideCompleted?: boolean | null;
  autoSortTodos?: boolean | null;
  classifierAggressiveness?: string | null;
  tags?: string | null;
  sublists?: TemplateSublist[];
  todos?: TemplateTodo[];
  todoClassifications?: TemplateClassification[];
}

export interface CreateListFromTemplateInput {
  sourceList?: TemplateList | null;
  ownerId: string;
  listName: string;
  slug: string;
  tags: string[];
  options: TemplateCopyOptions;
}

export interface ImportTemplateInput {
  sourceList: TemplateList;
  targetListId: string;
  targetSublists: TemplateSublist[];
  options: TemplateCopyOptions;
}

function sortSublists(sublists: TemplateSublist[] = []) {
  return [...sublists].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function sortTodos(todos: TemplateTodo[] = []) {
  return [...todos].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function getSublistKey(name: string) {
  return name.trim().toLowerCase();
}

function createTemplateContentTransactions({
  sourceList,
  targetListId,
  targetSublists,
  options,
}: ImportTemplateInput) {
  const transactions: any[] = [];
  const sublistIdMap = new Map<string, string>();
  const targetSublistByName = new Map(
    targetSublists.map((sublist) => [getSublistKey(sublist.name), sublist.id])
  );
  const sourceSublists = sortSublists(sourceList.sublists || []);

  sourceSublists.forEach((sublist, index) => {
    const existingTargetId = targetSublistByName.get(getSublistKey(sublist.name));

    if (existingTargetId) {
      sublistIdMap.set(sublist.id, existingTargetId);
      return;
    }

    if (!options.categories) return;

    const newSublistId = id();
    sublistIdMap.set(sublist.id, newSublistId);
    targetSublistByName.set(getSublistKey(sublist.name), newSublistId);
    transactions.push(
      db.tx.sublists[newSublistId]
        .update({
          name: sublist.name,
          order: targetSublists.length + index + 1,
          classifierKeywords: sublist.classifierKeywords || "",
          createdAt: new Date().toISOString(),
        })
        .link({ list: targetListId })
    );
  });

  if (options.todos) {
    sortTodos(sourceList.todos || []).forEach((todo, index) => {
      const newTodoId = id();
      let todoTx = db.tx.todos[newTodoId]
        .update({
          text: todo.text,
          done: todo.done,
          order: index + 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .link({ list: targetListId });
      const targetSublistId = todo.sublist?.id ? sublistIdMap.get(todo.sublist.id) : undefined;

      if (targetSublistId) {
        todoTx = todoTx.link({ sublist: targetSublistId });
      }

      transactions.push(todoTx);
    });
  }

  if (options.classifier) {
    (sourceList.todoClassifications || []).forEach((sample) => {
      const targetSublistId = sample.sublist?.id ? sublistIdMap.get(sample.sublist.id) : undefined;
      if (!targetSublistId) return;

      transactions.push(
        db.tx.todoClassifications[id()]
          .update({
            text: sample.text,
            normalizedText: sample.normalizedText || normalizeItemText(sample.text),
            source: sample.source,
            createdAt: new Date().toISOString(),
          })
          .link({ list: targetListId, sublist: targetSublistId })
      );
    });
  }

  if (transactions.length > 0) {
    transactions.push(
      db.tx.todoLists[targetListId].update({
        updatedAt: new Date().toISOString(),
      })
    );
  }

  return transactions;
}

export function buildCreateListFromTemplateTransactions({
  sourceList,
  ownerId,
  listName,
  slug,
  tags,
  options,
}: CreateListFromTemplateInput) {
  const listId = id();
  const transactions: any[] = [
    db.tx.todoLists[listId]
      .update({
        name: listName,
        slug,
        permission: "private-write",
        hideCompleted: sourceList?.hideCompleted ?? false,
        autoSortTodos: options.classifier ? !!sourceList?.autoSortTodos : false,
        classifierAggressiveness: options.classifier ? sourceList?.classifierAggressiveness || "normal" : "normal",
        tags: formatListTags(tags),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .link({ owner: ownerId }),
  ];

  if (sourceList) {
    transactions.push(
      ...createTemplateContentTransactions({
        sourceList,
        targetListId: listId,
        targetSublists: [],
        options,
      })
    );
  }

  return { listId, transactions };
}

export function buildImportTemplateTransactions(input: ImportTemplateInput) {
  return createTemplateContentTransactions(input);
}
