"use client";

import React, { useState } from 'react';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { db } from '../../../lib/db';
import { classifyTodoText, shouldAutoSortClassification } from '../../../lib/classification';
import { createTodoTransactions } from '../../../lib/todoTransactions';
import type { Todo, TodoList } from './types';

export function TodoForm({
  todoList,
  addToast,
}: {
  todoList: TodoList;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [selectedSublist, setSelectedSublist] = useState<string>("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const previewClassification = text.trim() && !selectedSublist && todoList.autoSortTodos
    ? classifyTodoText(text, todoList.sublists, todoList.todos, todoList.todoClassifications, {
      aggressiveness: todoList.classifierAggressiveness,
      resetAt: todoList.classifierResetAt,
    })
    : null;
  const previewSublist = previewClassification
    ? todoList.sublists.find((item) => item.id === previewClassification.sublistId)
    : null;
  const previewWillAutoSort = shouldAutoSortClassification(previewClassification, {
    aggressiveness: todoList.classifierAggressiveness,
    resetAt: todoList.classifierResetAt,
  });
  const canSubmit = text.trim().length > 0;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const { transactions, classification, suggestedClassification } = createTodoTransactions(
      todoList,
      trimmedText,
      selectedSublist || undefined,
      "explicit-create",
    );

    db.transact(transactions).then(() => {
      if (classification) {
        const sublist = todoList.sublists.find((item) => item.id === classification.sublistId);
        if (sublist) {
          addToast(`Auto-sorted to ${sublist.name}`, "info");
        }
      }
      if (suggestedClassification) {
        const sublist = todoList.sublists.find((item) => item.id === suggestedClassification.sublistId);
        if (sublist) {
          addToast(`Suggested category: ${sublist.name}`, "info");
        }
      }
      setText("");
      setError(null);
    }).catch(err => {
      console.error("Failed to create todo:", err);
      setError("Failed to create todo. Please try again.");
    });
  };

  return (
    <div className="border-b border-gray-300 dark:border-gray-600 p-3">
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-3 py-2 rounded text-sm mb-3">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-2">
        {/* Mobile: Stack vertically, Desktop: Horizontal layout */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 px-3 py-2 outline-none bg-transparent border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            autoFocus
            enterKeyHint="done"
            placeholder="What needs to be done?"
            type="text"
            name="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <select
            value={selectedSublist}
            onChange={(e) => setSelectedSublist(e.target.value)}
            className="px-2 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white sm:w-auto w-full"
          >
            <option value="">No category</option>
            {todoList.sublists.map(sublist => (
              <option key={sublist.id} value={sublist.id}>
                {sublist.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto w-full"
          >
            Add
          </button>
        </div>
        {previewSublist && (
          <div className="text-xs text-gray-600 dark:text-gray-400">
            {previewWillAutoSort ? "Will auto-sort" : "Suggested"}: {previewSublist.name}
            {" "}({Math.round(previewClassification!.confidence * 100)}%, {previewClassification!.reason})
          </div>
        )}
      </form>
    </div>
  );
}

// Draggable Todo Item Component
export function SortableTodoItem({ 
  todo, 
  canWrite, 
  editingTodo, 
  editText, 
  setEditingTodo: _setEditingTodo, 
  setEditText, 
  startEditing, 
  saveEdit, 
  handleKeyDown, 
  toggleTodo, 
  deleteTodo,
  isDragOverlay = false
}: {
  todo: Todo;
  canWrite: boolean;
  editingTodo: string | null;
  editText: string;
  setEditingTodo: (id: string | null) => void;
  setEditText: (text: string) => void;
  startEditing: (todo: Todo) => void;
  saveEdit: (todoId: string) => void;
  handleKeyDown: (e: React.KeyboardEvent, todoId: string) => void;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  isDragOverlay?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: todo.id,
    disabled: !canWrite || editingTodo === todo.id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      className={`flex items-center min-h-[2.5rem] group ${isDragOverlay ? 'bg-white dark:bg-gray-800 shadow-lg rounded border' : ''}`}
    >
      {/* Drag Handle */}
      {canWrite && editingTodo !== todo.id && (
        <div 
          {...attributes}
          {...listeners}
          className="h-full px-2 flex items-center justify-center cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 touch-manipulation"
          style={{ touchAction: 'none' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="4" cy="4" r="1.5"/>
            <circle cx="4" cy="8" r="1.5"/>
            <circle cx="4" cy="12" r="1.5"/>
            <circle cx="12" cy="4" r="1.5"/>
            <circle cx="12" cy="8" r="1.5"/>
            <circle cx="12" cy="12" r="1.5"/>
          </svg>
        </div>
      )}
      
      {/* Checkbox */}
      <div className="h-full px-2 flex items-center justify-center">
        <input
          type="checkbox"
          className="cursor-pointer w-4 h-4"
          checked={todo.done}
          onChange={() => canWrite && toggleTodo(todo)}
          disabled={!canWrite}
        />
      </div>
      
      {/* Todo Content */}
      <div className="flex-1 px-2 overflow-hidden flex items-center">
        {editingTodo === todo.id ? (
          <input
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={() => saveEdit(todo.id)}
            onKeyDown={(e) => handleKeyDown(e, todo.id)}
            className="w-full px-2 py-2 text-sm border border-blue-300 dark:border-blue-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            autoFocus
          />
        ) : (
          <span 
            className={`select-none ${todo.done ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'} ${canWrite ? 'md:cursor-pointer md:hover:bg-gray-50 md:dark:hover:bg-gray-700' : ''} rounded px-2 py-2 w-full min-h-[2rem] flex items-center transition-colors`}
            onDoubleClick={() => startEditing(todo)}
            onClick={() => {
              // Only allow click-to-edit on desktop (medium screens and up)
              if (window.innerWidth >= 768) {
                startEditing(todo);
              }
            }}
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            {todo.text}
          </span>
        )}
      </div>
      
      {/* Action Buttons */}
      {canWrite && editingTodo !== todo.id && (
        <div className="flex items-center">
          <button
            className="h-full px-3 py-2 flex items-center justify-center text-gray-300 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 md:opacity-0 md:group-hover:opacity-100 transition-opacity touch-manipulation text-xs"
            onClick={() => startEditing(todo)}
            title="Edit todo"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            edit
          </button>
          <button
            className="h-full px-3 py-2 flex items-center justify-center text-gray-300 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 md:opacity-0 md:group-hover:opacity-100 transition-opacity touch-manipulation"
            onClick={() => deleteTodo(todo)}
            title="Delete todo"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export function TodoListComponent({ todos, canWrite, toggleTodo, deleteTodo }: { 
  todos: Todo[]; 
  canWrite: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  sublistId?: string;
}) {
  const sortedTodos = [...todos].sort((a, b) => (a.order || 0) - (b.order || 0));
  const [editingTodo, setEditingTodo] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const startEditing = (todo: Todo) => {
    if (!canWrite) return;
    setEditingTodo(todo.id);
    setEditText(todo.text);
  };

  const saveEdit = async (todoId: string) => {
    if (!editText.trim()) return;
    
    try {
      await db.transact(db.tx.todos[todoId].update({
        text: editText.trim(),
        updatedAt: new Date().toISOString()
      }));
      setEditingTodo(null);
    } catch (err) {
      console.error("Failed to update todo:", err);
    }
  };

  const cancelEdit = () => {
    setEditingTodo(null);
    setEditText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent, todoId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(todoId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  return (
    <SortableContext items={sortedTodos.map(t => t.id)} strategy={verticalListSortingStrategy}>
      <div className="divide-y divide-gray-300 dark:divide-gray-600">
        {sortedTodos.map((todo) => (
          <SortableTodoItem
            key={todo.id}
            todo={todo}
            canWrite={canWrite}
            editingTodo={editingTodo}
            editText={editText}
            setEditingTodo={setEditingTodo}
            setEditText={setEditText}
            startEditing={startEditing}
            saveEdit={saveEdit}
            handleKeyDown={handleKeyDown}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
          />
        ))}
      </div>
    </SortableContext>
  );
}
