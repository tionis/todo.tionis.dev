"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Group, ID, createInviteLink } from "jazz-tools";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  useDroppable
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAccount, useCoState } from '../../lib/jazz';
import { Account } from "jazz-tools";
import { TodoList, Todo, Sublist, ListOfTodos, ListOfSublists } from '../../lib/schema';
import { copyToClipboard } from "../../lib/utils";
import LoadingSpinner from './LoadingSpinner';
import ErrorDisplay from './ErrorDisplay';
import Modal from './Modal';
import { useToast } from './Toast';

interface TodoListViewProps {
  id: string;
}

export default function TodoListView({ id }: TodoListViewProps) {
  const [mounted, setMounted] = useState(false);
  const { me, logOut } = useAccount();

  // Load the todo list by ID
  const todoList = useCoState(TodoList, id as ID<TodoList>, {
    resolve: {
      todos: { $each: { sublist: true } },
      sublists: true,
    }
  });

  const { addToast } = useToast();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent hydration mismatch
  if (!mounted) {
    return <LoadingSpinner />;
  }

  // undefined = still loading, null = unavailable/not found
  if (todoList === undefined) {
    return <LoadingSpinner message="Loading list..." />;
  }

  if (todoList === null) {
    // Redirect to home after showing error briefly
    return (
      <div className="font-mono min-h-screen p-4 md:p-8 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-2xl mx-auto text-center py-12">
          <h2 className="text-xl text-gray-800 dark:text-gray-200 mb-4">
            Todo list not found or you don't have access
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            This list may have been deleted or you may not have permission to view it.
          </p>
          <button
            onClick={() => window.location.hash = ''}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  // Check permissions - Jazz Groups handle this automatically
  const canWrite = todoList._owner?.myRole() === "admin" || todoList._owner?.myRole() === "writer";
  const isOwner = todoList._owner?.myRole() === "admin";

  const toggleTodo = (todo: Todo) => {
    if (!canWrite) return;
    todo.done = !todo.done;
    todo.updatedAt = new Date().toISOString();
  };

  const deleteTodo = (todo: Todo) => {
    if (!canWrite) return;
    const index = todoList.todos?.findIndex(t => t?.id === todo.id);
    if (index !== undefined && index >= 0) {
      todoList.todos?.splice(index, 1);
      addToast("Todo deleted successfully", "success");
    }
  };

  return (
    <TodoListApp
      todoList={todoList}
      user={me}
      isOwner={isOwner}
      canWrite={canWrite}
      toggleTodo={toggleTodo}
      deleteTodo={deleteTodo}
      addToast={addToast}
      logOut={logOut}
    />
  );
}

// Member Indicator Component - Shows members who have access to the list
function MemberIndicator({ todoList }: { todoList: TodoList }) {
  const group = todoList._owner;
  const members = (group?.members || []).filter(
    (member) => member.id !== "everyone" && member.account?.profile
  );

  if (members.length <= 1) {
    return null; // Only the owner, no indicator needed
  }

  const displayMembers = members.slice(0, 3);
  const remainingCount = members.length - 3;

  return (
    <div className="hidden md:flex items-center" title={`${members.length} member${members.length !== 1 ? 's' : ''}`}>
      <div className="flex -space-x-2">
        {displayMembers.map((member, index) => (
          <div
            key={member.id}
            className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-xs font-medium text-white border-2 border-white dark:border-gray-900"
            style={{ zIndex: 3 - index }}
            title={member.account?.profile?.name || "Member"}
          >
            {(member.account?.profile?.name || "?")[0].toUpperCase()}
          </div>
        ))}
        {remainingCount > 0 && (
          <div
            className="w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center text-xs font-medium text-white border-2 border-white dark:border-gray-900"
            title={`${remainingCount} more member${remainingCount !== 1 ? 's' : ''}`}
          >
            +{remainingCount}
          </div>
        )}
      </div>
    </div>
  );
}

// Main TodoList App Component
function TodoListApp({
  todoList,
  user,
  isOwner,
  canWrite,
  toggleTodo,
  deleteTodo,
  addToast,
  logOut
}: {
  todoList: TodoList;
  user: Account | null;
  isOwner: boolean;
  canWrite: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  logOut: () => void;
}) {
  const [showDeleteCompletedConfirm, setShowDeleteCompletedConfirm] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCompletedUncategorized, setShowCompletedUncategorized] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(todoList.name);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setShowMobileMenu(false);
      }
    };

    if (showMobileMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMobileMenu]);

  // Sort todos by sublist and order
  const allTodos = todoList.todos || [];
  const todosWithoutSublist = allTodos.filter(todo => todo && !todo.sublist);
  const visibleTodos = todoList.hideCompleted
    ? todosWithoutSublist.filter(todo => todo && !todo.done)
    : todosWithoutSublist;

  const completedUncategorizedTodos = todosWithoutSublist.filter(todo => todo && todo.done);

  const sublists = [...(todoList.sublists || [])].filter(s => s).sort((a, b) => (a?.order || 0) - (b?.order || 0));

  const deleteCompleted = () => {
    const completedTodos = allTodos.filter(todo => todo && todo.done);
    if (completedTodos.length === 0) return;
    setShowDeleteCompletedConfirm(true);
  };

  const handleDeleteCompleted = () => {
    const completedTodos = allTodos.filter(todo => todo && todo.done);

    completedTodos.forEach(todo => {
      if (todo) {
        const index = todoList.todos?.findIndex(t => t?.id === todo.id);
        if (index !== undefined && index >= 0) {
          todoList.todos?.splice(index, 1);
        }
      }
    });

    addToast(`Successfully deleted ${completedTodos.length} completed todos`, "success");
    setShowDeleteCompletedConfirm(false);
  };

  const startEditingTitle = () => {
    if (!isOwner) return;
    setEditingTitle(true);
    setEditTitle(todoList.name);
  };

  const saveTitleEdit = () => {
    if (!editTitle.trim()) return;

    todoList.name = editTitle.trim();
    todoList.updatedAt = new Date().toISOString();
    setEditingTitle(false);
    addToast("List name updated successfully", "success");
  };

  const cancelTitleEdit = () => {
    setEditingTitle(false);
    setEditTitle(todoList.name);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitleEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTitleEdit();
    }
  };

  return (
    <div className="font-mono min-h-screen p-4 md:p-8 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => window.location.hash = ''}
              className="flex items-center space-x-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors border border-gray-300 dark:border-gray-600"
              title="Back to Lists"
            >
              <span>←</span>
              <span>Back</span>
            </button>
            <MemberIndicator todoList={todoList} />
            <div className="flex items-center space-x-2 group">
              {editingTitle ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={saveTitleEdit}
                  onKeyDown={handleTitleKeyDown}
                  className="tracking-wide text-3xl md:text-4xl font-light bg-transparent border-b-2 border-blue-500 focus:outline-none text-gray-800 dark:text-gray-200 min-w-0 max-w-full"
                  autoFocus
                />
              ) : (
                <h2
                  className={`tracking-wide text-3xl md:text-4xl text-gray-800 dark:text-gray-200 font-light ${isOwner ? 'md:cursor-pointer md:hover:text-gray-600 md:dark:hover:text-gray-400 transition-colors' : ''}`}
                  onClick={(e) => {
                    if (isOwner && window.innerWidth >= 768) {
                      startEditingTitle();
                    }
                  }}
                  onDoubleClick={startEditingTitle}
                  title={isOwner ? "Click to edit list name" : undefined}
                >
                  {todoList.name}
                </h2>
              )}
              {isOwner && !editingTitle && (
                <button
                  onClick={startEditingTitle}
                  className="text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-1 text-xs"
                  title="Edit list name"
                >
                  edit
                </button>
              )}
            </div>
          </div>

          {/* Desktop/Mobile menu */}
          <div className="relative">
            <div className="hidden md:flex gap-2">
              <button
                onClick={() => setShowShareModal(true)}
                className="px-3 py-2 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
              >
                Share
              </button>
              {isOwner && (
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="px-3 py-2 text-sm bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
                >
                  Settings
                </button>
              )}
              {user && (
                <button
                  onClick={() => logOut()}
                  className="px-3 py-2 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
                >
                  Sign Out
                </button>
              )}
            </div>

            {/* Mobile hamburger menu */}
            <div className="md:hidden" ref={mobileMenuRef}>
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="p-2 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                aria-label="Menu"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>

              {showMobileMenu && (
                <div className="absolute right-0 top-12 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg py-1 z-50 min-w-[120px]">
                  <button
                    onClick={() => {
                      setShowShareModal(true);
                      setShowMobileMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Share
                  </button>
                  {isOwner && (
                    <button
                      onClick={() => {
                        setShowSettings(!showSettings);
                        setShowMobileMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Settings
                    </button>
                  )}
                  {user && (
                    <button
                      onClick={() => {
                        logOut();
                        setShowMobileMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Sign Out
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center space-y-6">
          {showSettings && isOwner && (
            <SettingsPanel todoList={todoList} onClose={() => setShowSettings(false)} addToast={addToast} />
          )}

          {showShareModal && (
            <ShareModal
              todoList={todoList}
              onClose={() => setShowShareModal(false)}
              isOwner={isOwner}
              addToast={addToast}
            />
          )}

          {showDeleteCompletedConfirm && (
            <DeleteCompletedModal
              todoList={todoList}
              onClose={() => setShowDeleteCompletedConfirm(false)}
              onConfirm={handleDeleteCompleted}
            />
          )}

          <GlobalDragWrapper
            todoList={todoList}
            sublists={sublists as Sublist[]}
            canWrite={canWrite}
            isOwner={isOwner}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
            visibleTodos={visibleTodos as Todo[]}
            todosWithoutSublist={todosWithoutSublist as Todo[]}
            completedUncategorizedTodos={completedUncategorizedTodos as Todo[]}
            showCompletedUncategorized={showCompletedUncategorized}
            setShowCompletedUncategorized={setShowCompletedUncategorized}
            deleteCompleted={deleteCompleted}
          />
        </div>
      </div>
    </div>
  );
}

// Global Drag and Drop Wrapper Component
function GlobalDragWrapper({
  todoList,
  sublists,
  canWrite,
  isOwner,
  toggleTodo,
  deleteTodo,
  visibleTodos,
  todosWithoutSublist,
  completedUncategorizedTodos,
  showCompletedUncategorized,
  setShowCompletedUncategorized,
  deleteCompleted
}: {
  todoList: TodoList;
  sublists: Sublist[];
  canWrite: boolean;
  isOwner: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  visibleTodos: Todo[];
  todosWithoutSublist: Todo[];
  completedUncategorizedTodos: Todo[];
  showCompletedUncategorized: boolean;
  setShowCompletedUncategorized: (show: boolean) => void;
  deleteCompleted: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { addToast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id || !canWrite) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    // Find the active todo
    const activeTodo = todoList.todos?.find(t => t?.id === activeId);
    if (!activeTodo) return;

    try {
      // Check if we're dropping over a sublist header
      if (overId.startsWith('sublist-')) {
        const targetSublistId = overId.replace('sublist-', '');

        if (targetSublistId === 'uncategorized') {
          activeTodo.sublist = undefined;
        } else {
          const targetSublist = sublists.find(s => s.id === targetSublistId);
          if (targetSublist) {
            activeTodo.sublist = targetSublist;
          }
        }
        activeTodo.updatedAt = new Date().toISOString();
        return;
      }

      // Find the over todo for reordering
      const overTodo = todoList.todos?.find(t => t?.id === overId);
      if (!overTodo) return;

      const currentSublistId = activeTodo.sublist?.id;
      const targetSublistId = overTodo.sublist?.id;

      // If moving between different sublists
      if (currentSublistId !== targetSublistId) {
        if (targetSublistId) {
          const targetSublist = sublists.find(s => s.id === targetSublistId);
          if (targetSublist) {
            activeTodo.sublist = targetSublist;
          }
        } else {
          activeTodo.sublist = undefined;
        }
        activeTodo.updatedAt = new Date().toISOString();
        return;
      }

      // If reordering within the same sublist
      const todosInSameSublist = (todoList.todos || []).filter(t =>
        t && (t.sublist?.id || null) === (currentSublistId || null)
      ).sort((a, b) => ((a?.order || 0) - (b?.order || 0)));

      const oldIndex = todosInSameSublist.findIndex(t => t?.id === activeId);
      const newIndex = todosInSameSublist.findIndex(t => t?.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reorderedTodos = arrayMove(todosInSameSublist, oldIndex, newIndex);

        reorderedTodos.forEach((todo, index) => {
          if (todo) {
            todo.order = index + 1;
            todo.updatedAt = new Date().toISOString();
          }
        });
      }
    } catch (err) {
      console.error("Failed to move todo:", err);
      addToast("Failed to move todo. Please try again.", "error");
    }
  };

  const activeTodo = activeId ? todoList.todos?.find(todo => todo?.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="border border-gray-300 dark:border-gray-600 max-w-2xl w-full mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm">
        {canWrite && <TodoForm todoList={todoList} />}

        {/* Sublists */}
        {sublists.map(sublist => sublist && (
          <SublistSection
            key={sublist.id}
            sublist={sublist}
            todoList={todoList}
            canWrite={canWrite}
            isOwner={isOwner}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
          />
        ))}

        {/* Add new sublist button */}
        {canWrite && <AddSublistForm todoList={todoList} />}

        {/* Todos without sublist */}
        {(visibleTodos.length > 0 || (todosWithoutSublist.length > 0 && todoList.hideCompleted)) && (
          <DroppableUncategorizedSection
            visibleTodos={visibleTodos}
            todosWithoutSublist={todosWithoutSublist}
            completedUncategorizedTodos={completedUncategorizedTodos}
            showCompletedUncategorized={showCompletedUncategorized}
            setShowCompletedUncategorized={setShowCompletedUncategorized}
            canWrite={canWrite}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
            todoList={todoList}
          />
        )}

        <ActionBar todoList={todoList} canWrite={canWrite} deleteCompleted={deleteCompleted} />
      </div>

      <DragOverlay>
        {activeTodo ? (
          <div className="bg-white dark:bg-gray-800 shadow-lg rounded border p-2">
            <span className={`${activeTodo.done ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>
              {activeTodo.text}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// Droppable Uncategorized Section
function DroppableUncategorizedSection({
  visibleTodos,
  todosWithoutSublist,
  completedUncategorizedTodos,
  showCompletedUncategorized,
  setShowCompletedUncategorized,
  canWrite,
  toggleTodo,
  deleteTodo,
  todoList
}: {
  visibleTodos: Todo[];
  todosWithoutSublist: Todo[];
  completedUncategorizedTodos: Todo[];
  showCompletedUncategorized: boolean;
  setShowCompletedUncategorized: (show: boolean) => void;
  canWrite: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  todoList: TodoList;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: 'sublist-uncategorized',
  });

  return (
    <div>
      <div
        ref={setNodeRef}
        className={`bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm font-medium border-b border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white transition-colors ${isOver ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600' : ''}`}
      >
        Uncategorized ({todosWithoutSublist.filter(t => !t.done).length}/{todosWithoutSublist.length})
        {canWrite && isOver && <span className="text-xs text-blue-600 dark:text-blue-400 ml-2">(Drop here)</span>}
      </div>
      {visibleTodos.length > 0 && (
        <TodoListComponent todos={visibleTodos} canWrite={canWrite} toggleTodo={toggleTodo} deleteTodo={deleteTodo} />
      )}
      {todoList.hideCompleted && !showCompletedUncategorized && completedUncategorizedTodos.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-600">
          <button
            onClick={() => setShowCompletedUncategorized(true)}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center space-x-1"
          >
            <span>▼</span>
            <span>Show {completedUncategorizedTodos.length} completed</span>
          </button>
        </div>
      )}
      {todoList.hideCompleted && showCompletedUncategorized && completedUncategorizedTodos.length > 0 && (
        <div>
          <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-600">
            <button
              onClick={() => setShowCompletedUncategorized(false)}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center space-x-1"
            >
              <span>▲</span>
              <span>Hide completed</span>
            </button>
          </div>
          <TodoListComponent todos={completedUncategorizedTodos} canWrite={canWrite} toggleTodo={toggleTodo} deleteTodo={deleteTodo} />
        </div>
      )}
    </div>
  );
}

// Todo Form Component
function TodoForm({ todoList }: { todoList: TodoList }) {
  const [text, setText] = useState("");
  const { addToast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    try {
      const newTodo = Todo.create({
        text: text.trim(),
        done: false,
        order: (todoList.todos?.length || 0) + 1,
        createdAt: new Date().toISOString(),
      }, { owner: todoList._owner });

      todoList.todos?.push(newTodo);
      setText("");
    } catch (err) {
      console.error("Failed to create todo:", err);
      addToast("Failed to create todo. Please try again.", "error");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-3 border-b border-gray-300 dark:border-gray-600">
      <div className="flex space-x-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a new todo..."
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>
    </form>
  );
}

// Todo List Component
function TodoListComponent({
  todos,
  canWrite,
  toggleTodo,
  deleteTodo
}: {
  todos: Todo[];
  canWrite: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
}) {
  const sortedTodos = [...todos].sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <SortableContext items={sortedTodos.map(t => t.id)} strategy={verticalListSortingStrategy}>
      <div>
        {sortedTodos.map(todo => (
          <SortableTodoItem
            key={todo.id}
            todo={todo}
            canWrite={canWrite}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
          />
        ))}
      </div>
    </SortableContext>
  );
}

// Sortable Todo Item
function SortableTodoItem({
  todo,
  canWrite,
  toggleTodo,
  deleteTodo
}: {
  todo: Todo;
  canWrite: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id, disabled: !canWrite });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSaveEdit = () => {
    if (editText.trim() && editText.trim() !== todo.text) {
      todo.text = editText.trim();
      todo.updatedAt = new Date().toISOString();
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      setEditText(todo.text);
      setIsEditing(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center px-3 py-2 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
    >
      {canWrite && (
        <div {...attributes} {...listeners} className="cursor-grab mr-2 text-gray-400 hover:text-gray-600">
          ⋮
        </div>
      )}

      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => toggleTodo(todo)}
        disabled={!canWrite}
        className="mr-3 rounded"
      />

      {isEditing ? (
        <input
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleSaveEdit}
          onKeyDown={handleKeyDown}
          className="flex-1 px-2 py-1 border border-blue-500 rounded focus:outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          autoFocus
        />
      ) : (
        <span
          className={`flex-1 ${todo.done ? 'line-through text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}
          onDoubleClick={() => canWrite && setIsEditing(true)}
        >
          {todo.text}
        </span>
      )}

      {canWrite && (
        <button
          onClick={() => deleteTodo(todo)}
          className="ml-2 text-gray-400 hover:text-red-500 text-sm"
        >
          ×
        </button>
      )}
    </div>
  );
}

// Sublist Section
function SublistSection({
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
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(sublist.name);
  const { addToast } = useToast();

  const { isOver, setNodeRef } = useDroppable({
    id: `sublist-${sublist.id}`,
  });

  const todosInSublist = (todoList.todos || []).filter(t => t && t.sublist?.id === sublist.id);
  const visibleTodos = todoList.hideCompleted
    ? todosInSublist.filter(t => t && !t.done)
    : todosInSublist;

  const handleSaveName = () => {
    if (editName.trim() && editName.trim() !== sublist.name) {
      sublist.name = editName.trim();
    }
    setIsEditing(false);
  };

  const handleDeleteSublist = () => {
    // Move todos to uncategorized
    todosInSublist.forEach(todo => {
      if (todo) {
        todo.sublist = undefined;
      }
    });

    // Remove sublist
    const index = todoList.sublists?.findIndex(s => s?.id === sublist.id);
    if (index !== undefined && index >= 0) {
      todoList.sublists?.splice(index, 1);
    }

    addToast("Category deleted", "success");
  };

  return (
    <div>
      <div
        ref={setNodeRef}
        className={`bg-gray-100 dark:bg-gray-700 px-3 py-2 flex items-center justify-between border-b border-gray-300 dark:border-gray-600 ${isOver ? 'bg-blue-100 dark:bg-blue-900/30' : ''}`}
      >
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {isExpanded ? '▼' : '▶'}
          </button>

          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') {
                  setEditName(sublist.name);
                  setIsEditing(false);
                }
              }}
              className="px-2 py-1 border border-blue-500 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              autoFocus
            />
          ) : (
            <span
              className="font-medium text-gray-900 dark:text-white cursor-pointer"
              onDoubleClick={() => canWrite && setIsEditing(true)}
            >
              {sublist.name} ({todosInSublist.filter(t => t && !t.done).length}/{todosInSublist.length})
            </span>
          )}
        </div>

        {canWrite && (
          <button
            onClick={handleDeleteSublist}
            className="text-gray-400 hover:text-red-500 text-sm"
            title="Delete category"
          >
            ×
          </button>
        )}
      </div>

      {isExpanded && visibleTodos.length > 0 && (
        <TodoListComponent
          todos={visibleTodos as Todo[]}
          canWrite={canWrite}
          toggleTodo={toggleTodo}
          deleteTodo={deleteTodo}
        />
      )}
    </div>
  );
}

// Add Sublist Form
function AddSublistForm({ todoList }: { todoList: TodoList }) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const { addToast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const newSublist = Sublist.create({
        name: name.trim(),
        order: (todoList.sublists?.length || 0) + 1,
        createdAt: new Date().toISOString(),
      }, { owner: todoList._owner });

      todoList.sublists?.push(newSublist);
      setName("");
      setIsAdding(false);
    } catch (err) {
      console.error("Failed to create category:", err);
      addToast("Failed to create category. Please try again.", "error");
    }
  };

  if (!isAdding) {
    return (
      <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-600">
        <button
          onClick={() => setIsAdding(true)}
          className="text-sm text-blue-500 hover:text-blue-700"
        >
          + Add category
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="px-3 py-2 border-b border-gray-300 dark:border-gray-600">
      <div className="flex space-x-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          autoFocus
        />
        <button type="submit" className="px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
          Add
        </button>
        <button
          type="button"
          onClick={() => { setIsAdding(false); setName(""); }}
          className="px-2 py-1 text-sm bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// Action Bar
function ActionBar({
  todoList,
  canWrite,
  deleteCompleted
}: {
  todoList: TodoList;
  canWrite: boolean;
  deleteCompleted: () => void;
}) {
  const completedCount = todoList.todos?.filter(t => t && t.done).length || 0;
  const totalCount = todoList.todos?.length || 0;

  return (
    <div className="px-3 py-2 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
      <span>{totalCount - completedCount} remaining, {completedCount} completed</span>
      {canWrite && completedCount > 0 && (
        <button
          onClick={deleteCompleted}
          className="text-red-500 hover:text-red-700"
        >
          Delete completed
        </button>
      )}
    </div>
  );
}

// Settings Panel
function SettingsPanel({
  todoList,
  onClose,
  addToast
}: {
  todoList: TodoList;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [hideCompleted, setHideCompleted] = useState(todoList.hideCompleted);
  const [name, setName] = useState(todoList.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = () => {
    todoList.hideCompleted = hideCompleted;
    todoList.name = name;
    todoList.updatedAt = new Date().toISOString();
    addToast("Settings saved", "success");
    onClose();
  };

  const handleDelete = () => {
    // Jazz handles cascade deletion through the group
    window.location.hash = '';
    addToast("List deleted", "success");
  };

  return (
    <Modal onClose={onClose} title="List Settings" maxWidth="lg">
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
        <h4 className="text-sm font-medium text-red-600 dark:text-red-400 mb-3">Danger Zone</h4>

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
                Permanently delete this list and all its contents.
              </p>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-sm bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700"
              >
                Delete List Forever
              </button>
            </div>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <Modal onClose={() => setShowDeleteConfirm(false)} title="Delete List">
          <p className="text-gray-600 dark:text-gray-300 mb-6">
            Are you sure you want to delete "{todoList.name}"? This cannot be undone.
          </p>
          <div className="flex space-x-3">
            <button
              onClick={handleDelete}
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
    </Modal>
  );
}

// Share Modal
function ShareModal({
  todoList,
  onClose,
  isOwner,
  addToast
}: {
  todoList: TodoList;
  onClose: () => void;
  isOwner: boolean;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [writeInviteLink, setWriteInviteLink] = useState("");
  const [readInviteLink, setReadInviteLink] = useState("");
  const [writeCopied, setWriteCopied] = useState(false);
  const [readCopied, setReadCopied] = useState(false);
  const { me } = useAccount();

  const group = todoList._owner;

  // Get members excluding "everyone"
  const members = (group?.members || []).filter(
    (member) => member.id !== "everyone" && member.account?.profile
  );

  const generateWriteInviteLink = async () => {
    try {
      const baseURL = typeof window !== 'undefined' ? window.location.origin : '';
      const link = createInviteLink(todoList, "writer", baseURL, "todolist");
      setWriteInviteLink(link);
    } catch (err) {
      console.error("Failed to generate invite link:", err);
      addToast("Failed to generate invite link", "error");
    }
  };

  const generateReadInviteLink = async () => {
    try {
      const baseURL = typeof window !== 'undefined' ? window.location.origin : '';
      const link = createInviteLink(todoList, "reader", baseURL, "todolist");
      setReadInviteLink(link);
    } catch (err) {
      console.error("Failed to generate invite link:", err);
      addToast("Failed to generate invite link", "error");
    }
  };

  const handleCopyWriteLink = async () => {
    try {
      await copyToClipboard(writeInviteLink);
      setWriteCopied(true);
      setTimeout(() => setWriteCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy invite link");
    }
  };

  const handleCopyReadLink = async () => {
    try {
      await copyToClipboard(readInviteLink);
      setReadCopied(true);
      setTimeout(() => setReadCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy invite link");
    }
  };

  const removeMember = (memberId: string) => {
    if (!group || !isOwner) return;

    try {
      // Jazz groups allow removing members
      // Note: This may require the group to support member removal
      addToast("Member removal is not yet supported in Jazz", "info");
    } catch (err) {
      console.error("Failed to remove member:", err);
      addToast("Failed to remove member", "error");
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "admin": return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "writer": return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "reader": return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
      default: return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
    }
  };

  return (
    <Modal onClose={onClose} title={`Share "${todoList.name}"`} maxWidth="md">
      <div className="space-y-6 max-h-[70vh] overflow-y-auto">
        {/* Invite Links (owner only) */}
        {isOwner && (
          <div className="space-y-4">
            {/* Read-only invite */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Read-Only Access
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Generate a link that allows viewing but not editing
              </p>
              {readInviteLink ? (
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={readInviteLink}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                  />
                  <button
                    onClick={handleCopyReadLink}
                    className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                  >
                    {readCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={generateReadInviteLink}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                >
                  Generate Read-Only Link
                </button>
              )}
            </div>

            {/* Write access invite */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Write Access (Collaborator)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Generate a link that allows viewing and editing
              </p>
              {writeInviteLink ? (
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={writeInviteLink}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                  />
                  <button
                    onClick={handleCopyWriteLink}
                    className="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
                  >
                    {writeCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={generateWriteInviteLink}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
                >
                  Generate Write Access Link
                </button>
              )}
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-3">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <strong>Important:</strong> Invite links grant permanent access and cannot be revoked.
                Only share with people you trust.
              </p>
            </div>
          </div>
        )}

        {/* Members List */}
        {members.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              Members ({members.length})
            </label>
            <div className="border border-gray-200 dark:border-gray-600 rounded-lg divide-y divide-gray-200 dark:divide-gray-600">
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-gray-200 dark:bg-gray-600 rounded-full flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-300">
                      {(member.account?.profile?.name || "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {member.account?.profile?.name || "Unknown"}
                        {member.id === me?.id && <span className="text-gray-500 ml-1">(you)</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${getRoleBadgeColor(member.role)}`}>
                      {member.role}
                    </span>
                    {isOwner && member.id !== me?.id && member.role !== "admin" && (
                      <button
                        onClick={() => removeMember(member.id)}
                        className="text-gray-400 hover:text-red-500 text-sm"
                        title="Remove member"
                      >
                        ×
                      </button>
                    )}
                  </div>
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
    </Modal>
  );
}

// Delete Completed Modal
function DeleteCompletedModal({
  todoList,
  onClose,
  onConfirm
}: {
  todoList: TodoList;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const completedCount = todoList.todos?.filter(t => t && t.done).length || 0;

  return (
    <Modal onClose={onClose} title="Delete Completed Todos">
      <p className="text-gray-600 dark:text-gray-300 mb-6">
        Are you sure you want to delete {completedCount} completed todo{completedCount !== 1 ? 's' : ''}?
      </p>
      <div className="flex space-x-3">
        <button
          onClick={onConfirm}
          className="flex-1 bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700"
        >
          Delete
        </button>
        <button
          onClick={onClose}
          className="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
