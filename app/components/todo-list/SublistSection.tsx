"use client";

import React, { useState } from 'react';
import { id } from '../../../lib/id';
import { useDroppable } from '@dnd-kit/core';
import { db } from '../../../lib/db';
import { createCategoryToRestockTransactions, createTodoTransactions } from '../../../lib/todoTransactions';
import { groupNames, normalizeGroupName } from '../../../lib/categoryGroups';
import { useToast } from '../Toast';
import type { Todo, Sublist, TodoList } from './types';
import { TodoListComponent } from './TodoItems';

export function SublistSection({ 
  sublist, 
  todoList, 
  canWrite, 
  isOwner,
  toggleTodo,
  deleteTodo,
  collapsed,
  onToggleCollapsed,
  hideRestock
}: { 
  sublist: Sublist; 
  todoList: TodoList; 
  canWrite: boolean; 
  isOwner: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  hideRestock: boolean;
}) {
  const [showCompletedInSublist, setShowCompletedInSublist] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState(sublist.name);
  const [editGroup, setEditGroup] = useState(sublist.group || "");
  const [showRestockConfirm, setShowRestockConfirm] = useState(false);
  const { addToast } = useToast();
  
  // Droppable for the sublist header
  const { isOver, setNodeRef } = useDroppable({
    id: `sublist-${sublist.id}`,
  });
  
  const shownTodos = hideRestock ? sublist.todos.filter(todo => !todo.later) : sublist.todos;
  const visibleTodos = todoList.hideCompleted 
    ? shownTodos.filter(todo => !todo.done)
    : shownTodos;
  
  const completedTodos = shownTodos.filter(todo => todo.done);
  const completedCount = sublist.todos.filter(todo => todo.done).length;
  const totalCount = sublist.todos.length;

  const deleteSublist = () => {
    db.transact([
      ...sublist.todos.map(todo => db.tx.todos[todo.id].delete()),
      db.tx.sublists[sublist.id].delete()
    ]).catch(err => {
      console.error("Failed to delete sublist:", err);
      setShowError("Failed to delete sublist. Please try again.");
    });
  };

  const startEditingName = () => {
    if (!isOwner) return;
    setEditingName(true);
    setEditName(sublist.name);
    setEditGroup(sublist.group || "");
  };

  const saveNameEdit = async () => {
    if (!editName.trim()) return;
    
    try {
      await db.transact(db.tx.sublists[sublist.id].update({
        name: editName.trim(),
        group: normalizeGroupName(editGroup)
      }));
      setEditingName(false);
    } catch (err) {
      console.error("Failed to update sublist name:", err);
      setShowError("Failed to update category name. Please try again.");
    }
  };

  const cancelNameEdit = () => {
    setEditingName(false);
    setEditName(sublist.name);
    setEditGroup(sublist.group || "");
  };

  const convertToRestock = () => {
    const { transactions, sorted, unsorted } = createCategoryToRestockTransactions(todoList, sublist.id);
    db.transact(transactions).then(() => {
      addToast(
        `${sublist.name} is now the restock flag: ${sorted} item${sorted === 1 ? '' : 's'} sorted${unsorted ? `, ${unsorted} left to sort by hand` : ''}`,
        "success",
      );
    }).catch(err => {
      console.error("Failed to convert category:", err);
      setShowError("Failed to convert the category. Please try again.");
    });
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveNameEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelNameEdit();
    }
  };

  return (
    <div className="border-b border-gray-300 dark:border-gray-600">
      {showError && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-3 py-2 text-sm">
          {showError}
        </div>
      )}
      
      <div 
        ref={setNodeRef}
        className={`bg-gray-50 dark:bg-gray-700 px-3 py-2 flex items-center justify-between group transition-colors ${isOver ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600' : ''}`}
      >
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <CollapseToggle
            collapsed={collapsed}
            onToggle={onToggleCollapsed}
            label={sublist.name}
            controls={`sublist-content-${sublist.id}`}
          />
          {editingName ? (
            <form
              className="flex flex-wrap items-center gap-2 flex-1 min-w-0"
              onSubmit={(e) => { e.preventDefault(); saveNameEdit(); }}
            >
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleNameKeyDown}
                aria-label="Category name"
                className="text-sm font-medium bg-white dark:bg-gray-600 text-gray-900 dark:text-white border border-blue-300 dark:border-blue-600 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0 flex-1 basis-32"
                autoFocus
                style={{ WebkitTapHighlightColor: 'transparent' }}
              />
              <input
                type="text"
                value={editGroup}
                onChange={(e) => setEditGroup(e.target.value)}
                onKeyDown={handleNameKeyDown}
                aria-label="Group"
                placeholder="Group (optional)"
                list={`category-groups-${todoList.id}`}
                className="text-sm bg-white dark:bg-gray-600 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-500 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0 flex-1 basis-28"
              />
              <GroupSuggestions todoList={todoList} />
              <button type="submit" className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">Save</button>
              <button type="button" onClick={cancelNameEdit} className="px-2 py-1 text-xs rounded bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-200">Cancel</button>
              <button
                type="button"
                onClick={() => setShowRestockConfirm(true)}
                className="px-2 py-1 text-xs text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
                title="Turn this category into the restock flag"
              >
                Convert to restock…
              </button>
            </form>
          ) : (
            <span 
              className={`text-sm font-medium text-gray-900 dark:text-white ${isOwner ? 'md:cursor-pointer md:hover:bg-gray-100 md:dark:hover:bg-gray-600 rounded px-2 py-1 -mx-2 -my-1 transition-colors' : ''} min-h-[2rem] flex items-center`}
              onDoubleClick={startEditingName}
              onClick={() => {
                // Only allow click-to-edit on desktop (medium screens and up)
                if (isOwner && window.innerWidth >= 768) {
                  startEditingName();
                }
              }}
              title={isOwner ? "Click to edit category name (desktop) or use edit button" : undefined}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {sublist.name} ({totalCount - completedCount}/{totalCount})
              {canWrite && isOver && <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">(Drop here)</span>}
            </span>
          )}
          {isOwner && !editingName && (
            <button
              onClick={startEditingName}
              className="text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-1 touch-manipulation text-xs"
              title="Edit category name"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              edit
            </button>
          )}
        </div>
        {isOwner && !editingName && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs md:opacity-0 md:group-hover:opacity-100 transition-opacity px-2 py-1 touch-manipulation"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            Delete
          </button>
        )}
      </div>
      {!collapsed && (
        <div id={`sublist-content-${sublist.id}`}>
        {visibleTodos.length > 0 && (
          <TodoListComponent todos={visibleTodos} canWrite={canWrite} toggleTodo={toggleTodo} deleteTodo={deleteTodo} sublistId={sublist.id} />
        )}
        {todoList.hideCompleted && !showCompletedInSublist && completedTodos.length > 0 && (
          <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-600">
            <button
              onClick={() => setShowCompletedInSublist(true)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center space-x-1"
            >
              <span>▼</span>
              <span>Show {completedTodos.length} completed item{completedTodos.length !== 1 ? 's' : ''}</span>
            </button>
          </div>
        )}
        {todoList.hideCompleted && showCompletedInSublist && completedTodos.length > 0 && (
          <div>
            <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-600">
              <button
                onClick={() => setShowCompletedInSublist(false)}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center space-x-1"
              >
                <span>▲</span>
                <span>Hide completed items</span>
              </button>
            </div>
            <TodoListComponent todos={completedTodos} canWrite={canWrite} toggleTodo={toggleTodo} deleteTodo={deleteTodo} sublistId={sublist.id} />
          </div>
        )}
        {canWrite && <QuickAddTodo todoList={todoList} sublist={sublist} />}
        </div>
      )}
      
      {showRestockConfirm && (
        <div className="fixed inset-0 bg-slate-100 dark:bg-slate-900 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-md w-full relative shadow-xl">
            <h4 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Convert to restock</h4>
            <p className="text-gray-600 dark:text-gray-300 mb-3">
              Use this when &quot;<strong>{sublist.name}</strong>&quot; means &quot;not urgent&quot; rather than a place in the store.
            </p>
            <p className="text-gray-600 dark:text-gray-300 mb-6 text-sm">
              Its {sublist.todos.length} item{sublist.todos.length === 1 ? '' : 's'} get the restock flag and are sorted into the other categories where the classifier is sure; the rest stay uncategorized for you to sort. The category itself is removed.
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowRestockConfirm(false);
                  setEditingName(false);
                  convertToRestock();
                }}
                className="flex-1 bg-amber-600 text-white py-2 px-4 rounded hover:bg-amber-700"
              >
                Convert
              </button>
              <button
                onClick={() => setShowRestockConfirm(false)}
                className="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-100 dark:bg-slate-900 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-md w-full relative shadow-xl">
            <h4 className="text-lg font-bold mb-4 text-red-600 dark:text-red-400">Delete Category</h4>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Delete category "<strong>{sublist.name}</strong>" and all its todos?
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  deleteSublist();
                }}
                className="flex-1 bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Existing group names as suggestions for a group field (`list="category-groups-<list>"`). */
