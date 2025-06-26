'use client';

interface ErrorDisplayProps {
  message: string;
  className?: string;
}

export default function ErrorDisplay({ 
  message, 
  className = "font-mono min-h-screen flex justify-center items-center text-red-500" 
}: ErrorDisplayProps) {
  return (
    <div className={className}>
      Error: {message}
    </div>
  );
}
