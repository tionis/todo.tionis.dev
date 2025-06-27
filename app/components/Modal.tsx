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
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div 
        ref={modalRef}
        className={`bg-white dark:bg-gray-800 p-6 rounded-lg ${maxWidthClass} w-full mx-4 relative`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
          aria-label="Close modal"
        >
          ×
        </button>

        {/* Title */}
        {title && (
          <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white pr-8">
            {title}
          </h3>
        )}

        {/* Content */}
        <div className={title ? '' : 'pt-6'}>
          {children}
        </div>
      </div>
    </div>
  );
}
