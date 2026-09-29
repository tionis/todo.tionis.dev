"use client";

import React, { useState } from 'react';
import { id } from '../../../lib/id';
import { useDroppable } from '@dnd-kit/core';
import { db } from '../../../lib/db';
import { createTodoTransactions } from '../../../lib/todoTransactions';
import type { Todo, Sublist, TodoList } from './types';
import { TodoListComponent } from './TodoItems';

export function SublistSection({ 
  sublist, 
  todoList, 
  canWrite, 
  isOwner,
  toggleTodo,
  deleteTodo
}: { 
  sublist: Sublist; 
  todoList: TodoList; 
  canWrite: boolean; 
  isOwner: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
}) {
  const [showCompletedInSublist, setShowCompletedInSublist] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState(sublist.name);
  
  // Droppable for the sublist header
  const { isOver, setNodeRef } = useDroppable({
    id: `sublist-${sublist.id}`,
  });
  
  const visibleTodos = todoList.hideCompleted 
    ? sublist.todos.filter(todo => !todo.done)
    : sublist.todos;
  
  const completedTodos = sublist.todos.filter(todo => todo.done);
  const completedCount = completedTodos.length;
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
  };

  const saveNameEdit = async () => {
    if (!editName.trim()) return;
    
    try {
      await db.transact(db.tx.sublists[sublist.id].update({
        name: editName.trim()
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
        <div className="flex items-center space-x-2 flex-1">
          {editingName ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={saveNameEdit}
              onKeyDown={handleNameKeyDown}
              className="text-sm font-medium bg-white dark:bg-gray-600 text-gray-900 dark:text-white border border-blue-300 dark:border-blue-600 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0 flex-1"
              autoFocus
              style={{ WebkitTapHighlightColor: 'transparent' }}
            />
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

export function AddSublistForm({ todoList }: { todoList: TodoList }) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const maxOrder = Math.max(0, ...todoList.sublists.map(s => s.order));
    db.transact(
      db.tx.sublists[id()]
        .update({
          name: name.trim(),
          order: maxOrder + 1,
          createdAt: new Date().toISOString()
        })
        .link({ list: todoList.id })
    ).then(() => {
      setName("");
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
      <form onSubmit={handleSubmit} className="flex space-x-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          autoFocus
        />
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
    if (!text.trim()) return;

    const { transactions } = createTodoTransactions(
      todoList,
      text.trim(),
      sublist?.id,
      "quick-add",
    );

    db.transact(transactions).then(() => {
      setText("");
      setError(null);
    }).catch(err => {
      console.error("Failed to create todo:", err);
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

export function ActionBar({ todoList, canWrite, deleteCompleted }: { 
  todoList: TodoList; 
  canWrite: boolean;
  deleteCompleted: (completedTodos: Todo[]) => void;
}) {
  const remainingCount = todoList.todos.filter(todo => !todo.done).length;
  const completedTodos = todoList.todos.filter(todo => todo.done);

  return (
    <div className="flex justify-between items-center h-10 px-2 text-xs border-t border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">
      <div>Remaining todos: {remainingCount}</div>
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
