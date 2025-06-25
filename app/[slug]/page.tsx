"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { id, InstaQLEntity, User } from "@instantdb/react";
import { db } from "../../lib/db";
import { copyToClipboard, getListUrl } from "../../lib/utils";
import type { AppSchema } from "../../lib/db";

type TodoList = InstaQLEntity<AppSchema, "todoLists", { 
  owner: {}; 
  todos: { sublist?: {} }; 
  sublists: { todos: {} }; 
  members: { user: {} };
  invitations: {}
}>;
type Todo = InstaQLEntity<AppSchema, "todos", { sublist?: {} }>;
type Sublist = InstaQLEntity<AppSchema, "sublists", { todos: {} }>;

export default function TodoListPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  
  const { isLoading: authLoading, user, error: authError } = db.useAuth();
  const { isLoading, error, data } = db.useQuery({ 
    todoLists: { 
      $: { where: { slug } },
      owner: {},
      todos: {},
      sublists: { todos: {} },
      members: { user: {} },
      invitations: {}
    } 
  });

  // Auto-accept invitations when user signs in
  useEffect(() => {
    if (user && data?.todoLists?.[0]) {
      const todoList = data.todoLists[0];
      const userEmail = user.email.toLowerCase();
      
      // Find pending invitation for this user
      const pendingInvitation = todoList.invitations.find(inv => 
        inv.email.toLowerCase() === userEmail && inv.status === 'pending'
      );
      
      if (pendingInvitation) {
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
        ]).catch(err => {
          console.error("Failed to accept invitation:", err);
          // Don't show alert here as this is automatic
        });
      }
    }
  }, [user, data?.todoLists]);

  if (authLoading || isLoading) {
    return <div className="font-mono min-h-screen flex justify-center items-center">Loading...</div>;
  }

  if (error) {
    return <div className="font-mono min-h-screen flex justify-center items-center text-red-500">Error: {error.message}</div>;
  }

  if (authError) {
    return <div className="font-mono min-h-screen flex justify-center items-center text-red-500">Auth Error: {authError.message}</div>;
  }

  const todoList = data.todoLists[0];
  
  if (!todoList) {
    return <div className="font-mono min-h-screen flex justify-center items-center">Todo list not found</div>;
  }

  // Check permissions
  const isOwner = user && todoList.owner && user.id === todoList.owner.id;
  const isMember = user && todoList.members.some(member => member.user?.id === user.id);
  const canRead = todoList.permission === 'public-read' || todoList.permission === 'public-write' || isOwner || (user && (todoList.permission === 'private-read' || todoList.permission === 'private-write') && isMember);
  const canWrite = todoList.permission === 'public-write' || isOwner || (user && todoList.permission === 'private-write' && isMember);

  if (!canRead) {
    if (!user) {
      return <AuthRequired />;
    }
    return <div className="font-mono min-h-screen flex justify-center items-center">You don't have permission to view this list</div>;
  }

  return (
    <TodoListApp 
      todoList={todoList} 
      user={user} 
      isOwner={!!isOwner} 
      canWrite={!!canWrite} 
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

function TodoListApp({ 
  todoList, 
  user, 
  isOwner, 
  canWrite 
}: { 
  todoList: TodoList; 
  user: User | null; 
  isOwner: boolean; 
  canWrite: boolean;
}) {
  const room = db.room("todoList", todoList.slug);
  const { peers } = db.rooms.usePresence(room, {
    initialData: { name: user?.email || "Anonymous", userId: user?.id || undefined }
  });
  
  const numUsers = 1 + Object.keys(peers).length;
  const [showSettings, setShowSettings] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showCompletedUncategorized, setShowCompletedUncategorized] = useState(false);

  // Sort todos by sublist and order
  const todosWithoutSublist = todoList.todos.filter(todo => !todo.sublist);
  const visibleTodos = (todoList.hideCompleted && !showCompletedUncategorized) 
    ? todosWithoutSublist.filter(todo => !todo.done)
    : todosWithoutSublist;

  const completedUncategorizedTodos = todosWithoutSublist.filter(todo => todo.done);

  const sublists = todoList.sublists.sort((a, b) => a.order - b.order);

  return (
    <div className="font-mono min-h-screen flex justify-center items-center flex-col space-y-4">
      <div className="flex items-center space-x-4">
        <h2 className="tracking-wide text-5xl text-gray-300">{todoList.name}</h2>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowShareModal(true)}
            className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Share
          </button>
          {isOwner && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-3 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              Settings
            </button>
          )}
          {user && (
            <button
              onClick={() => db.auth.signOut()}
              className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
            >
              Sign Out
            </button>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Online: {numUsers} • Permission: {todoList.permission}
      </div>

      {showSettings && isOwner && (
        <SettingsPanel todoList={todoList} onClose={() => setShowSettings(false)} />
      )}

      {showShareModal && (
        <ShareModal 
          todoList={todoList} 
          onClose={() => setShowShareModal(false)} 
          isOwner={isOwner}
        />
      )}

      <div className="border border-gray-300 dark:border-gray-600 max-w-2xl w-full bg-white dark:bg-gray-800">
        {canWrite && <TodoForm todoList={todoList} />}
        
        {/* Sublists */}
        {sublists.map(sublist => (
          <SublistSection 
            key={sublist.id} 
            sublist={sublist} 
            todoList={todoList}
            canWrite={canWrite}
            isOwner={isOwner}
          />
        ))}

        {/* Add new sublist button */}
        {canWrite && <AddSublistForm todoList={todoList} />}
        
        {/* Todos without sublist */}
        {(visibleTodos.length > 0 || (todosWithoutSublist.length > 0 && todoList.hideCompleted && !showCompletedUncategorized)) && (
          <div>
            <div className="bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm font-medium border-b border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white">
              Uncategorized ({todosWithoutSublist.filter(t => !t.done).length}/{todosWithoutSublist.length})
            </div>
            {visibleTodos.length > 0 && (
              <TodoList todos={visibleTodos} canWrite={canWrite} />
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
                <TodoList todos={completedUncategorizedTodos} canWrite={canWrite} />
              </div>
            )}
          </div>
        )}
        
        <ActionBar todoList={todoList} canWrite={canWrite} />
      </div>
    </div>
  );
}

