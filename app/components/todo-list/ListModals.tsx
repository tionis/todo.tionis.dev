"use client";

import { useState } from 'react';
import { db } from '../../../lib/db';
import { transferListOwnership } from '../../../lib/transactions';
import { userDisplayName } from '../../../shared/identity.mjs';
import Modal from '../Modal';
import type { TodoList } from './types';

export function DeleteCompletedModal({
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

export function TransferOwnershipModal({
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
                .filter(member => member.user?.id && member.user?.active !== false)
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
                      {userDisplayName(member.user)}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Member since {new Date(member.addedAt).toLocaleDateString()}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {todoList.members.filter(member => member.user?.id && member.user?.active !== false).length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                No valid members available. Add a provisioned user before transferring ownership.
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
              Are you sure you want to transfer ownership to <strong>{userDisplayName(selectedMember?.user)}</strong>?
            </p>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-2">After this transfer:</p>
              <ul className="text-sm text-yellow-600 dark:text-yellow-400 space-y-1">
                <li>• <strong>{userDisplayName(selectedMember?.user)}</strong> will become the owner</li>
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
