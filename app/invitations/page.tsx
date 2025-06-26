"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { id } from "@instantdb/react";
import { db } from "../../lib/db";
import { getListUrl } from "../../lib/utils";

export default function InvitationsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { isLoading: authLoading, user, error: authError } = db.useAuth();
  const [processingInvitation, setProcessingInvitation] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Query for invitations sent to the current user's email
  const { isLoading, error, data } = db.useQuery(
    user ? {
      invitations: {
        $: { where: { email: user.email.toLowerCase(), status: 'pending' } },
        list: { owner: {} }
      }
    } : null
  );

  // Prevent hydration mismatch
  if (!mounted || authLoading || isLoading) {
    return (
      <div className="font-mono min-h-screen flex justify-center items-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-600 dark:text-gray-400">Loading invitations...</div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="font-mono min-h-screen flex justify-center items-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full p-4 text-center">
          <h1 className="text-2xl mb-4 text-gray-900 dark:text-white">Sign In Required</h1>
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            You need to sign in to view your invitations.
          </p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="font-mono min-h-screen flex justify-center items-center bg-gray-50 dark:bg-gray-900">
        <div className="text-red-500">Error loading invitations: {error.message}</div>
      </div>
    );
  }

  const invitations = data?.invitations || [];

  const acceptInvitation = async (invitation: any) => {
    if (!user) return;
    
    setProcessingInvitation(invitation.id);
    setFeedback(null);
    
    try {
      // Create member record and update invitation status
      await db.transact([
        db.tx.listMembers[id()]
          .update({
            role: invitation.role,
            addedAt: new Date().toISOString()
          })
          .link({ 
            user: user.id,
            list: invitation.list.id 
          }),
        db.tx.invitations[invitation.id].update({
          status: 'accepted'
        })
      ]);
      
      setFeedback({
        type: 'success',
        message: `Successfully joined "${invitation.list.name}"!`
      });
      
      // Auto-hide success message and redirect after 2 seconds
      setTimeout(() => {
        router.push(getListUrl(invitation.list.slug));
      }, 2000);
      
    } catch (err) {
      console.error("Failed to accept invitation:", err);
      setFeedback({
        type: 'error',
        message: "Failed to accept invitation. Please try again."
      });
    } finally {
      setProcessingInvitation(null);
    }
  };

  const declineInvitation = async (invitation: any) => {
    setProcessingInvitation(invitation.id);
    setFeedback(null);
    
    try {
      await db.transact(
        db.tx.invitations[invitation.id].update({
          status: 'declined'
        })
      );
      
      setFeedback({
        type: 'success',
        message: `Declined invitation to "${invitation.list.name}".`
      });
      
    } catch (err) {
      console.error("Failed to decline invitation:", err);
      setFeedback({
        type: 'error',
        message: "Failed to decline invitation. Please try again."
      });
    } finally {
      setProcessingInvitation(null);
    }
  };

  return (
    <div className="font-mono min-h-screen p-4 md:p-8 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center space-x-4 mb-6">
          <button
            onClick={() => router.push('/')}
            className="flex items-center space-x-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors border border-gray-300 dark:border-gray-600"
          >
            <span>←</span>
            <span>Back to Home</span>
          </button>
          <h1 className="text-3xl font-light tracking-wide text-gray-800 dark:text-gray-200">
            Your Invitations
          </h1>
        </div>

        {/* Feedback Messages */}
        {feedback && (
          <div className={`mb-6 p-4 rounded-lg border ${
            feedback.type === 'success' 
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
          }`}>
            {feedback.message}
          </div>
        )}

        {/* User Info */}
        <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Signed in as: <span className="font-medium text-gray-900 dark:text-white">{user?.email}</span>
          </p>
        </div>

        {/* Invitations List */}
        {invitations.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📭</div>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white mb-2">
              No pending invitations
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              You don't have any pending invitations at the moment.
            </p>
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Go to Your Lists
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Pending Invitations ({invitations.length})
            </h2>
            
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                      {invitation.list?.name || 'Unknown List'}
                    </h3>
                    <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                      <p>
                        <span className="font-medium">Invited by:</span>{' '}
                        {invitation.list?.owner?.email || 'Unknown'}
                      </p>
                      <p>
                        <span className="font-medium">Role:</span>{' '}
                        <span className="capitalize">{invitation.role}</span>
                      </p>
                      <p>
                        <span className="font-medium">Invited:</span>{' '}
                        {new Date(invitation.invitedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex space-x-3 ml-4">
                    <button
                      onClick={() => acceptInvitation(invitation)}
                      disabled={processingInvitation === invitation.id}
                      className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {processingInvitation === invitation.id ? 'Accepting...' : 'Accept'}
                    </button>
                    <button
                      onClick={() => declineInvitation(invitation)}
                      disabled={processingInvitation === invitation.id}
                      className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {processingInvitation === invitation.id ? 'Declining...' : 'Decline'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
