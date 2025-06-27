"use client";

import React, { useState, useEffect } from "react";
import { id, User } from "@instantdb/react";
import { db } from "../../lib/db";
import { getListUrl } from "../../lib/utils";
import LoadingSpinner from './LoadingSpinner';
import ErrorDisplay from './ErrorDisplay';

interface InvitationsViewProps {}

export default function InvitationsView({}: InvitationsViewProps) {
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
        list: { owner: {} },
        inviter: {}
      }
    } : null
  );

  // Prevent hydration mismatch
  if (!mounted || authLoading || isLoading) {
    return <LoadingSpinner />;
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
            onClick={() => window.location.hash = ''}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorDisplay message={`Error loading invitations: ${error.message}`} />;
  }

  const invitations = data?.invitations || [];

  const acceptInvitation = async (invitation: any) => {
    if (!user) return;
    
    setProcessingInvitation(invitation.id);
    setFeedback(null);
    
    try {
      // Handle the list relationship which might be an array
      const listData = Array.isArray(invitation.list) ? invitation.list[0] : invitation.list;
      
      // The invited user might not have permission to see list details yet
      // In this case, we can still create the membership using the invitation's list reference
      let listId = listData?.id;
      let listName = listData?.name || "Unknown List";
      let listSlug = listData?.slug;
      
      if (!listId) {
        console.warn("Cannot access list data, likely due to permissions. Using alternative approach.");
        
        // In this case, we'll need to work with what we have in the invitation
        // The invitation should have a list reference even if we can't expand it
        
        // Check if there's a direct list property with just an ID
        if (invitation.list && typeof invitation.list === 'string') {
          listId = invitation.list;
        } else if (invitation.list && typeof invitation.list === 'object' && !Array.isArray(invitation.list) && invitation.list.id) {
          listId = invitation.list.id;
        }
        
        if (!listId) {
          throw new Error("Unable to determine list ID from invitation. The invitation may be corrupted or you may not have permission to access the list.");
        }
      }
      
      if (!listId) {
        throw new Error("Failed to determine list ID - cannot proceed with invitation acceptance");
      }
      
      // Create member record and update invitation status
      await db.transact([
        db.tx.listMembers[id()]
          .update({
            role: invitation.role,
            addedAt: new Date().toISOString()
          })
          .link({ 
            user: user.id,
            list: listId 
          }),
        db.tx.invitations[invitation.id].update({
          status: 'accepted'
        })
      ]);
      
      setFeedback({
        type: 'success',
        message: `Successfully joined "${listName}"!`
      });
      
      // Auto-hide success message and redirect after 2 seconds
      setTimeout(() => {
        if (listSlug) {
          window.location.hash = `/list/${listSlug}`;
        } else {
          // If we don't have the slug, just go back to home
          window.location.hash = '';
        }
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
      
      // Handle the list relationship which might be an array
      const listData = Array.isArray(invitation.list) ? invitation.list[0] : invitation.list;
      
      setFeedback({
        type: 'success',
        message: `Declined invitation to "${listData?.name || 'Unknown List'}".`
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
            onClick={() => window.location.hash = ''}
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
              onClick={() => window.location.hash = ''}
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
            
            {invitations.map((invitation) => {
              // Handle the list relationship which might be an array
              const listData = Array.isArray(invitation.list) ? invitation.list[0] : invitation.list;
              
              return (
              <div
                key={invitation.id}
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                      {listData?.name || 'Unknown List'}
                    </h3>
                    <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                      <p>
                        <span className="font-medium">Invited by:</span>{' '}
                        {(() => {
                          const inviterUser = Array.isArray(invitation.inviter) ? invitation.inviter[0] : invitation.inviter;
                          return inviterUser?.email || 'Unknown';
                        })()}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
