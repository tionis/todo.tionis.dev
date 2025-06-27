"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();
  
  useEffect(() => {
    // For static exports, handle client-side routing for dynamic [slug] routes
    const path = window.location.pathname;
    
    // If the path looks like a todo list slug (not starting with known routes)
    if (path !== '/' && 
        !path.startsWith('/api') &&
        !path.startsWith('/_next') &&
        !path.includes('.')) {
      // Extract the slug (remove leading slash)
      const slug = path.substring(1);
      
      // Redirect to hash routing for the todo list
      window.location.href = `/#/list/${slug}`;
      return;
    }
  }, [router]);

  return (
    <div className="font-mono min-h-screen flex justify-center items-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full p-4 text-center">
        <h1 className="text-2xl mb-4 text-gray-900 dark:text-white">Page Not Found</h1>
        <p className="mb-4 text-gray-600 dark:text-gray-400">
          The page you're looking for doesn't exist.
        </p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