export function GroupSuggestions({ todoList }: { todoList: TodoList }) {
  return (
    <datalist id={`category-groups-${todoList.id}`}>
      {groupNames(todoList.sublists).map((name) => <option key={name} value={name} />)}
    </datalist>
  );
}

export function CollapseToggle({
  collapsed,
  onToggle,
  label,
  controls,
  kind = 'category'
}: {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  controls: string;
  kind?: 'category' | 'group';
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls={controls}
      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
      title={`${collapsed ? 'Expand' : 'Collapse'} ${kind}`}
      className="shrink-0 w-7 h-7 -ml-1 flex items-center justify-center rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-600 touch-manipulation"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
        className={`w-4 h-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
      >
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
      </svg>
    </button>
  );
}

export function AddSublistForm({ todoList }: { todoList: TodoList }) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const maxOrder = Math.max(0, ...todoList.sublists.map(s => s.order));
    db.transact(
      db.tx.sublists[id()]
        .update({
          name: name.trim(),
          ...(normalizeGroupName(group) ? { group: normalizeGroupName(group) } : {}),
          order: maxOrder + 1,
          createdAt: new Date().toISOString()
        })
        .link({ list: todoList.id })
    ).then(() => {
      setName("");
      setGroup("");
      setIsAdding(false);
      setError(null);
    }).catch(err => {
      console.error("Failed to create sublist:", err);
      setError("Failed to create category. Please try again.");
    });
  };

  if (!isAdding) {
    return (
      <div className="border-b border-gray-300 dark:border-gray-600 p-3">
        <button
          onClick={() => setIsAdding(true)}
          className="text-sm text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          + Add Category
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-300 dark:border-gray-600 p-3">
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-3 py-2 rounded text-sm mb-3">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          className="flex-1 basis-32 min-w-0 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          autoFocus
        />
        <input
          type="text"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="Group (optional)"
          aria-label="Group"
          list={`category-groups-${todoList.id}`}
          className="flex-1 basis-28 min-w-0 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
        />
        <GroupSuggestions todoList={todoList} />
        <button
          type="submit"
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setIsAdding(false)}
          className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400"
        >
          Cancel
        </button>
      </form>
    </div>
  );
}

export function QuickAddTodo({ todoList, sublist }: { todoList: TodoList; sublist?: Sublist }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const { transactions } = createTodoTransactions(
      todoList,
      trimmedText,
      sublist?.id,
      "quick-add",
    );
    // Cleared at once, not on success: see TodoForm.
    setText("");
    setError(null);

    db.transact(transactions).catch(err => {
      console.error("Failed to create todo:", err);
      setText((current) => current || trimmedText);
      setError("Failed to create todo. Please try again.");
    });
  };

  return (
    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-600">
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-2 py-1 rounded text-xs mb-2">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex space-x-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add item..."
          className="flex-1 px-2 py-1 text-sm outline-none bg-transparent text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
        />
        {text && (
          <button
            type="submit"
            className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm"
          >
            Add
          </button>
        )}
      </form>
    </div>
  );
}

export function ActionBar({ todoList, canWrite, deleteCompleted, hideRestock, setHideRestock }: { 
  todoList: TodoList; 
  canWrite: boolean;
  deleteCompleted: (completedTodos: Todo[]) => void;
  hideRestock: boolean;
  setHideRestock: (hide: boolean) => void;
}) {
  const remainingCount = todoList.todos.filter(todo => !todo.done).length;
  const completedTodos = todoList.todos.filter(todo => todo.done);
  const restockCount = todoList.todos.filter(todo => !todo.done && todo.later).length;

  return (
    <div className="flex justify-between items-center gap-2 min-h-10 px-2 py-1 text-xs border-t border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">
      <div className="flex items-center gap-3">
        <span>Remaining todos: {remainingCount}</span>
        {(restockCount > 0 || hideRestock) && (
          <button
            type="button"
            onClick={() => setHideRestock(!hideRestock)}
            aria-pressed={hideRestock}
            className="text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
            title="Restock items are not needed at the next opportunity"
          >
            {hideRestock ? `Show restock (${restockCount})` : `Hide restock (${restockCount})`}
          </button>
        )}
      </div>
      {canWrite && completedTodos.length > 0 && (
        <button
          className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300"
          onClick={() => deleteCompleted(completedTodos)}
        >
          Delete Completed ({completedTodos.length})
        </button>
      )}
    </div>
  );
}