function SettingsPanel({ todoList, onClose }: { todoList: TodoList; onClose: () => void }) {
  const [permission, setPermission] = useState(todoList.permission);
  const [hideCompleted, setHideCompleted] = useState(todoList.hideCompleted);
  const [name, setName] = useState(todoList.name);

  const handleSave = () => {
    db.transact([
      db.tx.todoLists[todoList.id].update({
        permission,
        hideCompleted,
        name,
        updatedAt: new Date().toISOString()
      })
    ]).catch(err => {
      console.error("Failed to update list settings:", err);
      alert("Failed to update list settings. Please try again.");
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">List Settings</h3>
        
        <div className="space-y-4">
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
            Save
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ShareModal({ 
  todoList, 
  onClose, 
  isOwner 
}: { 
  todoList: TodoList; 
  onClose: () => void; 
  isOwner: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [showSuccess, setShowSuccess] = useState("");
  
  const listUrl = getListUrl(todoList.slug);

  const handleCopy = async () => {
    try {
      await copyToClipboard(listUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy URL");
    }
  };

  const sendInvitation = async () => {
    if (!newMemberEmail.trim()) return;
    
    setIsInviting(true);
    try {
      const email = newMemberEmail.trim().toLowerCase();
      
      // Check if user is already a member
      const existingMember = todoList.members.find(member => 
        member.user?.email?.toLowerCase() === email
      );
      
      if (existingMember) {
        alert("This user is already a member of this list.");
        setIsInviting(false);
        return;
      }
      
      // Check if invitation already exists
      const existingInvitation = todoList.invitations.find(inv => 
        inv.email.toLowerCase() === email && inv.status === 'pending'
      );
      
      if (existingInvitation) {
        alert("An invitation has already been sent to this email.");
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
      
      setShowSuccess(`Invitation sent to ${email}! They can now access the list using this URL.`);
      setNewMemberEmail("");
      
      // Auto-hide success message
      setTimeout(() => setShowSuccess(""), 5000);
      
    } catch (err) {
      console.error("Failed to send invitation:", err);
      alert("Failed to send invitation. Please try again.");
    } finally {
      setIsInviting(false);
    }
  };

  const revokeInvitation = async (invitationId: string) => {
    try {
      await db.transact(db.tx.invitations[invitationId].delete());
    } catch (err) {
      console.error("Failed to revoke invitation:", err);
      alert("Failed to revoke invitation. Please try again.");
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      await db.transact(db.tx.listMembers[memberId].delete());
    } catch (err) {
      console.error("Failed to remove member:", err);
      alert("Failed to remove member. Please try again.");
    }
  };

  const pendingInvitations = todoList.invitations.filter(inv => inv.status === 'pending');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 text-gray-900 dark:text-white p-6 rounded-lg max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Share "{todoList.name}"</h3>
        
        <div className="space-y-4">
          {/* Success Message */}
          {showSuccess && (
            <div className="bg-green-100 dark:bg-green-900 border border-green-400 dark:border-green-600 text-green-700 dark:text-green-200 px-4 py-3 rounded">
              {showSuccess}
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

function SublistSection({ 
  sublist, 
  todoList, 
  canWrite, 
  isOwner 
}: { 
  sublist: Sublist; 
  todoList: TodoList; 
  canWrite: boolean; 
  isOwner: boolean;
}) {
  const [showCompletedInSublist, setShowCompletedInSublist] = useState(false);
  
  const visibleTodos = (todoList.hideCompleted && !showCompletedInSublist) 
    ? sublist.todos.filter(todo => !todo.done)
    : sublist.todos;
  
  const completedTodos = sublist.todos.filter(todo => todo.done);
  const completedCount = completedTodos.length;
  const totalCount = sublist.todos.length;

  const deleteSublist = () => {
    if (confirm(`Delete sublist "${sublist.name}" and all its todos?`)) {
      db.transact([
        ...sublist.todos.map(todo => db.tx.todos[todo.id].delete()),
        db.tx.sublists[sublist.id].delete()
      ]).catch(err => {
        console.error("Failed to delete sublist:", err);
        alert("Failed to delete sublist. Please try again.");
      });
    }
  };

  return (
    <div className="border-b border-gray-300 dark:border-gray-600">
      <div className="bg-gray-50 dark:bg-gray-700 px-3 py-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900 dark:text-white">
          {sublist.name} ({totalCount - completedCount}/{totalCount})
        </span>
        {isOwner && (
          <button
            onClick={deleteSublist}
            className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs"
          >
            Delete
          </button>
        )}
      </div>
      {visibleTodos.length > 0 && (
        <TodoList todos={visibleTodos} canWrite={canWrite} />
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
          <TodoList todos={completedTodos} canWrite={canWrite} />
        </div>
      )}
      {canWrite && <QuickAddTodo todoList={todoList} sublist={sublist} />}
    </div>
  );
}

function AddSublistForm({ todoList }: { todoList: TodoList }) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");

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
    ).catch(err => {
      console.error("Failed to create sublist:", err);
      alert("Failed to create sublist. Please try again.");
    });
    
    setName("");
    setIsAdding(false);
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

    console.log("About to create todo with transaction:", todoTx);

    db.transact(todoTx).catch(err => {
      console.error("Failed to create todo:", err);
      console.error("Error details:", JSON.stringify(err, null, 2));
      console.error("Transaction details:", todoTx);
      alert("Failed to create todo. Please try again.");
    });
    
    setText("");
  };

  return (
    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-600">
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

function TodoForm({ todoList }: { todoList: TodoList }) {
  const [selectedSublist, setSelectedSublist] = useState<string>("");

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

    db.transact(todoTx).catch(err => {
      console.error("Failed to create todo:", err);
      console.error("Error details:", JSON.stringify(err, null, 2));
      console.error("Transaction details:", todoTx);
      alert("Failed to create todo. Please try again.");
    });
    input.value = "";
  };

  return (
    <div className="border-b border-gray-300 dark:border-gray-600 p-3">
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex space-x-2">
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
            className="px-2 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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

function TodoList({ todos, canWrite }: { todos: Todo[]; canWrite: boolean }) {
  const sortedTodos = [...todos].sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <div className="divide-y divide-gray-300">
      {sortedTodos.map((todo) => (
        <div key={todo.id} className="flex items-center h-10">
          <div className="h-full px-2 flex items-center justify-center">
            <input
              type="checkbox"
              className="cursor-pointer"
              checked={todo.done}
              onChange={() => canWrite && toggleTodo(todo)}
              disabled={!canWrite}
            />
          </div>
          <div className="flex-1 px-2 overflow-hidden flex items-center">
            {todo.done ? (
              <span className="line-through text-gray-500">{todo.text}</span>
            ) : (
              <span>{todo.text}</span>
            )}
          </div>
          {canWrite && (
            <button
              className="h-full px-2 flex items-center justify-center text-gray-300 hover:text-gray-500"
              onClick={() => deleteTodo(todo)}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ActionBar({ todoList, canWrite }: { todoList: TodoList; canWrite: boolean }) {
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

// Helper functions
function toggleTodo(todo: Todo) {
  db.transact(db.tx.todos[todo.id].update({ 
    done: !todo.done,
    updatedAt: new Date().toISOString()
  })).catch(err => {
    console.error("Failed to update todo:", err);
    alert("Failed to update todo. Please try again.");
  });
}

function deleteTodo(todo: Todo) {
  db.transact(db.tx.todos[todo.id].delete()).catch(err => {
    console.error("Failed to delete todo:", err);
    alert("Failed to delete todo. Please try again.");
  });
}

function deleteCompleted(completedTodos: Todo[]) {
  if (completedTodos.length === 0) return;
  
  if (confirm(`Delete ${completedTodos.length} completed todos?`)) {
    db.transact(completedTodos.map(todo => db.tx.todos[todo.id].delete())).catch(err => {
      console.error("Failed to delete completed todos:", err);
      alert("Failed to delete completed todos. Please try again.");
    });
  }
}
