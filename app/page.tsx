"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { id, User } from "@instantdb/react";
import { db } from "../lib/db";
import { generateSlug, getListUrl, copyToClipboard } from "../lib/utils";
import { executeTransaction, canUserWrite, canUserView } from "../lib/transactions";
import LoadingSpinner from "./components/LoadingSpinner";
import ErrorDisplay from "./components/ErrorDisplay";
import type { AppSchema } from "../lib/db";

function App() {
  const [mounted, setMounted] = useState(false);
  const { isLoading, user, error } = db.useAuth();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent hydration mismatch by showing loading state until mounted
  if (!mounted) {
    return <LoadingSpinner />;
  }

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorDisplay message={error.message} />;
  if (user) return <AuthenticatedApp user={user} />;
  return <LandingPage />;
}

function LandingPage() {
  const router = useRouter();
  const [sentEmail, setSentEmail] = useState("");

  return (
    <div className="font-mono min-h-screen flex justify-center items-center flex-col space-y-8">
      <div className="text-center space-y-4">
        <h1 className="tracking-wide text-6xl text-gray-300">Smart Todos</h1>
        <p className="text-xl text-gray-500">Collaborative todo lists with sublists and permissions</p>
      </div>

      <div className="space-y-4 w-full max-w-md">
        <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-6 bg-white dark:bg-gray-800">
          <h3 className="text-lg font-medium mb-4 text-center text-gray-900 dark:text-white">Sign In to Get Started</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 text-center">
            Create and manage your todo lists with real-time collaboration
          </p>
          {!sentEmail ? (
            <EmailStep onSendEmail={setSentEmail} />
          ) : (
            <CodeStep sentEmail={sentEmail} />
          )}
        </div>
      </div>

      <div className="text-center space-y-2 text-sm text-gray-500 max-w-2xl">
        <p>Features:</p>
        <ul className="space-y-1">
          <li>• Real-time collaboration</li>
          <li>• Organize with sublists/categories</li>
          <li>• Flexible permissions (public, private, members-only)</li>
          <li>• Works offline</li>
          <li>• Share with simple URLs</li>
        </ul>
        <p className="mt-4 text-xs">
          Already have a list URL? Just paste it in your browser to access it.
        </p>
      </div>
    </div>
  );
}

