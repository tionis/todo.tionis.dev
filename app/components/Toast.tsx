'use client';

import { useState, useEffect } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type'], duration?: number) => void;
  removeToast: (id: string) => void;
}

let toastId = 0;

// Simple toast state management
let toastState: Toast[] = [];
let listeners: ((toasts: Toast[]) => void)[] = [];

const notifyListeners = () => {
  listeners.forEach(listener => listener(toastState));
};

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>(toastState);

  useEffect(() => {
    const listener = (newToasts: Toast[]) => setToasts(newToasts);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter(l => l !== listener);
    };
  }, []);

  const addToast = (message: string, type: Toast['type'] = 'info', duration = 5000) => {
    const id = `toast-${++toastId}`;
    const toast: Toast = { id, message, type, duration };
    
    toastState = [...toastState, toast];
    notifyListeners();
    
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  };

  const removeToast = (id: string) => {
    toastState = toastState.filter(toast => toast.id !== id);
    notifyListeners();
  };

  return { toasts, addToast, removeToast };
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            px-4 py-3 rounded-lg shadow-lg max-w-sm cursor-pointer transition-all duration-300
            ${toast.type === 'success' ? 'bg-green-500 text-white' : ''}
            ${toast.type === 'error' ? 'bg-red-500 text-white' : ''}
            ${toast.type === 'info' ? 'bg-blue-500 text-white' : ''}
          `}
          onClick={() => removeToast(toast.id)}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{toast.message}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeToast(toast.id);
              }}
              className="ml-2 text-white/70 hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
