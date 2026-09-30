"use client";

import React, { useState, useEffect, useRef } from 'react';
import { id } from '../../lib/id';
import { db, type User } from '../../lib/db';
import { executeTransaction, canUserWrite, canUserView } from '../../lib/transactions';
import { parseListTags } from '../../lib/tags';
import { createClassificationTransaction, createTodoDeleteTransactions } from '../../lib/todoTransactions';
import { userDisplayName } from '../../shared/identity.mjs';
import { useSignOut } from './SignOutDialog';
import LoadingSpinner from './LoadingSpinner';
import ErrorDisplay from './ErrorDisplay';
import { useToast } from './Toast';
import { SyncStatusBadge } from './OfflineIndicator';
import type { Todo, TodoList } from './todo-list/types';
import { GlobalDragWrapper } from './todo-list/DragDrop';
import { DeleteCompletedModal } from './todo-list/ListModals';
import { OnlineUsersTooltip } from './todo-list/OnlineUsersTooltip';
import { SettingsPanel } from './todo-list/SettingsPanel';
import { ShareModal } from './todo-list/ShareModal';

interface TodoListViewProps {
  slug: string;
}

export default function TodoListView({ slug }: TodoListViewProps) {
  const [mounted, setMounted] = useState(false);
  
  const { isLoading: authLoading, user, error: authError } = db.useAuth();
  const { isLoading, error, data } = db.useQuery({ 
    todoLists: { 
      $: { where: { slug } },
      owner: {},
      todos: {
        sublist: {}
      },
      sublists: { todos: {} },
      members: { user: {} },
      pins: { user: {} },
      todoClassifications: { sublist: {} }
    } 
  });
  const { addToast } = useToast();

  // Helper functions that use toast notifications
  const toggleTodo = async (todo: Todo) => {
    const nextDone = !todo.done;
    const transactions: any[] = [
      db.tx.todos[todo.id].update({
        done: nextDone,
        updatedAt: new Date().toISOString()
      })
    ];

    if (nextDone && todo.sublist?.id) {
      transactions.push(createClassificationTransaction(todoList.id, todo.sublist.id, todo.text, "checked"));
    }

    const success = await executeTransaction(
      transactions,
      "Failed to update todo"
    );
    
    if (!success) {
      console.error("Failed to update todo");
      addToast("Failed to update todo. Please try again.", "error");
    }
    // No success toast - the visual feedback of the checkbox change is sufficient
  };

  const deleteTodo = async (todo: Todo) => {
    const success = await executeTransaction(
      createTodoDeleteTransactions(todoList.id, [todo]),
      "Failed to delete todo"
    );
    
    if (!success) {
      console.error("Failed to delete todo");
      addToast("Failed to delete todo. Please try again.", "error");
    } else {
      addToast("Todo deleted successfully", "success");
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent hydration mismatch
  if (!mounted || authLoading || isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return <ErrorDisplay message={error.message} />;
  }

  if (authError) {
    return <ErrorDisplay message={authError.message} />;
  }

  const todoList = data?.todoLists?.[0];
  
  if (!todoList) {
    return <ErrorDisplay message="Todo list not found" />;
  }

  // Check permissions using utility functions
  const isOwner = user && todoList.owner && user.id === todoList.owner.id;
  const isMember = !!(user && todoList.members?.some((member: any) => member.user?.id === user.id));
  const canRead = canUserView(user, todoList, todoList.permission);
  const canWrite = canUserWrite(user, todoList, todoList.permission);
  const currentUserPin = user ? todoList.pins?.find((pin: any) => pin.user?.id === user.id) : undefined;

  if (!canRead) {
    if (!user) {
      return <AuthRequired />;
    }
    return <ErrorDisplay message="You don't have permission to view this list" />;
  }

  return (
    <TodoListApp
      todoList={todoList}
      user={user ?? null}
      isOwner={!!isOwner}
      isMember={isMember}
      currentUserPinId={currentUserPin?.id}
      canWrite={!!canWrite}
      toggleTodo={toggleTodo}
      deleteTodo={deleteTodo}
      addToast={addToast}
    />
  );
}

function AuthRequired() {
  return (
    <div className="font-mono min-h-screen flex justify-center items-center bg-white dark:bg-gray-900">
      <div className="max-w-md w-full p-4">
        <h1 className="text-2xl mb-4 text-center text-gray-900 dark:text-white">Authentication Required</h1>
        <p className="mb-4 text-center text-gray-600 dark:text-gray-400">This todo list requires authentication to view.</p>
        <button
          onClick={() => db.auth.signIn()}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Sign in with OIDC
        </button>
      </div>
    </div>
  );
}

// Main TodoList App Component
function TodoListApp({ 
  todoList, 
  user, 
  isOwner, 
  isMember,
  currentUserPinId,
  canWrite,
  toggleTodo,
  deleteTodo,
  addToast
}: { 
  todoList: TodoList; 
  user: User | null; 
  isOwner: boolean; 
  isMember: boolean;
  currentUserPinId?: string;
  canWrite: boolean;
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { requestSignOut, dialog: signOutDialog } = useSignOut();
  const room = db.room("todoList", todoList.slug);
  const {
    user: myPresence,
    peers,
    publishPresence,
  } = db.rooms.usePresence(room, {
    initialData: { name: userDisplayName(user), userId: user?.id || undefined }
  });

  // Update presence when user data changes
  useEffect(() => {
    if (user) {
      publishPresence({ 
        name: userDisplayName(user),
        userId: user.id 
      });
    }
  }, [user, publishPresence]);
  
  const numUsers = 1 + Object.keys(peers).length;
  const [showDeleteCompletedConfirm, setShowDeleteCompletedConfirm] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCompletedUncategorized, setShowCompletedUncategorized] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState(todoList.name);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [pinning, setPinning] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const isPublicList = todoList.permission === 'public-read' || todoList.permission === 'public-write';
  const canPinList = !!user && isPublicList && !isOwner && !isMember;
  
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
  const todosWithoutSublist = todoList.todos.filter(todo => !todo.sublist);
  const visibleTodos = todoList.hideCompleted 
    ? todosWithoutSublist.filter(todo => !todo.done)
    : todosWithoutSublist;

  const completedUncategorizedTodos = todosWithoutSublist.filter(todo => todo.done);

  const sublists = [...todoList.sublists].sort((a, b) => a.order - b.order);

  const deleteCompleted = (completedTodos: Todo[]) => {
    if (completedTodos.length === 0) return;
    setShowDeleteCompletedConfirm(true);
  };

  const handleDeleteCompleted = () => {
    const completedTodos = todoList.todos.filter(todo => todo.done);
    
    db.transact(createTodoDeleteTransactions(todoList.id, completedTodos)).then(() => {
      addToast(`Successfully deleted ${completedTodos.length} completed todos`, "success");
      setShowDeleteCompletedConfirm(false);
    }).catch(err => {
      console.error("Failed to delete completed todos:", err);
      addToast("Failed to delete completed todos. Please try again.", "error");
      setShowDeleteCompletedConfirm(false);
    });
  };

  const startEditingTitle = () => {
    if (!isOwner) return;
    setEditingTitle(true);
    setEditTitle(todoList.name);
  };

  const saveTitleEdit = async () => {
    if (!editTitle.trim()) return;
    
    try {
      await db.transact(db.tx.todoLists[todoList.id].update({
        name: editTitle.trim(),
        updatedAt: new Date().toISOString()
      }));
      setEditingTitle(false);
      addToast("List name updated successfully", "success");
    } catch (err) {
      console.error("Failed to update list name:", err);
      addToast("Failed to update list name. Please try again.", "error");
    }
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

  const togglePin = async () => {
    if (!user || !canPinList || pinning) return;
    setPinning(true);

    try {
      if (currentUserPinId) {
        await db.transact(db.tx.pinnedLists[currentUserPinId].delete());
        addToast("List unpinned", "success");
      } else {
        await db.transact(
          db.tx.pinnedLists[id()]
            .update({ createdAt: new Date().toISOString() })
            .link({ user: user.id, list: todoList.id })
        );
        addToast("List pinned to your dashboard", "success");
      }
    } catch (err) {
      console.error("Failed to update pinned list:", err);
      addToast("Failed to update pinned list. Please try again.", "error");
    } finally {
      setPinning(false);
    }
  };

  return (
    <div className="font-mono min-h-screen p-4 md:p-8 bg-gray-50 dark:bg-slate-900">
      {signOutDialog}
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
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                />
              ) : (
                <h2 
                  className={`tracking-wide text-3xl md:text-4xl text-gray-800 dark:text-gray-200 font-light ${isOwner ? 'md:cursor-pointer md:hover:text-gray-600 md:dark:hover:text-gray-400 transition-colors' : ''}`}
                  onClick={() => {
                    // Only allow click-to-edit on desktop (medium screens and up)
                    if (isOwner && window.innerWidth >= 768) {
                      startEditingTitle();
                    }
                  }}
                  onDoubleClick={startEditingTitle}
                  title={isOwner ? "Click to edit list name (desktop) or use edit button" : undefined}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  {todoList.name}
                </h2>
              )}
              {isOwner && !editingTitle && (              <button
                onClick={startEditingTitle}
                className="text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 md:opacity-0 md:group-hover:opacity-100 transition-opacity p-1 touch-manipulation text-xs"
                title="Edit list name"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                edit
              </button>
              )}
            </div>
          </div>
          
          {/* Desktop: Show buttons directly, Mobile: Show hamburger menu */}
          <div className="relative">
            {/* Desktop buttons (hidden on mobile) */}
            <div className="hidden md:flex gap-2">
              {canPinList && (
                <button
                  onClick={togglePin}
                  disabled={pinning}
                  className="px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {currentUserPinId ? "Unpin" : "Pin"}
                </button>
              )}
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
                  onClick={requestSignOut}
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

              {/* Mobile menu dropdown */}
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
                  {canPinList && (
                    <button
                      onClick={() => {
                        togglePin();
                        setShowMobileMenu(false);
                      }}
                      disabled={pinning}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                    >
                      {currentUserPinId ? "Unpin" : "Pin"}
                    </button>
                  )}
                  {user && (
                    <button
                      onClick={() => {
                        requestSignOut();
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
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-400 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 w-full max-w-2xl">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <OnlineUsersTooltip currentUser={user} peers={peers} numUsers={numUsers} myPresence={myPresence}/>
              <span>Permission: {todoList.permission}</span>
              {todoList.archivedAt && <span className="text-amber-700 dark:text-amber-300">Archived</span>}
              {parseListTags(todoList.tags).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-xs text-gray-600 dark:text-gray-300"
                >
                  {tag}
                </span>
              ))}
              {currentUserPinId && <span>Pinned</span>}
            </div>
            <SyncStatusBadge listId={todoList.id} />
          </div>

          {todoList.archivedAt && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-4 py-3 rounded-lg w-full max-w-2xl text-sm">
              This list is archived. It is hidden from the default dashboard but remains accessible by URL.
            </div>
          )}

          {showSettings && isOwner && (
            <SettingsPanel todoList={todoList} user={user} onClose={() => setShowSettings(false)} addToast={addToast} />
          )}

          {showShareModal && (
            <ShareModal 
              todoList={todoList} 
              onClose={() => setShowShareModal(false)} 
              isOwner={isOwner}
              user={user}
              addToast={addToast}
            />
          )}

          {/* Delete Completed Confirmation Modal */}
          {showDeleteCompletedConfirm && (
            <DeleteCompletedModal
              todoList={todoList}
              onClose={() => setShowDeleteCompletedConfirm(false)}
              onConfirm={handleDeleteCompleted}
            />
          )}

          <GlobalDragWrapper 
            todoList={todoList}
            sublists={sublists}
            canWrite={canWrite}
            isOwner={isOwner}
            toggleTodo={toggleTodo}
            deleteTodo={deleteTodo}
            visibleTodos={visibleTodos}
            todosWithoutSublist={todosWithoutSublist}
            completedUncategorizedTodos={completedUncategorizedTodos}
            showCompletedUncategorized={showCompletedUncategorized}
            setShowCompletedUncategorized={setShowCompletedUncategorized}
            deleteCompleted={deleteCompleted}
          />
        </div>
      </div>
    </div>
  );
}

// Droppable Uncategorized Section Component