function AuthenticatedApp({ user }: { user: User }) {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<{show: boolean, list: any} | null>(null);
  const [showErrorModal, setShowErrorModal] = useState<{show: boolean, message: string} | null>(null);
  
  const { isLoading, error, data } = db.useQuery({ 
    todoLists: { 
      $: { 
        where: { 
          or: [
            { "owner.id": user.id },
            { "members.user.id": user.id }
          ]
        },
        order: { createdAt: "desc" }
      },
      owner: {},
      todos: {},
      members: { user: {} }
    },
    invitations: {
      $: { where: { email: user.email.toLowerCase(), status: 'pending' } }
    }
  });

  if (isLoading) return <LoadingSpinner message="Loading your lists..." />;
  if (error) return <ErrorDisplay message={error.message} />;

  const pendingInvitationsCount = data.invitations?.length || 0;

  const createNewList = async (listName: string) => {
    const slug = generateSlug();
    
    const success = await executeTransaction(
      db.tx.todoLists[id()]
        .update({
          name: listName,
          slug,
          permission: "private-write",
          hideCompleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .link({ owner: user.id }),
      "Failed to create list"
    );
    
    if (success) {
      router.push(`/${slug}`);
    } else {
      setShowErrorModal({show: true, message: "Failed to create list. Please try again."});
    }
  };

  const deleteList = async (list: any) => {
    const success = await executeTransaction([
      ...list.todos.map((todo: any) => db.tx.todos[todo.id].delete()),
      ...list.members.map((member: any) => db.tx.listMembers[member.id].delete()),
      db.tx.todoLists[list.id].delete()
    ], "Failed to delete list");
    
    if (!success) {
      setShowErrorModal({show: true, message: "Failed to delete list. Please try again."});
    }
  };

  return (
    <div className="font-mono min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="tracking-wide text-4xl text-gray-300 mb-2">Your Todo Lists</h1>
            <p className="text-gray-500">Welcome back, {user.email}</p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => router.push('/invitations')}
              className="relative px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
            >
              Invitations
              {pendingInvitationsCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {pendingInvitationsCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              New List
            </button>
            <button
              onClick={() => db.auth.signOut()}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Sign Out
            </button>
          </div>
        </div>

        {!data.todoLists || data.todoLists.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">You don't have any todo lists yet.</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create Your First List
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.todoLists.map(list => (
              <TodoListCard 
                key={list.id} 
                list={list} 
                user={user} 
                onDelete={(list) => setShowDeleteModal({show: true, list})}
              />
            ))}
          </div>
        )}

        {/* Create List Modal */}
        {showCreateModal && (
          <CreateListModal 
            onClose={() => setShowCreateModal(false)}
            onCreate={createNewList}
          />
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal?.show && (
          <ConfirmDeleteModal
            title="Delete Todo List"
            message={`Delete "${showDeleteModal.list.name}" and all its todos?`}
            onConfirm={() => {
              deleteList(showDeleteModal.list);
              setShowDeleteModal(null);
            }}
            onCancel={() => setShowDeleteModal(null)}
          />
        )}

        {/* Error Modal */}
        {showErrorModal?.show && (
          <ErrorModal
            message={showErrorModal.message}
            onClose={() => setShowErrorModal(null)}
          />
        )}
      </div>
    </div>
  );
}

function TodoListCard({ 
  list, 
  user,
  onDelete 
}: { 
  list: any; 
  user: User;
  onDelete: (list: any) => void;
}) {
  const router = useRouter();
  const [showShareModal, setShowShareModal] = useState(false);
  
  const isOwner = list.owner && list.owner.id === user.id;
  const totalTodos = list.todos.length;
  const completedTodos = list.todos.filter((todo: any) => todo.done).length;
  const remainingTodos = totalTodos - completedTodos;

  const deleteList = () => {
    onDelete(list);
  };

  return (
    <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4 hover:shadow-md transition-shadow bg-white dark:bg-gray-800">
      <div className="flex justify-between items-start mb-3">
        <h3 
          className="font-medium text-lg cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 text-gray-900 dark:text-white"
          onClick={() => router.push(`/${list.slug}`)}
        >
          {list.name}
        </h3>
        <div className="flex space-x-1">
          <button
            onClick={() => setShowShareModal(true)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm"
            title="Share"
          >
            🔗
          </button>
          {isOwner && (
            <button
              onClick={deleteList}
              className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 text-sm"
              title="Delete"
            >
              🗑️
            </button>
          )}
        </div>
      </div>
      
      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
        <p>{remainingTodos} remaining, {completedTodos} completed</p>
        <p>Permission: {list.permission}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {isOwner ? "You own this list" : "You're a member"}
        </p>
      </div>

      <button
        onClick={() => router.push(`/${list.slug}`)}
        className="w-full mt-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm text-gray-900 dark:text-white"
      >
        Open List
      </button>

      {showShareModal && (
        <ShareModal 
          list={list} 
          onClose={() => setShowShareModal(false)} 
        />
      )}
    </div>
  );
}

function ShareModal({ 
  list, 
  onClose 
}: { 
  list: any; 
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showError, setShowError] = useState<string | null>(null);
  const listUrl = getListUrl(list.slug);

  const handleCopy = async () => {
    try {
      await copyToClipboard(listUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setShowError("Failed to copy URL");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Share "{list.name}"</h3>
        
        <div className="space-y-4">
          {showError && (
            <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded">
              {showError}
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Share URL</label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={listUrl}
                readOnly
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
          
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Permission: <strong className="text-gray-900 dark:text-white">{list.permission}</strong>
          </p>
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
          >
            Close
          </button>
        </div>
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
        <input
          ref={inputRef}
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
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Enter the code sent to {sentEmail}
        </p>
        <input
          ref={inputRef}
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

// Modal Components
function CreateListModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [listName, setListName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (listName.trim()) {
      onCreate(listName.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Create New List</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              List Name
            </label>
            <input
              type="text"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="Enter list name"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
              autoFocus
            />
          </div>
          <div className="flex space-x-3">
            <button
              type="submit"
              disabled={!listName.trim()}
              className="flex-1 bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create List
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
      </div>
    </div>
  );
}

function ConfirmDeleteModal({ 
  title, 
  message, 
  onConfirm, 
  onCancel 
}: { 
  title: string; 
  message: string; 
  onConfirm: () => void; 
  onCancel: () => void; 
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">{title}</h3>
        <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
        <div className="flex space-x-3">
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700"
          >
            Delete
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-bold mb-4 text-red-600 dark:text-red-400">Error</h3>
        <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
        <button
          onClick={onClose}
          className="w-full bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default App;