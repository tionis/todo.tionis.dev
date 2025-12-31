"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Group, ID } from "jazz-tools";
import { useAccount, useCoState } from "../lib/jazz";
import { TodoList, ListOfTodos, ListOfSublists, TodoAccount, TodoAccountRoot } from "../lib/schema";
import { copyToClipboard } from "../lib/utils";
import LoadingSpinner from "./components/LoadingSpinner";
import ErrorDisplay from "./components/ErrorDisplay";
import Modal from "./components/Modal";
import { useHashRouter } from "./components/HashRouter";
import TodoListView from "./components/TodoListView";
import InvitationsView from "./components/InvitationsView";

const PENDING_INVITE_KEY = 'pendingInviteHash';

function App() {
  const [mounted, setMounted] = useState(false);
  const { me, logOut } = useAccount({ resolve: { root: { todoLists: { $each: true } } } });

  // Define routes for hash router
  const routes = useMemo(() => [
    {
      path: '/list/:id',
      component: TodoListView,
    },
    {
      path: '/invitations',
      component: InvitationsView,
    },
    {
      path: '/invite/:inviteLink',
      component: InvitationsView,
    }
  ], []);

  const { currentRoute, routeParams, navigate } = useHashRouter(routes);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Store invite URL before auth, restore after
  useEffect(() => {
    if (!mounted) return;

    const hash = window.location.hash;

    // If we're on an invite URL and not logged in, store it
    if (hash.includes('/invite/') && !me) {
      sessionStorage.setItem(PENDING_INVITE_KEY, hash);
    }

    // If we just logged in and have a pending invite, restore it
    if (me && me.root) {
      const pendingInvite = sessionStorage.getItem(PENDING_INVITE_KEY);
      if (pendingInvite) {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
        // Restore the invite URL
        window.location.hash = pendingInvite.replace('#', '');
      }
    }
  }, [mounted, me]);

  // Prevent hydration mismatch by showing loading state until mounted
  if (!mounted) {
    return <LoadingSpinner />;
  }

  // Jazz handles auth UI automatically through PassphraseAuth
  // If not logged in, the provider will show the auth UI
  // Check auth BEFORE routing to prevent accessing old list IDs
  if (!me) {
    return <LoadingSpinner message="Loading..." />;
  }

  // Wait for account root to be loaded before routing
  if (!me.root) {
    return <LoadingSpinner message="Setting up your account..." />;
  }

  // If we have a current route, render that component (only after auth check)
  if (currentRoute) {
    // For list routes, validate that the list ID belongs to this user or clear the hash
    if (currentRoute.path === '/list/:id' && routeParams.id) {
      const userListIds = me.root.todoLists?.map(list => list?.id).filter(Boolean) || [];
      if (!userListIds.includes(routeParams.id)) {
        // List ID not in user's lists - could be shared list or invalid
        // Let TodoListView handle it (it will show error with "Go Home" button)
      }
    }

    const RouteComponent = currentRoute.component;
    return <RouteComponent {...routeParams} {...(currentRoute.props || {})} />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const { me, logOut } = useAccount({ resolve: { root: { todoLists: { $each: true } } } });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState<{show: boolean, list: TodoList} | null>(null);
  const [showErrorModal, setShowErrorModal] = useState<{show: boolean, message: string} | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);

  if (!me || !me.root) {
    return <LoadingSpinner message="Loading your lists..." />;
  }

  const todoLists = me.root.todoLists || [];

  const createNewList = async (listName: string) => {
    try {
      // Create a new group for this list's permissions
      const listGroup = Group.create();
      listGroup.addMember(me, "admin");

      // Create the todo list
      const newList = TodoList.create({
        name: listName,
        hideCompleted: false,
        createdAt: new Date().toISOString(),
        todos: ListOfTodos.create([], { owner: listGroup }),
        sublists: ListOfSublists.create([], { owner: listGroup }),
      }, { owner: listGroup });

      // Add to user's list of todo lists
      me.root.todoLists?.push(newList);

      // Navigate to the new list
      window.location.hash = `/list/${newList.id}`;
    } catch (err) {
      console.error("Failed to create list:", err);
      setShowErrorModal({show: true, message: "Failed to create list. Please try again."});
    }
  };

  const deleteList = async (list: TodoList) => {
    try {
      // Remove from user's list
      const index = me.root.todoLists?.findIndex(l => l?.id === list.id);
      if (index !== undefined && index >= 0) {
        me.root.todoLists?.splice(index, 1);
      }
    } catch (err) {
      console.error("Failed to delete list:", err);
      setShowErrorModal({show: true, message: "Failed to delete list. Please try again."});
    }
  };

  return (
    <div className="font-mono min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="tracking-wide text-4xl text-gray-300 mb-2">Your Todo Lists</h1>
            <p className="text-gray-500">Welcome back, {me.profile?.name || "User"}</p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              New List
            </button>
            <button
              onClick={() => setShowProfileModal(true)}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              title="Profile Settings"
            >
              Profile
            </button>
            <button
              onClick={() => logOut()}
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Sign Out
            </button>
          </div>
        </div>

        {todoLists.length === 0 ? (
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
            {todoLists.map(list => list && (
              <TodoListCard
                key={list.id}
                list={list}
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

        {/* Profile Modal */}
        {showProfileModal && (
          <ProfileModal
            onClose={() => setShowProfileModal(false)}
          />
        )}
      </div>
    </div>
  );
}

function TodoListCard({
  list,
  onDelete
}: {
  list: TodoList;
  onDelete: (list: TodoList) => void;
}) {
  const totalTodos = list.todos?.length || 0;
  const completedTodos = list.todos?.filter((todo) => todo?.done).length || 0;
  const remainingTodos = totalTodos - completedTodos;

  return (
    <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-4 hover:shadow-md transition-shadow bg-white dark:bg-gray-800">
      <div className="flex justify-between items-start mb-3">
        <h3
          className="font-medium text-lg cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 text-gray-900 dark:text-white"
          onClick={() => window.location.hash = `/list/${list.id}`}
        >
          {list.name}
        </h3>
        <button
          onClick={() => onDelete(list)}
          className="text-gray-400 hover:text-red-600 dark:hover:text-red-400 text-sm"
          title="Delete"
        >
          🗑️
        </button>
      </div>

      <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
        <p>{remainingTodos} remaining, {completedTodos} completed</p>
      </div>

      <button
        onClick={() => window.location.hash = `/list/${list.id}`}
        className="w-full mt-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-sm text-gray-900 dark:text-white"
      >
        Open List
      </button>
    </div>
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
    <Modal onClose={onClose} title="Create New List">
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
    </Modal>
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
    <Modal onClose={onCancel} title={title}>
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
    </Modal>
  );
}

function ErrorModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="Error">
      <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
      <button
        onClick={onClose}
        className="w-full bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 py-2 px-4 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
      >
        Close
      </button>
    </Modal>
  );
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const { me } = useAccount({ resolve: { root: true } });
  const [name, setName] = useState(me?.profile?.name || "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me?.profile?.name) {
      setName(me.profile.name);
    }
  }, [me?.profile?.name]);

  const handleSave = () => {
    if (!me?.profile) {
      setError("Unable to update profile");
      return;
    }

    if (!name.trim()) {
      setError("Name cannot be empty");
      return;
    }

    try {
      me.profile.name = name.trim();
      setSaved(true);
      setError(null);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 1000);
    } catch (err) {
      console.error("Failed to update profile:", err);
      setError("Failed to update profile. Please try again.");
    }
  };

  return (
    <Modal onClose={onClose} title="Profile Settings">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-200 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {saved && (
          <div className="bg-green-100 dark:bg-green-900 border border-green-400 dark:border-green-600 text-green-700 dark:text-green-200 px-4 py-3 rounded">
            Profile saved successfully!
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Display Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your display name"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            This name will be shown to other collaborators
          </p>
        </div>

        <div className="pt-2">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Account Info</h4>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400 shrink-0">Account ID:</span>
              <code className="text-xs text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded break-all select-all">
                {me?.id || "Loading..."}
              </code>
            </div>
          </div>
        </div>
      </div>

      <div className="flex space-x-3 mt-6">
        <button
          onClick={handleSave}
          disabled={!name.trim() || saved}
          className="flex-1 bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saved ? "Saved!" : "Save Changes"}
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

export default App;
