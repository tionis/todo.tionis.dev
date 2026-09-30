'use client';

import React, { useState } from 'react';
import { db } from '../../lib/db';
import Modal from './Modal';

/**
 * Sign-out confirmation. Signing out wipes the local cache, so it warns about changes that
 * have not reached the server yet and offers to end the sessions on other devices too.
 */
export function useSignOut() {
  const [open, setOpen] = useState(false);
  const [everywhere, setEverywhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const { pending } = db.useSyncStatus();

  const confirm = async () => {
    setBusy(true);
    try {
      await db.auth.signOut({ all: everywhere });
    } finally {
      setBusy(false);
      setOpen(false);
      setEverywhere(false);
    }
  };

  const dialog = open ? (
    <Modal onClose={() => setOpen(false)} title="Sign out?" maxWidth="sm">
      <div className="space-y-4">
        {pending > 0 && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {pending} change{pending === 1 ? ' has' : 's have'} not synced yet and will be lost if you sign out now.
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={everywhere} onChange={(event) => setEverywhere(event.target.checked)} />
          Also sign out on all my other devices
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            className="px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="px-3 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending > 0 ? 'Sign out and discard changes' : 'Sign out'}
          </button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { requestSignOut: () => setOpen(true), dialog };
}
