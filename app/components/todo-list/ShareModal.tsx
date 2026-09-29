"use client";

import { useState, useEffect } from 'react';
import { db, type User } from '../../../lib/db';
import { copyToClipboard, getListUrl } from '../../../lib/utils';
import { userDisplayName } from '../../../shared/identity.mjs';
import Modal from '../Modal';
import type { TodoList } from './types';

export function ShareModal({ 
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
  const [directoryResults, setDirectoryResults] = useState<{ users: any[]; groups: any[] }>({ users: [], groups: [] });
  const [isSearching, setIsSearching] = useState(false);
  
  const listUrl = getListUrl(todoList.slug);

  useEffect(() => {
    const query = newMemberEmail.trim();
    if (!isOwner || query.length < 2) {
      setDirectoryResults({ users: [], groups: [] });
      setIsSearching(false);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const timeout = window.setTimeout(() => {
      db.sharing.search(todoList.id, query).then((result) => {
        if (!cancelled) setDirectoryResults(result);
      }).catch((error) => {
        console.error("Failed to search directory:", error);
        if (!cancelled) setDirectoryResults({ users: [], groups: [] });
      }).finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [isOwner, newMemberEmail, todoList.id]);

  const handleCopy = async () => {
    try {
      await copyToClipboard(listUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error("Failed to copy URL");
      setShowError("Failed to copy URL");
    }
  };

  const addDirectoryUser = async (target: any) => {
    setIsInviting(true);
    setShowError(null);
    try {
      await db.sharing.addUser(todoList.id, target);
      setShowSuccess(typeof navigator !== "undefined" && !navigator.onLine
        ? `${userDisplayName(target)} will be added when you reconnect.`
        : `${userDisplayName(target)} now has access to this list.`);
      setNewMemberEmail("");
      setDirectoryResults({ users: [], groups: [] });
    } catch (error) {
      console.error("Failed to add directory user:", error);
      setShowError("Failed to add this user. Please try again.");
    } finally {
      setIsInviting(false);
    }
  };

  const addDirectoryGroup = async (group: any) => {
    setIsInviting(true);
    setShowError(null);
    try {
      await db.sharing.addGroup(todoList.id, group);
      setShowSuccess(typeof navigator !== "undefined" && !navigator.onLine
        ? `${group.name} will be added when you reconnect.`
        : `${group.name} now has access to this list.`);
      setNewMemberEmail("");
      setDirectoryResults({ users: [], groups: [] });
    } catch (error) {
      console.error("Failed to add directory group:", error);
      setShowError("Failed to add this group. Please try again.");
    } finally {
      setIsInviting(false);
    }
  };

  const removeGroup = async (grantId: string) => {
    try {
      await db.sharing.removeGroup(todoList.id, grantId);
    } catch (error) {
      console.error("Failed to remove group access:", error);
      setShowError("Failed to remove group access. Please try again.");
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
            {/* Directory sharing */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Add a User or Group</label>
              <div className="space-y-2">
                <div>
                  <input
                    type="text"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="Search name, @username, group, or email"
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                    disabled={isInviting}
                  />
                </div>
                {(isSearching || directoryResults.users.length > 0 || directoryResults.groups.length > 0) && (
                  <div className="border border-gray-200 dark:border-gray-600 rounded divide-y divide-gray-200 dark:divide-gray-600 max-h-48 overflow-y-auto">
                    {isSearching && <p className="p-2 text-sm text-gray-500 dark:text-gray-400">Searching directory…</p>}
                    {!isSearching && directoryResults.users.map((target) => (
                      <button
                        key={`user-${target.id}`}
                        type="button"
                        onClick={() => addDirectoryUser(target)}
                        className="w-full p-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between"
                      >
                        <span>
                          <span className="block text-sm text-gray-900 dark:text-white">{userDisplayName(target)}</span>
                          {target.name && target.username && <span className="block text-xs text-gray-500 dark:text-gray-400">@{target.username}</span>}
                        </span>
                        <span className="text-xs text-blue-600 dark:text-blue-400">Add user</span>
                      </button>
                    ))}
                    {!isSearching && directoryResults.groups.map((group) => (
                      <button
                        key={`group-${group.id}`}
                        type="button"
                        onClick={() => addDirectoryGroup(group)}
                        className="w-full p-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between"
                      >
                        <span className="text-sm text-gray-900 dark:text-white">{group.name}</span>
                        <span className="text-xs text-blue-600 dark:text-blue-400">Add group</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Select a provisioned directory user or group to grant access immediately.
                </p>
              </div>
            </div>

            {/* Current Members */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Current Members</label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {todoList.members.map(member => (
                  <div key={member.id} className="flex items-center justify-between py-1">
                    <span>
                      <span className="block text-sm text-gray-900 dark:text-white">{userDisplayName(member.user)}</span>
                      {member.user?.name && member.user?.username && <span className="block text-xs text-gray-500 dark:text-gray-400">@{member.user.username}</span>}
                      {member.user?.active === false && <span className="block text-xs text-amber-600 dark:text-amber-400">Deprovisioned</span>}
                    </span>
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

            {/* Directory Groups */}
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">Directory Groups</label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {(todoList.groupGrants || []).map((grant) => (
                  <div key={grant.id} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-900 dark:text-white">{grant.group?.name || 'Unknown Group'}</span>
                    <button
                      onClick={() => removeGroup(grant.id)}
                      className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {(todoList.groupGrants || []).length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No groups added</p>
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
            {todoList.permission === 'private-write' && "Only members can view and edit"}
            {todoList.permission === 'private-read' && "Only members can view and edit"}
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
                  You can leave this list at any time. You'll lose access unless the owner adds you again.
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
                <li>• The owner will need to add you again to restore access</li>
              </ul>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-2 font-medium">
                The owner can add you again later.
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
