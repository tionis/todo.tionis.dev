"use client";

import React, { useState } from 'react';
import { db } from '../../../lib/db';
import { classifyTodoText, getClassificationCandidates, getClassifierStatus, normalizeItemText, parseClassifierKeywords, type ClassifierAggressiveness } from '../../../lib/classification';
import { createClassificationTransaction } from '../../../lib/todoTransactions';
import Modal from '../Modal';
import type { TodoList } from './types';

export function ClassifierSettingsRow({
  todoList,
  autoSortTodos,
  setAutoSortTodos,
  classifierAggressiveness,
  setClassifierAggressiveness,
  onOpenDetails,
}: {
  todoList: TodoList;
  autoSortTodos: boolean;
  setAutoSortTodos: (enabled: boolean) => void;
  classifierAggressiveness: ClassifierAggressiveness;
  setClassifierAggressiveness: (value: ClassifierAggressiveness) => void;
  onOpenDetails: () => void;
}) {
  const status = getClassifierStatus(todoList.sublists, todoList.todos, todoList.todoClassifications, {
    aggressiveness: classifierAggressiveness,
    resetAt: todoList.classifierResetAt,
  });

  return (
    <div className="border-t border-gray-200 dark:border-gray-600 pt-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white">Classifier</h4>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">
            {status.ready ? "Ready" : status.missingReason}
          </p>
        </div>
        <span className={`text-xs px-2 py-1 rounded shrink-0 ${status.ready ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
          {status.totalExamples}/{status.requiredExamples}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center space-x-2 min-w-0">
          <input
            type="checkbox"
            checked={autoSortTodos}
            onChange={(e) => setAutoSortTodos(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Auto-sort new uncategorized todos</span>
        </label>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="text-sm text-gray-700 dark:text-gray-300" htmlFor="classifier-aggressiveness">
          Aggressiveness
        </label>
        <select
          id="classifier-aggressiveness"
          value={classifierAggressiveness}
          onChange={(e) => setClassifierAggressiveness(e.target.value as ClassifierAggressiveness)}
          className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="conservative">Conservative</option>
          <option value="normal">Normal</option>
          <option value="aggressive">Aggressive</option>
        </select>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onOpenDetails}
          className="text-sm px-3 py-2 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 shrink-0"
        >
          Details
        </button>
      </div>
    </div>
  );
}

export function ClassifierDetailsModal({
  todoList,
  classifierAggressiveness,
  onClose,
  addToast,
}: {
  todoList: TodoList;
  classifierAggressiveness: ClassifierAggressiveness;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [testText, setTestText] = useState("");
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(todoList.sublists.map((sublist) => [sublist.id, sublist.classifierKeywords || ""]))
  );
  const [keywordStatus, setKeywordStatus] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const classifierOptions = { aggressiveness: classifierAggressiveness, resetAt: todoList.classifierResetAt };
  const status = getClassifierStatus(todoList.sublists, todoList.todos, todoList.todoClassifications, classifierOptions);
  const testResult = testText.trim()
    ? classifyTodoText(testText, todoList.sublists, todoList.todos, todoList.todoClassifications, classifierOptions)
    : null;
  const testCandidates = testText.trim()
    ? getClassificationCandidates(testText, todoList.sublists, todoList.todos, todoList.todoClassifications, classifierOptions)
    : [];
  const recentSamples = [...todoList.todoClassifications]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  const getSublistName = (sublistId?: string) => {
    if (!sublistId) return "No category";
    return todoList.sublists.find((sublist) => sublist.id === sublistId)?.name || "Deleted category";
  };

  const captureCompletedTodos = async () => {
    const existingKeys = new Set(
      todoList.todoClassifications
        .filter((sample) => sample.sublist?.id)
        .map((sample) => `${sample.normalizedText || normalizeItemText(sample.text)}:${sample.sublist!.id}:${sample.source}`)
    );
    const transactions = todoList.todos.flatMap((todo) => {
      if (!todo.done || !todo.sublist?.id) return [];
      const key = `${normalizeItemText(todo.text)}:${todo.sublist.id}:checked`;
      if (existingKeys.has(key)) return [];
      existingKeys.add(key);
      return [createClassificationTransaction(todoList.id, todo.sublist.id, todo.text, "checked")];
    });

    if (transactions.length === 0) {
      addToast("No new completed categorized todos to capture", "info");
      return;
    }

    try {
      await db.transact(transactions);
      setBackfillError(null);
      addToast(`Captured ${transactions.length} completed classifier example${transactions.length !== 1 ? 's' : ''}`, "success");
    } catch (err) {
      console.error("Failed to capture classifier examples:", err);
      setBackfillError("Failed to capture completed categorized todos.");
    }
  };

  const saveKeywordHints = async () => {
    const transactions = todoList.sublists.map((sublist) =>
      db.tx.sublists[sublist.id].update({
        classifierKeywords: parseClassifierKeywords(keywordDrafts[sublist.id]).join(", "),
      })
    );

    try {
      await db.transact(transactions);
      setKeywordStatus("Saved keyword hints.");
      addToast("Classifier keywords saved", "success");
    } catch (err) {
      console.error("Failed to save classifier keywords:", err);
      setKeywordStatus("Failed to save keyword hints.");
    }
  };

  return (
    <Modal onClose={onClose} title="Classifier Details" maxWidth="lg">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {status.ready ? "Ready to classify" : "Not enough training data"}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              {status.ready ? "New uncategorized todos can be sorted when auto-sort is enabled." : status.missingReason}
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded shrink-0 ${status.ready ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
            {status.totalExamples}/{status.requiredExamples}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
            <div className="text-gray-500 dark:text-gray-400">Examples</div>
            <div className="text-lg text-gray-900 dark:text-white">{status.totalExamples}</div>
          </div>
          <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
            <div className="text-gray-500 dark:text-gray-400">Categories</div>
            <div className="text-lg text-gray-900 dark:text-white">{status.categoryCount}/{status.requiredCategories}</div>
          </div>
          <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
            <div className="text-gray-500 dark:text-gray-400">Recorded</div>
            <div className="text-lg text-gray-900 dark:text-white">{todoList.todoClassifications.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
            <div className="text-gray-500 dark:text-gray-400">Completed</div>
            <div className="text-lg text-gray-900 dark:text-white">{status.completedExamples}</div>
          </div>
          <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
            <div className="text-gray-500 dark:text-gray-400">Fallback</div>
            <div className="text-lg text-gray-900 dark:text-white">{status.fallbackExamples}</div>
          </div>
          <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
            <div className="text-gray-500 dark:text-gray-400">Keywords</div>
            <div className="text-lg text-gray-900 dark:text-white">{status.keywordExamples}</div>
          </div>
          <div className="border border-gray-200 dark:border-gray-600 rounded p-3">
            <div className="text-gray-500 dark:text-gray-400">Evaluation</div>
            <div className="text-lg text-gray-900 dark:text-white">
              {status.evaluation.accuracy === null ? "n/a" : `${Math.round(status.evaluation.accuracy * 100)}%`}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Try item text</label>
          <input
            type="text"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="e.g. oat milk"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          />
          {testText.trim() && (
            <div className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
              <div>
                {testResult
                  ? `${getSublistName(testResult.sublistId)} (${Math.round(testResult.confidence * 100)}%, ${testResult.reason})`
                  : "No confident category"}
              </div>
              {testCandidates.length > 0 && (
                <div className="space-y-1">
                  {testCandidates.map((candidate) => (
                    <div key={`${candidate.sublistId}-${candidate.reason}`} className="flex justify-between gap-3">
                      <span className="truncate">{getSublistName(candidate.sublistId)}</span>
                      <span className="shrink-0">{Math.round(candidate.confidence * 100)}% · {candidate.reason}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Category keywords</div>
          <div className="space-y-2">
            {[...todoList.sublists]
              .sort((a, b) => a.order - b.order)
              .map((sublist) => (
                <label key={sublist.id} className="block">
                  <span className="block text-xs text-gray-600 dark:text-gray-400 mb-1">{sublist.name}</span>
                  <input
                    type="text"
                    value={keywordDrafts[sublist.id] || ""}
                    onChange={(e) => setKeywordDrafts((drafts) => ({ ...drafts, [sublist.id]: e.target.value }))}
                    placeholder="milk, yogurt, cheese"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                  />
                </label>
              ))}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={saveKeywordHints}
              className="text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 py-2 px-3 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Save Keywords
            </button>
            {keywordStatus && (
              <span className="text-xs text-gray-600 dark:text-gray-400">{keywordStatus}</span>
            )}
          </div>
        </div>

        {status.categoryCounts.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Examples by category</div>
            <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
              {status.categoryCounts.map((category) => (
                <div key={category.sublistId} className="flex justify-between gap-3 text-xs text-gray-600 dark:text-gray-400">
                  <span className="truncate">{getSublistName(category.sublistId)}</span>
                  <span className="shrink-0">{category.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {Object.keys(status.sourceCounts).length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Sources</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(status.sourceCounts).map(([source, count]) => (
                <span key={source} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                  {source}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={captureCompletedTodos}
              className="text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 py-2 px-3 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Capture Completed Todos
            </button>
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 py-2 px-3 rounded hover:bg-red-200 dark:hover:bg-red-900/50"
            >
              Reset Dataset
            </button>
          </div>
        </div>

        {backfillError && (
          <div className="text-xs text-red-600 dark:text-red-400">{backfillError}</div>
        )}

        {recentSamples.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Recent samples</div>
            <div className="max-h-48 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-600 border border-gray-200 dark:border-gray-600 rounded">
              {recentSamples.map((sample) => (
                <div key={sample.id} className="flex justify-between gap-3 px-3 py-2 text-xs">
                  <span className="text-gray-900 dark:text-white truncate">{sample.text}</span>
                  <span className="text-gray-500 dark:text-gray-400 shrink-0">{getSublistName(sample.sublist?.id)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end mt-6">
        <button
          onClick={onClose}
          className="bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
        >
          Close
        </button>
      </div>

      {showResetConfirm && (
        <ResetClassifierDatasetModal
          todoList={todoList}
          onClose={() => setShowResetConfirm(false)}
          addToast={addToast}
        />
      )}
    </Modal>
  );
}

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
