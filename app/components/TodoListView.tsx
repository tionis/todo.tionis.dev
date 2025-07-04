"use client";

import React, { useState, useEffect, useRef } from 'react';
import { id, InstaQLEntity, User } from "@instantdb/react";
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
import { db } from '../../lib/db';
import { copyToClipboard, getListUrl } from "../../lib/utils";
import { executeTransaction, canUserWrite, canUserView, transferListOwnership } from "../../lib/transactions";
import LoadingSpinner from './LoadingSpinner';
import ErrorDisplay from './ErrorDisplay';
import Modal from './Modal';
import { useToast } from './Toast';
import type { AppSchema } from "../../lib/db";

type TodoList = InstaQLEntity<AppSchema, "todoLists", { 
  owner: {}; 
  todos: { sublist?: {} }; 
  sublists: { todos: {} }; 
  members: { user: {} };
  invitations: { inviter: {} }
}>;
type Todo = InstaQLEntity<AppSchema, "todos", { sublist?: {} }>;
type Sublist = InstaQLEntity<AppSchema, "sublists", { todos: {} }>;

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
      invitations: { inviter: {} }
    } 
  });
  const { addToast } = useToast();

  // Helper functions that use toast notifications
  const toggleTodo = async (todo: Todo) => {
    const success = await executeTransaction(
      db.tx.todos[todo.id].update({
        done: !todo.done,
        updatedAt: new Date().toISOString()
      }),
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
      db.tx.todos[todo.id].delete(),
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

  // Auto-accept invitations when user signs in
  const [autoAcceptStatus, setAutoAcceptStatus] = useState<{
    accepting: boolean;
    accepted: boolean;
    error: string | null;
  }>({ accepting: false, accepted: false, error: null });

  useEffect(() => {
    if (user && data?.todoLists?.[0]) {
      const todoList = data.todoLists[0];
      const userEmail = user.email.toLowerCase();
      
      // Find pending invitation for this user
      const pendingInvitation = todoList.invitations.find(inv => 
        inv.email.toLowerCase() === userEmail && inv.status === 'pending'
      );
      
      if (pendingInvitation && !autoAcceptStatus.accepting && !autoAcceptStatus.accepted) {
        setAutoAcceptStatus({ accepting: true, accepted: false, error: null });
        
        // Accept the invitation by creating a member record and updating invitation status
        db.transact([
          db.tx.listMembers[id()]
            .update({
              role: pendingInvitation.role,
              addedAt: new Date().toISOString()
            })
            .link({ 
              user: user.id,
              list: todoList.id 
            }),
          db.tx.invitations[pendingInvitation.id].update({
            status: 'accepted'
          })
        ]).then(() => {
          setAutoAcceptStatus({ accepting: false, accepted: true, error: null });
          // Auto-hide the success message after 5 seconds
          setTimeout(() => {
            setAutoAcceptStatus(prev => ({ ...prev, accepted: false }));
          }, 5000);
        }).catch(err => {
          console.error("Failed to accept invitation:", err);
          setAutoAcceptStatus({ 
            accepting: false, 
            accepted: false, 
            error: "Failed to automatically accept invitation. Please try refreshing the page." 
          });
        });
      }
    }
  }, [user, data?.todoLists]);

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
  const canRead = canUserView(user, todoList, todoList.permission);
  const canWrite = canUserWrite(user, todoList, todoList.permission);

  if (!canRead) {
    if (!user) {
      return <AuthRequired />;
    }
    return <ErrorDisplay message="You don't have permission to view this list" />;
  }

  return (
    <TodoListApp 
      todoList={todoList} 
      user={user} 
      isOwner={!!isOwner} 
      canWrite={!!canWrite}
      autoAcceptStatus={autoAcceptStatus}
      toggleTodo={toggleTodo}
      deleteTodo={deleteTodo}
      addToast={addToast}
    />
  );
}

function AuthRequired() {
  const [sentEmail, setSentEmail] = useState("");

  return (
    <div className="font-mono min-h-screen flex justify-center items-center bg-white dark:bg-gray-900">
      <div className="max-w-md w-full p-4">
        <h1 className="text-2xl mb-4 text-center text-gray-900 dark:text-white">Authentication Required</h1>
        <p className="mb-4 text-center text-gray-600 dark:text-gray-400">This todo list requires authentication to view.</p>
        {!sentEmail ? (
          <EmailStep onSendEmail={setSentEmail} />
        ) : (
          <CodeStep sentEmail={sentEmail} />
        )}
      </div>
    </div>
  );
}

function EmailStep({ onSendEmail }: { onSendEmail: (email: string) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = inputRef.current!.value;
    setIsLoading(true);
    setError(null);
    
    try {
      await db.auth.sendMagicCode({ email });
      onSendEmail(email);
    } catch (err: any) {
      setError("Error sending code: " + (err.body?.message || err.message));
      onSendEmail("");
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
          Email
        </label>
        <input
          ref={inputRef}
          id="email"
          type="email"
          required
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          placeholder="Enter your email"
        />
      </div>
      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {isLoading ? "Sending..." : "Send Magic Code"}
      </button>
    </form>
  );
}

function CodeStep({ sentEmail }: { sentEmail: string }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = inputRef.current!.value;
    setIsLoading(true);
    setError(null);
    
    try {
      await db.auth.signInWithMagicCode({ email: sentEmail, code });
    } catch (err: any) {
      setError("Error signing in: " + (err.body?.message || err.message));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}
      <div>
        <label htmlFor="code" className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
          Verification Code
        </label>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Enter the code sent to {sentEmail}
        </p>
        <input
          ref={inputRef}
          id="code"
          type="text"
          required
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          placeholder="Enter verification code"
        />
      </div>
      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {isLoading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}

// Main TodoList App Component
function TodoListApp({ 
  todoList, 
  user, 
  isOwner, 
  canWrite,
  autoAcceptStatus,
  toggleTodo,
  deleteTodo,
  addToast
}: { 
  todoList: TodoList; 
  user: User | null; 
  isOwner: boolean; 
  canWrite: boolean;
  autoAcceptStatus: {
    accepting: boolean;
    accepted: boolean;
    error: string | null;
  };
  toggleTodo: (todo: Todo) => void;
  deleteTodo: (todo: Todo) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const room = db.room("todoList", todoList.slug);
  const {
    user: myPresence,
    peers,
    publishPresence,
  } = db.rooms.usePresence(room, {
    initialData: { name: user?.email || "Anonymous User", userId: user?.id || undefined }
  });

  // Update presence when user data changes
  useEffect(() => {
    if (user?.email) {
      publishPresence({ 
        name: user.email, 
        userId: user.id 
      });
    }
  }, [user?.email, user?.id, publishPresence]);
  
  const numUsers = 1 + Object.keys(peers).length;
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
  const todosWithoutSublist = todoList.todos.filter(todo => !todo.sublist);
  const visibleTodos = todoList.hideCompleted 
    ? todosWithoutSublist.filter(todo => !todo.done)
    : todosWithoutSublist;

  const completedUncategorizedTodos = todosWithoutSublist.filter(todo => todo.done);

  const sublists = todoList.sublists.sort((a, b) => a.order - b.order);

  const deleteCompleted = (completedTodos: Todo[]) => {
    if (completedTodos.length === 0) return;
    setShowDeleteCompletedConfirm(true);
  };

  const handleDeleteCompleted = () => {
    const completedTodos = todoList.todos.filter(todo => todo.done);
    
    db.transact(completedTodos.map(todo => db.tx.todos[todo.id].delete())).then(() => {
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
                  onClick={(e) => {
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
                  onClick={() => db.auth.signOut()}
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
                  {user && (
                    <button
                      onClick={() => {
                        db.auth.signOut();
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
          {/* Auto-accept Status */}
          {autoAcceptStatus.accepting && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 px-4 py-3 rounded-lg w-full max-w-2xl">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span>Accepting invitation...</span>
              </div>
            </div>
          )}
          
          {autoAcceptStatus.accepted && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg w-full max-w-2xl">
              <div className="flex items-center space-x-2">
                <span>✓</span>
                <span>Welcome! You've been added to this list.</span>
              </div>
            </div>
          )}
          
          {autoAcceptStatus.error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg w-full max-w-2xl">
              <div className="flex items-center space-x-2">
                <span>⚠️</span>
                <span>{autoAcceptStatus.error}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 w-full max-w-2xl">
            <div className="flex items-center space-x-4">
              <OnlineUsersTooltip currentUser={user} peers={peers} numUsers={numUsers} myPresence={myPresence}/>
              <span>Permission: {todoList.permission}</span>
            </div>
          </div>

          {showSettings && isOwner && (
            <SettingsPanel todoList={todoList} onClose={() => setShowSettings(false)} addToast={addToast} />
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
        {canWrite && !isOver && <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">(Drop todos here)</span>}
      </div>
      {visibleTodos.length > 0 && (
        <TodoListComponent todos={visibleTodos} canWrite={canWrite} toggleTodo={toggleTodo} deleteTodo={deleteTodo} sublistId={undefined} />
      )}
      {todoList.hideCompleted && !showCompletedUncategorized && completedUncategorizedTodos.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-300 dark:border-gray-600">
          <button
            onClick={() => setShowCompletedUncategorized(true)}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center space-x-1"
          >
            <span>▼</span>
            <span>Show {completedUncategorizedTodos.length} completed item{completedUncategorizedTodos.length !== 1 ? 's' : ''}</span>
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
              <span>Hide completed items</span>
            </button>
          </div>
          <TodoListComponent todos={completedUncategorizedTodos} canWrite={canWrite} toggleTodo={toggleTodo} deleteTodo={deleteTodo} sublistId={undefined} />
        </div>
      )}
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
  deleteCompleted: (todos: Todo[]) => void;
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

  const handleDragOver = (event: DragOverEvent) => {
    // Handle drag over between different containers (sublists)
    const { active, over } = event;
    
    if (!over) return;
    
    const activeId = active.id as string;
    const overId = over.id as string;
    
    // Find the active todo
    const activeTodo = todoList.todos.find(t => t.id === activeId);
    if (!activeTodo) return;
    
    // Check if we're dropping over a sublist header or todo in a different sublist
    const overTodo = todoList.todos.find(t => t.id === overId);
    const currentSublistId = activeTodo.sublist?.id;
    const targetSublistId = overTodo?.sublist?.id;
    
    // If moving between different sublists, update immediately for visual feedback
    if (currentSublistId !== targetSublistId) {
      // This will be handled in handleDragEnd for the actual database update
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;
    
    // Find the active todo
    const activeTodo = todoList.todos.find(t => t.id === activeId);
    if (!activeTodo) return;
    
    try {
      // Check if we're dropping over a sublist header (drop zone)
      if (overId.startsWith('sublist-')) {
        const targetSublistId = overId.replace('sublist-', '');
        
        // Move todo to different sublist
        let updateTx = db.tx.todos[activeId].update({
          updatedAt: new Date().toISOString()
        });
        
        if (targetSublistId === 'uncategorized') {
          // Move to uncategorized (remove sublist link)
          updateTx = updateTx.unlink({ sublist: activeTodo.sublist?.id });
        } else {
          // Move to specific sublist
          updateTx = updateTx.link({ sublist: targetSublistId });
        }
        
        await db.transact(updateTx);
        return;
      }
      
      // Find the over todo
      const overTodo = todoList.todos.find(t => t.id === overId);
      if (!overTodo) return;
      
      const currentSublistId = activeTodo.sublist?.id;
      const targetSublistId = overTodo.sublist?.id;
      
      // If moving between different sublists
      if (currentSublistId !== targetSublistId) {
        let updateTx = db.tx.todos[activeId].update({
          updatedAt: new Date().toISOString()
        });
        
        if (targetSublistId) {
          updateTx = updateTx.link({ sublist: targetSublistId });
        } else {
          updateTx = updateTx.unlink({ sublist: currentSublistId });
        }
        
        await db.transact(updateTx);
        return;
      }
      
      // If reordering within the same sublist
      const todosInSameSublist = todoList.todos.filter(t => 
        (t.sublist?.id || null) === (currentSublistId || null)
      ).sort((a, b) => (a.order || 0) - (b.order || 0));
      
      const oldIndex = todosInSameSublist.findIndex(t => t.id === activeId);
      const newIndex = todosInSameSublist.findIndex(t => t.id === overId);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        const reorderedTodos = arrayMove(todosInSameSublist, oldIndex, newIndex);
        
        const updates = reorderedTodos.map((todo, index) => 
          db.tx.todos[todo.id].update({ 
            order: index + 1,
            updatedAt: new Date().toISOString()
          })
        );

        await db.transact(updates);
      }
    } catch (err) {
      console.error("Failed to move todo:", err);
      addToast("Failed to move todo. Please try again.", "error");
    }
  };

  const activeTodo = activeId ? todoList.todos.find(todo => todo.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="border border-gray-300 dark:border-gray-600 max-w-2xl w-full mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm">
        {canWrite && <TodoForm todoList={todoList} />}
        
        {/* Sublists */}
        {sublists.map(sublist => (
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

// Helper Components

function SettingsPanel({ todoList, onClose, addToast }: { todoList: TodoList; onClose: () => void; addToast: (message: string, type?: 'success' | 'error' | 'info') => void }) {
  const [permission, setPermission] = useState(todoList.permission);
  const [hideCompleted, setHideCompleted] = useState(todoList.hideCompleted);
  const [name, setName] = useState(todoList.name);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTransferOwnership, setShowTransferOwnership] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);

  const handleSave = () => {
    db.transact([
      db.tx.todoLists[todoList.id].update({
        permission,
        hideCompleted,
        name,
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
      // Delete all invitations
      ...todoList.invitations.map(invitation => db.tx.invitations[invitation.id].delete()),
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
        
        {/* Transfer Ownership */}
        {todoList.members.filter(member => member.user?.id && member.user?.email).length > 0 && (
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
    </Modal>
  );
}

function ShareModal({ 
  todoList, 
  onClose, 
  isOwner,
  user,
  addToast
}: { 
  todoList: TodoList; 
  onClose: () => void; 
  isOwner: boolean;
  user: User | null;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [copied, setCopied] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [showSuccess, setShowSuccess] = useState("");
  const [showError, setShowError] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  
  const listUrl = getListUrl(todoList.slug);

  const handleCopy = async () => {
    try {
      await copyToClipboard(listUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL");
      setShowError("Failed to copy URL");
    }
  };

  const sendInvitation = async () => {
    if (!newMemberEmail.trim()) return;
    
    setIsInviting(true);
    setShowError(null);
    try {
      const email = newMemberEmail.trim().toLowerCase();
      
      // Check if user is already a member
      const existingMember = todoList.members.find(member => 
        member.user?.email?.toLowerCase() === email
      );
      
      if (existingMember) {
        setShowError("This user is already a member of this list.");
        setIsInviting(false);
        return;
      }
      
      // Check if invitation already exists
      const existingInvitation = todoList.invitations.find(inv => 
        inv.email.toLowerCase() === email && inv.status === 'pending'
      );
      
      if (existingInvitation) {
        setShowError("An invitation has already been sent to this email.");
        setIsInviting(false);
        return;
      }
      
      // Create invitation
      await db.transact(
        db.tx.invitations[id()]
          .update({
            email,
            role: 'member',
            invitedAt: new Date().toISOString(),
            status: 'pending'
          })
          .link({ 
            list: todoList.id,
            inviter: todoList.owner?.id 
          })
      );
      
      setShowSuccess(`Invitation sent to ${email}! They can now access the list using this URL or check their invitations page.`);
      setNewMemberEmail("");
      
      // Auto-hide success message
      setTimeout(() => setShowSuccess(""), 5000);
      
    } catch (err) {
      console.error("Failed to send invitation:", err);
      setShowError("Failed to send invitation. Please try again.");
    } finally {
      setIsInviting(false);
    }
  };

  const revokeInvitation = async (invitationId: string) => {
    try {
      await db.transact(db.tx.invitations[invitationId].delete());
    } catch (err) {
      console.error("Failed to revoke invitation:", err);
      setShowError("Failed to revoke invitation. Please try again.");
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      await db.transact(db.tx.listMembers[memberId].delete());
    } catch (err) {
      console.error("Failed to remove member:", err);
      setShowError("Failed to remove member. Please try again.");
    }
  };

  const leaveList = async () => {
    if (!user) return;
    
    try {
      // Find the current user's membership
      const currentUserMembership = todoList.members.find(member => 
        member.user?.id === user.id
      );
      
      if (currentUserMembership) {
        await db.transact(db.tx.listMembers[currentUserMembership.id].delete());
        addToast("Successfully left the list", "success");
        setShowLeaveConfirm(false);
        onClose();
        // Navigate back to home or show a message that they've left
        window.location.hash = '';
      } else {
        setShowError("You are not a member of this list.");
      }
    } catch (err) {
      console.error("Failed to leave list:", err);
      setShowError("Failed to leave list. Please try again.");
      setShowLeaveConfirm(false);
    }
  };

  const pendingInvitations = todoList.invitations.filter(inv => inv.status === 'pending');
  
  // Check if current user is a member (not owner) of this list
  const currentUserMembership = user ? todoList.members.find(member => 
    member.user?.id === user.id
  ) : null;
  const isCurrentUserMember = currentUserMembership && !isOwner;

  return (
    <Modal onClose={onClose} title={`Share "${todoList.name}"`} maxWidth="md">
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        {/* Success Message */}
        {showSuccess && (
          <div className="bg-green-100 dark:bg-green-900 border border-green-400 dark:border-green-600 text-green-700 dark:text-green-200 px-4 py-3 rounded">
            {showSuccess}
          </div>
        )}

        {/* Error Message */}
        {showError && (
          <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded">
            {showError}
          </div>
        )}

        {/* Share URL */}
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Share URL</label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={listUrl}
              readOnly
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Anyone with this URL can access the list based on its permission settings
          </p>
        </div>

        {isOwner && (
          <>
            {/* Send Invitation */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Invite New Member</label>
              <div className="space-y-2">
                <div className="flex space-x-2">
                  <input
                    type="email"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="Enter email address"
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                    disabled={isInviting}
                  />
                  <button
                    onClick={sendInvitation}
                    disabled={isInviting || !newMemberEmail.trim()}
                    className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isInviting ? "Sending..." : "Invite"}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Sends an invitation and grants access to this list
                </p>
              </div>
            </div>

            {/* Pending Invitations */}
            {pendingInvitations.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Pending Invitations</label>
                <div className="space-y-2 max-h-24 overflow-y-auto">
                  {pendingInvitations.map(invitation => (
                    <div key={invitation.id} className="flex items-center justify-between py-1">
                      <span className="text-sm text-gray-900 dark:text-white">{invitation.email}</span>
                      <button
                        onClick={() => revokeInvitation(invitation.id)}
                        className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Current Members */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Current Members</label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {todoList.members.map(member => (
                  <div key={member.id} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-900 dark:text-white">{member.user?.email || 'Unknown User'}</span>
                    <button
                      onClick={() => removeMember(member.id)}
                      className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {todoList.members.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No members added</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Permission Info */}
        <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            <strong className="text-gray-900 dark:text-white">Current Permission:</strong> {todoList.permission}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {todoList.permission === 'public-write' && "Anyone with the URL can view and edit"}
            {todoList.permission === 'public-read' && "Anyone with the URL can view, but only members can edit"}
            {todoList.permission === 'private-write' && "Only invited members can view and edit"}
            {todoList.permission === 'private-read' && "Only invited members can view and edit"}
            {todoList.permission === 'owner' && "Only you can access this list"}
          </p>
        </div>

        {/* Leave List Section - Only show for members who are not owners */}
        {isCurrentUserMember && (
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-orange-600 dark:text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-orange-800 dark:text-orange-200 mb-2">Leave List</h4>
                <p className="text-sm text-orange-700 dark:text-orange-300 mb-3">
                  You can leave this list at any time. You'll lose access unless the owner invites you back.
                </p>
                <button
                  onClick={() => setShowLeaveConfirm(true)}
                  className="text-sm bg-orange-600 text-white py-2 px-4 rounded hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-colors"
                >
                  Leave List
                </button>
              </div>
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

      {/* Leave List Confirmation Modal */}
      {showLeaveConfirm && (
        <Modal onClose={() => setShowLeaveConfirm(false)} title="Leave List">
          <div className="mb-6">
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Are you sure you want to leave "<strong>{todoList.name}</strong>"?
            </p>
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded p-3">
              <p className="text-sm text-orange-700 dark:text-orange-300 mb-2">After leaving:</p>
              <ul className="text-sm text-orange-600 dark:text-orange-400 space-y-1">
                <li>• You will lose access to this list</li>
                <li>• You won't be able to view or edit todos</li>
                <li>• The owner will need to invite you again to regain access</li>
              </ul>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-2 font-medium">
                You can always be re-invited later.
              </p>
            </div>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={leaveList}
              className="flex-1 bg-orange-600 text-white py-2 px-4 rounded hover:bg-orange-700"
            >
              Leave List
            </button>
            <button
              onClick={() => setShowLeaveConfirm(false)}
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

function DeleteCompletedModal({
  todoList,
  onClose,
  onConfirm
}: {
  todoList: TodoList;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const completedTodos = todoList.todos.filter(todo => todo.done);

  return (
    <Modal onClose={onClose} title="Delete Completed Todos">
      <div className="mb-6">
        <p className="text-gray-600 dark:text-gray-300 mb-4">
          Are you sure you want to delete all completed todos?
        </p>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded p-3">
          <p className="text-sm text-orange-700 dark:text-orange-300 mb-2">This will permanently delete:</p>
          <ul className="text-sm text-orange-600 dark:text-orange-400 space-y-1">
            <li>• {completedTodos.length} completed todo{completedTodos.length !== 1 ? 's' : ''}</li>
          </ul>
          <p className="text-sm text-orange-700 dark:text-orange-300 mt-2 font-medium">
            This action cannot be undone.
          </p>
        </div>
      </div>
      <div className="flex space-x-3">
        <button
          onClick={onConfirm}
          className="flex-1 bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700"
        >
          Delete {completedTodos.length} Todo{completedTodos.length !== 1 ? 's' : ''}
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

function TransferOwnershipModal({
  todoList, 
  onClose, 
  onSuccess 
}: { 
  todoList: TodoList; 
  onClose: () => void; 
  onSuccess: () => void;
}) {
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);
  const { user } = db.useAuth();

  const selectedMember = todoList.members.find(member => member.id === selectedMemberId);

  const handleTransfer = async () => {
    if (!selectedMember || !user || !selectedMember.user?.id) {
      setShowError("Invalid member selection. Please try again.");
      console.error("Invalid member selection", { selectedMember, user });
      return;
    }

    setIsTransferring(true);
    setShowError(null);

    const success = await transferListOwnership(
      todoList.id,
      user.id,
      selectedMember.user.id,
      selectedMemberId
    );

    if (success) {
      onSuccess();
    } else {
      setShowError("Failed to transfer ownership. Please try again.");
    }
    
    setIsTransferring(false);
  };

  return (
    <Modal onClose={onClose} title="Transfer Ownership">
      {showError && (
        <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-4">
          {showError}
        </div>
      )}

      {!showConfirm ? (
        <>
          <div className="mb-6">
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Select a member to transfer ownership of "<strong>{todoList.name}</strong>" to:
            </p>
            
            <div className="space-y-2">
              {todoList.members
                .filter(member => member.user?.id && member.user?.email) // Only show members with valid user data
                .map(member => (
                <label key={member.id} className="flex items-center space-x-3 p-3 rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                  <input
                    type="radio"
                    name="member"
                    value={member.id}
                    checked={selectedMemberId === member.id}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    className="w-4 h-4 text-yellow-600 focus:ring-yellow-500"
                  />
                  <div className="flex-1">
                    <div className="text-gray-900 dark:text-white">
                      {member.user?.email || "Unknown User"}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Member since {new Date(member.addedAt).toLocaleDateString()}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {todoList.members.filter(member => member.user?.id && member.user?.email).length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                No valid members available. You need to invite members with confirmed accounts before you can transfer ownership.
              </p>
            )}
          </div>

          <div className="flex space-x-3">
            <button
              onClick={() => selectedMemberId ? setShowConfirm(true) : null}
              disabled={!selectedMemberId}
              className="flex-1 bg-yellow-600 text-white py-2 px-4 rounded hover:bg-yellow-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Continue
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-6">
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Are you sure you want to transfer ownership to <strong>{selectedMember?.user?.email}</strong>?
            </p>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-2">After this transfer:</p>
              <ul className="text-sm text-yellow-600 dark:text-yellow-400 space-y-1">
                <li>• <strong>{selectedMember?.user?.email}</strong> will become the owner</li>
                <li>• You will become a regular member</li>
                <li>• Only the new owner can manage settings and members</li>
                <li>• This action cannot be undone without the new owner's permission</li>
              </ul>
            </div>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={handleTransfer}
              disabled={isTransferring}
              className="flex-1 bg-yellow-600 text-white py-2 px-4 rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTransferring ? "Transferring..." : "Transfer Ownership"}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              disabled={isTransferring}
              className="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500 disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function OnlineUsersTooltip({ 
  currentUser, 
  peers, 
  numUsers,
  myPresence
}: { 
  currentUser: User | null; 
  peers: Record<string, any>; 
  numUsers: number;
  myPresence: any;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  


  const allUsers = [
    ...(currentUser && myPresence ? [{
      id: currentUser.id,
      name: myPresence.name || currentUser.email,
      isCurrentUser: true
    }] : []),
    ...Object.entries(peers).map(([peerId, peer]) => ({
      id: peerId,
      name: peer.name || "Anonymous",
      isCurrentUser: false
    }))
  ];

  return (
    <div className="relative">
      <span 
        className="flex items-center space-x-1 cursor-help"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
        <span>{numUsers} online</span>
      </span>
      
      {showTooltip && (
        <div className="absolute bottom-full left-0 mb-2 z-50">
          <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg py-2 px-3 shadow-lg whitespace-nowrap">
            <div className="font-medium mb-1">Online users:</div>
            {allUsers.map((user, index) => (
              <div key={user.id} className="flex items-center space-x-2 py-0.5">
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full flex-shrink-0"></div>
                <span className={user.isCurrentUser ? 'font-medium' : ''}>
                  {user.name}{user.isCurrentUser ? ' (You)' : ''}
                </span>
              </div>
            ))}
            {allUsers.length === 0 && (
              <div className="text-gray-400">No users online</div>
            )}
            {/* Tooltip arrow */}
            <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900 dark:border-t-gray-700"></div>
          </div>
        </div>
      )}
    </div>
  );
}

function TodoForm({ todoList }: { todoList: TodoList }) {
  const [selectedSublist, setSelectedSublist] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.input as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;

    const maxOrder = Math.max(0, ...todoList.todos.map(t => t.order || 0));
    let todoTx = db.tx.todos[id()].update({
      text,
      done: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      order: maxOrder + 1
    }).link({ list: todoList.id });

    if (selectedSublist) {
      todoTx = todoTx.link({ sublist: selectedSublist });
    }

    db.transact(todoTx).then(() => {
      input.value = "";
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
            placeholder="What needs to be done?"
            type="text"
            name="input"
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
        </div>
      </form>
    </div>
  );
}

// Draggable Todo Item Component
function SortableTodoItem({ 
  todo, 
  canWrite, 
  editingTodo, 
  editText, 
  setEditingTodo, 
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
            onClick={(e) => {
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

function TodoListComponent({ todos, canWrite, toggleTodo, deleteTodo, sublistId }: { 
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
              onClick={(e) => {
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
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
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

function AddSublistForm({ todoList }: { todoList: TodoList }) {
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

function QuickAddTodo({ todoList, sublist }: { todoList: TodoList; sublist?: Sublist }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    const maxOrder = Math.max(0, ...todoList.todos.map(t => t.order || 0));
    
    // Create todo with proper linking
    let todoTx = db.tx.todos[id()]
      .update({
        text: text.trim(),
        done: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        order: maxOrder + 1
      })
      .link({ list: todoList.id });

    // Only link to sublist if it exists and has a valid ID
    if (sublist && sublist.id) {
      todoTx = todoTx.link({ sublist: sublist.id });
    }

    db.transact(todoTx).then(() => {
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

function ActionBar({ todoList, canWrite, deleteCompleted }: { 
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
