import { db } from './db';

/**
 * Execute a database transaction with error handling and optional toast notifications
 */
export async function executeTransaction(
  transaction: any,
  errorMessage: string = "Operation failed",
  showToast: boolean = false
): Promise<boolean> {
  try {
    await db.transact(transaction);
    return true;
  } catch (error) {
    console.error(errorMessage, error);
    
    if (showToast && typeof window !== 'undefined') {
      // Dynamic import to avoid SSR issues
      import('../app/components/Toast').then(({ useToast }) => {
        // Note: This is a simplified approach. In a real app, you'd want a proper toast context
        console.error(errorMessage); // Fallback to console for now
      });
    }
    
    return false;
  }
}

/**
 * Handle common UI state for async operations
 */
export function createAsyncHandler<T extends any[]>(
  operation: (...args: T) => Promise<boolean>,
  setError?: (error: string | null) => void,
  setLoading?: (loading: boolean) => void,
  successMessage?: string
) {
  return async (...args: T) => {
    if (setLoading) setLoading(true);
    if (setError) setError(null);
    
    const success = await operation(...args);
    
    if (setLoading) setLoading(false);
    
    if (!success && setError) {
      setError("Operation failed. Please try again.");
    }
    
    return success;
  };
}

/**
 * Common permission checks
 */
export function canUserWrite(
  user: any,
  list: any,
  permission: string
): boolean {
  if (!user) return permission === 'public-write';
  
  const isOwner = list.owner?.id === user.id;
  const isMember = list.members?.some((m: any) => m.user?.id === user.id);
  
  switch (permission) {
    case 'public-write':
      return true;
    case 'private-write':
      return isOwner || isMember;
    case 'owner':
      return isOwner;
    default:
      return false;
  }
}

/**
 * Common permission checks for viewing
 */
export function canUserView(
  user: any,
  list: any,
  permission: string
): boolean {
  if (permission === 'public-read' || permission === 'public-write') {
    return true;
  }
  
  if (!user) return false;
  
  const isOwner = list.owner?.id === user.id;
  const isMember = list.members?.some((m: any) => m.user?.id === user.id);
  
  return isOwner || isMember;
}
