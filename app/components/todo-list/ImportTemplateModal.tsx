"use client";

import React, { useState } from 'react';
import { db, type User } from '../../../lib/db';
import { buildImportTemplateTransactions } from '../../../lib/listTemplates';
import Modal from '../Modal';
import type { TodoList } from './types';

export function ImportTemplateModal({
  targetList,
  user,
  onClose,
  addToast,
}: {
  targetList: TodoList;
  user: User | null;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [sourceListId, setSourceListId] = useState("");
  const [copyCategories, setCopyCategories] = useState(true);
  const [copyTodos, setCopyTodos] = useState(false);
  const [copyClassifier, setCopyClassifier] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const { isLoading: listsLoading, error: listsError, data: listsData } = db.useQuery(
    user ? {
      todoLists: {
        $: {
          where: {
            or: [
              { "owner.id": user.id },
              { "members.user.id": user.id },
            ],
          },
          order: { createdAt: "desc" },
        },
        owner: {},
        todos: { sublist: {} },
        sublists: {},
        members: { user: {} },
        todoClassifications: { sublist: {} },
      },
    } : null
  ) as unknown as { isLoading: boolean; error: Error | null; data: { todoLists: any[] } | null };
  const { isLoading: pinsLoading, error: pinsError, data: pinsData } = db.useQuery(
    user ? {
      pinnedLists: {
        $: {
          where: { "user.id": user.id },
          order: { createdAt: "desc" },
        },
        list: {
          owner: {},
          todos: { sublist: {} },
          sublists: {},
          members: { user: {} },
          todoClassifications: { sublist: {} },
        },
        user: {},
      },
    } : null
  ) as unknown as { isLoading: boolean; error: Error | null; data: { pinnedLists: any[] } | null };

  const ownAndMemberLists = listsData?.todoLists || [];
  const ownAndMemberListIds = new Set(ownAndMemberLists.map((list) => list.id));
  const pinnedLists = (pinsData?.pinnedLists || []).flatMap((pin) => {
    const list = Array.isArray(pin.list) ? pin.list[0] : pin.list;
    if (!list || ownAndMemberListIds.has(list.id)) return [];
    return [list];
  });
  const sourceLists = [...ownAndMemberLists, ...pinnedLists].filter((list) => list.id !== targetList.id);
  const selectedSourceList = sourceLists.find((list) => list.id === sourceListId);
  const isLoading = listsLoading || pinsLoading;
  const error = listsError || pinsError;
  const canImport = !!selectedSourceList && (copyCategories || copyTodos || copyClassifier) && !isImporting;

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSourceList) {
      setImportError("Choose a source list first.");
      return;
    }

    const transactions = buildImportTemplateTransactions({
      sourceList: selectedSourceList,
      targetListId: targetList.id,
      targetSublists: targetList.sublists,
      options: {
        categories: copyCategories,
        todos: copyTodos,
        classifier: copyClassifier,
      },
    });

    if (transactions.length === 0) {
      setImportError("There is no matching content to import with these options.");
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      await db.transact(transactions);
      addToast("Imported list content", "success");
      onClose();
    } catch (err) {
      console.error("Failed to import list content:", err);
      setImportError("Failed to import list content. Please try again.");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Import From List" maxWidth="lg">
      <form onSubmit={handleImport} className="space-y-4">
        {importError && (
          <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded text-sm">
            {importError}
          </div>
        )}

        {error && (
          <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded text-sm">
            {error.message}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Source List
          </label>
          <select
            value={sourceListId}
            onChange={(e) => setSourceListId(e.target.value)}
            disabled={isLoading || sourceLists.length === 0}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
          >
            <option value="">
              {isLoading ? "Loading lists..." : sourceLists.length === 0 ? "No other lists available" : "Choose a list"}
            </option>
            {sourceLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </div>

        {selectedSourceList && (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={copyCategories}
                onChange={(e) => {
                  setCopyCategories(e.target.checked);
                  if (!e.target.checked) setCopyClassifier(false);
                }}
                className="rounded"
              />
              Categories
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={copyTodos}
                onChange={(e) => setCopyTodos(e.target.checked)}
                className="rounded"
              />
              Todo items
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={copyClassifier}
                onChange={(e) => {
                  setCopyClassifier(e.target.checked);
                  if (e.target.checked) setCopyCategories(true);
                }}
                className="rounded"
              />
              Classifier
            </label>
          </div>
        )}

        <div className="flex space-x-3">
          <button
            type="submit"
            disabled={!canImport}
            className="flex-1 bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? "Importing..." : "Import"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
