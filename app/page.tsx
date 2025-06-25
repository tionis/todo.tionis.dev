"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { id, User } from "@instantdb/react";
import { db } from "../lib/db";
import { generateSlug, getListUrl, copyToClipboard } from "../lib/utils";
import type { AppSchema } from "../lib/db";

function App() {
  const { isLoading, user, error } = db.useAuth();

  if (isLoading) return <div className="font-mono min-h-screen flex justify-center items-center">Loading...</div>;
  if (error) return <div className="font-mono min-h-screen flex justify-center items-center text-red-500">Error: {error.message}</div>;
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
    } 
  });

  if (isLoading) return <div className="font-mono min-h-screen flex justify-center items-center">Loading your lists...</div>;
  if (error) return <div className="font-mono min-h-screen flex justify-center items-center text-red-500">Error: {error.message}</div>;

  const createNewList = () => {
    const slug = generateSlug();
    const listName = prompt("Enter list name:") || "New Todo List";
    
    db.transact(
      db.tx.todoLists[id()]
        .update({
          name: listName,
          slug,
          permission: "private-write",
          hideCompleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .link({ owner: user.id })
    );
    
    router.push(`/${slug}`);
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
              onClick={createNewList}
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
              onClick={createNewList}
              className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create Your First List
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.todoLists.map(list => (
              <TodoListCard key={list.id} list={list} user={user} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TodoListCard({ 
  list, 
  user 
}: { 
  list: any; 
  user: User;
}) {
  const router = useRouter();
  const [showShareModal, setShowShareModal] = useState(false);
  
  const isOwner = list.owner && list.owner.id === user.id;
  const totalTodos = list.todos.length;
  const completedTodos = list.todos.filter((todo: any) => todo.done).length;
  const remainingTodos = totalTodos - completedTodos;

  const deleteList = () => {
    if (confirm(`Delete "${list.name}" and all its todos?`)) {
      db.transact([
        ...list.todos.map((todo: any) => db.tx.todos[todo.id].delete()),
        ...list.members.map((member: any) => db.tx.listMembers[member.id].delete()),
        db.tx.todoLists[list.id].delete()
      ]);
    }
  };

  return (
    <div className="border border-gray-300 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <h3 
          className="font-medium text-lg cursor-pointer hover:text-blue-600"
          onClick={() => router.push(`/${list.slug}`)}
        >
          {list.name}
        </h3>
        <div className="flex space-x-1">
          <button
            onClick={() => setShowShareModal(true)}
            className="text-gray-400 hover:text-gray-600 text-sm"
            title="Share"
          >
            🔗
          </button>
          {isOwner && (
            <button
              onClick={deleteList}
              className="text-gray-400 hover:text-red-600 text-sm"
              title="Delete"
            >
              🗑️
            </button>
          )}
        </div>
      </div>
      
      <div className="text-sm text-gray-600 space-y-1">
        <p>{remainingTodos} remaining, {completedTodos} completed</p>
        <p>Permission: {list.permission}</p>
        <p className="text-xs text-gray-500">
          {isOwner ? "You own this list" : "You're a member"}
        </p>
      </div>

      <button
        onClick={() => router.push(`/${list.slug}`)}
        className="w-full mt-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
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
  const listUrl = getListUrl(list.slug);

  const handleCopy = async () => {
    try {
      await copyToClipboard(listUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      alert("Failed to copy URL");
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Share "{list.name}"</h3>
        
        <div className="space-y-4">
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
  
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = inputRef.current!.value;
    setIsLoading(true);
    
    try {
      await db.auth.sendMagicCode({ email });
      onSendEmail(email);
    } catch (err: any) {
      alert("Error sending code: " + (err.body?.message || err.message));
      onSendEmail("");
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
  
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = inputRef.current!.value;
    setIsLoading(true);
    
    try {
      await db.auth.signInWithMagicCode({ email: sentEmail, code });
    } catch (err: any) {
      alert("Error signing in: " + (err.body?.message || err.message));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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

export default App;