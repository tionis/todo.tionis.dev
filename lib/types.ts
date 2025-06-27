// Common type definitions for the application
import type { User } from "@instantdb/react";

export interface TodoListPermission {
  permission: 'public-read' | 'public-write' | 'private-read' | 'private-write' | 'owner';
}

export interface TodoListMember {
  id: string;
  user?: {
    id: string;
    email?: string;
  };
  role: string;
  addedAt: string;
}

export interface TodoListInvitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'rejected';
  invitedAt: string;
  invitedBy?: {
    id: string;
    email?: string;
  };
}

export interface TodoListBasic {
  id: string;
  name: string;
  slug: string;
  permission: TodoListPermission['permission'];
  hideCompleted?: boolean;
  createdAt: string;
  updatedAt?: string;
  owner?: {
    id: string;
    email?: string;
  };
  members: TodoListMember[];
  invitations: TodoListInvitation[];
}

export interface FeedbackMessage {
  type: 'success' | 'error' | 'info';
  message: string;
}

export interface ModalState<T = any> {
  show: boolean;
  data?: T;
}

export interface AsyncOperationState {
  loading: boolean;
  error: string | null;
  success: boolean;
}

export interface OwnershipTransferState extends AsyncOperationState {
  selectedMemberId: string | null;
  showConfirmation: boolean;
}
