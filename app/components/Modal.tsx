'use client';

import React, { useEffect, useRef } from 'react';

interface ModalProps {
  children: React.ReactNode;
  onClose: () => void;
  title?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
}

export default function Modal({ children, onClose, title, maxWidth = 'md' }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Handle click outside
  const handleBackdropClick = (event: React.MouseEvent) => {
    if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
      onClose();
    }
  };

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl'
  }[maxWidth];

  return (
    <div 
      className="fixed inset-0 bg-slate-100 dark:bg-slate-900 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div 
        ref={modalRef}
        className={`bg-white dark:bg-gray-800 rounded-lg ${maxWidthClass} w-full relative max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden shadow-xl`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none z-10"
          aria-label="Close modal"
        >
          ×
        </button>

        {/* Title */}
        {title && (
          <h3 className="text-lg font-bold text-gray-900 dark:text-white pr-8 px-6 pt-6 pb-4 shrink-0">
            {title}
          </h3>
        )}

        {/* Content */}
        <div className={`${title ? 'px-6 pb-6' : 'p-6'} overflow-y-auto min-h-0`}>
          {children}
        </div>
      </div>
    </div>
  );
}
