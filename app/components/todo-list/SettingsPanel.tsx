"use client";

import { useState } from 'react';
import { db, type User } from '../../../lib/db';
import { type ClassifierAggressiveness } from '../../../lib/classification';
import { downloadListExport } from '../../../lib/listExport';
import { formatListTags, parseListTags, tagInputToList } from '../../../lib/tags';
import Modal from '../Modal';
import type { TodoList } from './types';
import { ClassifierDetailsModal } from './ClassifierDetailsModal';
import { ClassifierSettingsRow } from './ClassifierSettingsRow';
import { ImportTemplateModal } from './ImportTemplateModal';
import { TransferOwnershipModal } from './ListModals';

export function SettingsPanel({
  todoList,
  user,
  onClose,
  addToast,
}: {
  todoList: TodoList;
  user: User | null;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [permission, setPermission] = useState(todoList.permission);
  const [hideCompleted, setHideCompleted] = useState(todoList.hideCompleted);
  const [autoSortTodos, setAutoSortTodos] = useState(!!todoList.autoSortTodos);
  const [classifierAggressiveness, setClassifierAggressiveness] = useState<ClassifierAggressiveness>(
    todoList.classifierAggressiveness === "conservative" || todoList.classifierAggressiveness === "aggressive"
      ? todoList.classifierAggressiveness
      : "normal"
  );
  const [name, setName] = useState(todoList.name);
  const [tagsInput, setTagsInput] = useState(formatListTags(parseListTags(todoList.tags)));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTransferOwnership, setShowTransferOwnership] = useState(false);
  const [showClassifierModal, setShowClassifierModal] = useState(false);
  const [showImportTemplate, setShowImportTemplate] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);

  const handleSave = () => {
    db.transact([
      db.tx.todoLists[todoList.id].update({
        permission,
        hideCompleted,
        autoSortTodos,
        classifierAggressiveness,
        name,
        tags: formatListTags(tagInputToList(tagsInput)),
        updatedAt: new Date().toISOString()
      })
    ]).then(() => {
      onClose();
    }).catch(err => {
      console.error("Failed to update list settings:", err);
      setShowError("Failed to update list settings. Please try again.");
    });
  };

  const handleDelete = () => {
    // Delete all related data
    const deleteTransactions = [
      // Delete all todos
      ...todoList.todos.map(todo => db.tx.todos[todo.id].delete()),
      // Delete all sublists
      ...todoList.sublists.map(sublist => db.tx.sublists[sublist.id].delete()),
      // Delete all members
      ...todoList.members.map(member => db.tx.listMembers[member.id].delete()),
      // Finally delete the list itself
      db.tx.todoLists[todoList.id].delete()
    ];

    db.transact(deleteTransactions).then(() => {
      // Navigate back to the dashboard after successful deletion
      window.location.hash = '';
    }).catch(err => {
      console.error("Failed to delete list:", err);
      setShowError("Failed to delete list. Please try again.");
    });
  };

  const handleArchiveToggle = async () => {
    const now = new Date().toISOString();

    try {
      await db.transact(
        db.tx.todoLists[todoList.id].update({
          archivedAt: todoList.archivedAt ? null : now,
          updatedAt: now,
        })
      );
      addToast(todoList.archivedAt ? "List restored" : "List archived", "success");
      onClose();
    } catch (err) {
      console.error("Failed to update archive state:", err);
      setShowError(todoList.archivedAt
        ? "Failed to restore list. Please try again."
        : "Failed to archive list. Please try again.");
    }
  };

  const handleExport = () => {
    try {
      downloadListExport(todoList);
      addToast("List export downloaded", "success");
    } catch (err) {
      console.error("Failed to export list:", err);
      setShowError("Failed to export this list. Please try again.");
    }
  };

  return (
    <Modal onClose={onClose} title="List Settings" maxWidth="lg">
      {showError && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-4">
          {showError}
        </div>
      )}
      
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">List Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Tags</label>
          <input
            type="text"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="groceries, travel, work"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Permissions</label>
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="public-write">Public Write - Anyone can edit</option>
            <option value="public-read">Public Read - Anyone can view</option>
            <option value="private-write">Private Write - Members can edit</option>
            <option value="private-read">Private Read - Members can view</option>
            <option value="owner">Owner Only - Only you can access</option>
          </select>
        </div>

        <div>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(e) => setHideCompleted(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Hide completed todos</span>
          </label>
        </div>

        <ClassifierSettingsRow
          todoList={todoList}
          autoSortTodos={autoSortTodos}
          setAutoSortTodos={setAutoSortTodos}
          classifierAggressiveness={classifierAggressiveness}
          setClassifierAggressiveness={setClassifierAggressiveness}
          onOpenDetails={() => setShowClassifierModal(true)}
        />
      </div>

      <div className="flex space-x-3 mt-6">
        <button
          onClick={handleSave}
          className="flex-1 bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
        >
          Save Changes
        </button>
        <button
          onClick={onClose}
          className="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
        >
          Cancel
        </button>
      </div>

      {/* Danger Zone */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-600">
        <h4 className="text-sm font-medium text-red-600 dark:text-red-400 mb-3">Advanced Actions</h4>

        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 mb-4">
          <div className="flex items-start space-x-3">
            <div className="flex-1">
              <h5 className="text-sm font-medium text-emerald-800 dark:text-emerald-300 mb-1">
                Export list data
              </h5>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-3">
                Download a portable JSON backup with this list&apos;s settings, categories, todos, and classifier history.
              </p>
              <button
                onClick={handleExport}
                className="text-sm bg-emerald-600 text-white py-2 px-4 rounded hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
              >
                Download Export
              </button>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-4">
          <div className="flex items-start space-x-3">
            <div className="flex-1">
              <h5 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
                {todoList.archivedAt ? "Restore this list" : "Archive this list"}
              </h5>
              <p className="text-xs text-gray-700 dark:text-gray-400 mb-3">
                {todoList.archivedAt
                  ? "Restore this list to the default dashboard view."
                  : "Hide this list from the default dashboard without deleting its todos, categories, members, or settings."}
              </p>
              <button
                onClick={handleArchiveToggle}
                className="text-sm bg-gray-700 text-white py-2 px-4 rounded hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
              >
                {todoList.archivedAt ? "Restore List" : "Archive List"}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
          <div className="flex items-start space-x-3">
            <div className="flex-1">
              <h5 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">
                Import from another list
              </h5>
              <p className="text-xs text-blue-700 dark:text-blue-400 mb-3">
                Add categories, todo items, or classifier samples from another list into this one.
              </p>
              <button
                onClick={() => setShowImportTemplate(true)}
                className="text-sm bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              >
                Import Content
              </button>
            </div>
          </div>
        </div>
        
        {/* Transfer Ownership */}
        {todoList.members.filter(member => member.user?.id && member.user?.active !== false).length > 0 && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <span className="text-yellow-500 text-lg">👑</span>
              </div>
              <div className="flex-1">
                <h5 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                  Transfer ownership
                </h5>
                <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-3">
                  Transfer ownership of this list to another member. You will become a regular member.
                </p>
                <button
                  onClick={() => setShowTransferOwnership(true)}
                  className="text-sm bg-yellow-600 text-white py-2 px-4 rounded hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 transition-colors"
                >
                  Transfer Ownership
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Delete List */}
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <span className="text-red-500 text-lg">⚠️</span>
            </div>
            <div className="flex-1">
              <h5 className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">
                Delete this list
              </h5>
              <p className="text-xs text-red-700 dark:text-red-400 mb-3">
                Permanently delete this list, all todos, categories, and member access. This action cannot be undone.
              </p>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-sm bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
              >
                Delete List Forever
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <Modal onClose={() => setShowDeleteConfirm(false)} title="Delete List">
          <div className="mb-6">
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Are you sure you want to delete "<strong>{todoList.name}</strong>"?
            </p>
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
              <p className="text-sm text-red-700 dark:text-red-300 mb-2">This will permanently delete:</p>
              <ul className="text-sm text-red-600 dark:text-red-400 space-y-1">
                <li>• The list and all its settings</li>
                <li>• All {todoList.todos.length} todos</li>
                <li>• All {todoList.sublists.length} categories</li>
                <li>• All member access</li>
              </ul>
              <p className="text-sm text-red-700 dark:text-red-300 mt-2 font-medium">
                This action cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => {
                setShowDeleteConfirm(false);
                handleDelete();
              }}
              className="flex-1 bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700"
            >
              Delete Forever
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Transfer Ownership Modal */}
      {showTransferOwnership && (        <TransferOwnershipModal 
          todoList={todoList}
          onClose={() => setShowTransferOwnership(false)}
          onSuccess={() => {
            setShowTransferOwnership(false);
            addToast("Ownership transferred successfully", "success");
            onClose(); // Close settings panel after successful transfer
          }}
        />
      )}

      {showClassifierModal && (
        <ClassifierDetailsModal
          todoList={todoList}
          classifierAggressiveness={classifierAggressiveness}
          onClose={() => setShowClassifierModal(false)}
          addToast={addToast}
        />
      )}

      {showImportTemplate && (
        <ImportTemplateModal
          targetList={todoList}
          user={user}
          onClose={() => setShowImportTemplate(false)}
          addToast={addToast}
        />
      )}
    </Modal>
  );
}
