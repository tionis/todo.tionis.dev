"use client";

import React, { useState, useEffect } from "react";
import { useAcceptInvite } from "../../lib/jazz";
import { TodoList } from "../../lib/schema";
import LoadingSpinner from './LoadingSpinner';

interface InvitationsViewProps {
  inviteLink?: string;
}

export default function InvitationsView({ inviteLink }: InvitationsViewProps) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  // Use Jazz's invite acceptance hook
  useAcceptInvite({
    invitedObjectSchema: TodoList,
    onAccept: (valueId: string) => {
      setStatus('success');
      // Redirect to the accepted list after a short delay
      setTimeout(() => {
        window.location.hash = `/list/${valueId}`;
      }, 1500);
    },
    forValueHint: "todolist",
  });

  // Check for invite link in URL hash
  useEffect(() => {
    if (mounted) {
      const hash = window.location.hash;
      if (hash.includes('/invite/')) {
        setStatus('accepting');
        // The useAcceptInvite hook handles the actual acceptance
      }
    }
  }, [mounted]);

  // Prevent hydration mismatch
  if (!mounted) {
    return <LoadingSpinner />;
  }

  return (
    <div className="font-mono min-h-screen p-4 md:p-8 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md mx-auto text-center">
        <button
          onClick={() => window.location.hash = ''}
          className="mb-8 flex items-center space-x-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors border border-gray-300 dark:border-gray-600"
        >
          <span>←</span>
          <span>Back to Home</span>
        </button>

        {/* Status Messages */}
        {status === 'accepting' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-2">
              Accepting Invitation
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Please wait while we add you to the list...
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-green-200 dark:border-green-700 p-8">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">✓</span>
            </div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-2">
              Invitation Accepted!
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Redirecting to your new list...
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-red-200 dark:border-red-700 p-8">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-2">
              Invitation Failed
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {errorMessage || "The invite link may be invalid or expired."}
            </p>
            <button
              onClick={() => window.location.hash = ''}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Go to Your Lists
            </button>
          </div>
        )}

        {status === 'idle' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
            <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-4">
              No Invitation Detected
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              If you have an invite link, click it or paste it in your browser's address bar.
            </p>
            <button
              onClick={() => window.location.hash = ''}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Go to Your Lists
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
