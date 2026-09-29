"use client";

import { useState } from 'react';
import { type User } from '../../../lib/db';
import { userDisplayName } from '../../../shared/identity.mjs';

export function OnlineUsersTooltip({ 
  currentUser, 
  peers, 
  numUsers,
  myPresence
}: { 
  currentUser: User | null; 
  peers: Record<string, any>; 
  numUsers: number;
  myPresence: any;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  


  const allUsers = [
    ...(currentUser && myPresence ? [{
      id: currentUser.id,
      name: myPresence.name || userDisplayName(currentUser),
      isCurrentUser: true
    }] : []),
    ...Object.entries(peers).map(([peerId, peer]) => ({
      id: peerId,
      name: peer.name || "Anonymous",
      isCurrentUser: false
    }))
  ];

  return (
    <div className="relative">
      <span 
        className="flex items-center space-x-1 cursor-help"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
        <span>{numUsers} online</span>
      </span>
      
      {showTooltip && (
        <div className="absolute bottom-full left-0 mb-2 z-50">
          <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg py-2 px-3 shadow-lg whitespace-nowrap">
            <div className="font-medium mb-1">Online users:</div>
            {allUsers.map((user) => (
              <div key={user.id} className="flex items-center space-x-2 py-0.5">
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full flex-shrink-0"></div>
                <span className={user.isCurrentUser ? 'font-medium' : ''}>
                  {user.name}{user.isCurrentUser ? ' (You)' : ''}
                </span>
              </div>
            ))}
            {allUsers.length === 0 && (
              <div className="text-gray-400">No users online</div>
            )}
            {/* Tooltip arrow */}
            <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900 dark:border-t-gray-700"></div>
          </div>
        </div>
      )}
    </div>
  );
}
