"use client";

import { getClassifierStatus, type ClassifierAggressiveness } from '../../../lib/classification';
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
