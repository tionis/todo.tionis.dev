'use client';

interface LoadingSpinnerProps {
  message?: string;
  className?: string;
}

export default function LoadingSpinner({ 
  message = "Loading...", 
  className = "font-mono min-h-screen flex justify-center items-center" 
}: LoadingSpinnerProps) {
  return (
    <div className={className}>
      {message}
    </div>
  );
}
