"use client";

import React, { useState } from 'react';
import { db } from '../../../lib/db';
import Modal from '../Modal';
import type { TodoList } from './types';

export function ResetClassifierDatasetModal({
  todoList,
  onClose,
  addToast,
}: {
  todoList: TodoList;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const requiredPhrase = "DELETE CLASSIFIER DATA";
  const [phrase, setPhrase] = useState("");
  const [listName, setListName] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const canReset = phrase === requiredPhrase && listName === todoList.name && !isResetting;

  const handleReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canReset) return;

    const resetAt = new Date().toISOString();
    const transactions = [
      ...todoList.todoClassifications.map((sample) => db.tx.todoClassifications[sample.id].delete()),
      db.tx.todoLists[todoList.id].update({
        classifierResetAt: resetAt,
        updatedAt: resetAt,
      }),
    ];

    setIsResetting(true);
    setResetError(null);

    try {
      await db.transact(transactions);
      addToast("Classifier dataset reset", "success");
      onClose();
    } catch (err) {
      console.error("Failed to reset classifier dataset:", err);
      setResetError("Failed to reset classifier dataset. Please try again.");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Reset Classifier Dataset" maxWidth="lg">
      <form onSubmit={handleReset} className="space-y-4">
        {resetError && (
          <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded text-sm">
            {resetError}
          </div>
        )}

        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
          <p className="text-sm text-red-800 dark:text-red-200 font-medium mb-2">
            This cannot be undone.
          </p>
          <ul className="text-sm text-red-700 dark:text-red-300 space-y-1">
            <li>Deletes {todoList.todoClassifications.length} stored classifier sample{todoList.todoClassifications.length !== 1 ? "s" : ""}</li>
            <li>Ignores completed todo examples from before this reset</li>
            <li>Keeps todos, categories, keyword hints, and classifier settings</li>
          </ul>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Type {requiredPhrase}
          </label>
          <input
            type="text"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-red-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Type the list name: {todoList.name}
          </label>
          <input
            type="text"
            value={listName}
            onChange={(event) => setListName(event.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-red-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        <div className="flex space-x-3">
          <button
            type="submit"
            disabled={!canReset}
            className="flex-1 bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResetting ? "Resetting..." : "Reset Dataset"}
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
