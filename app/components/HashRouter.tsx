"use client";

import { useEffect, useState } from 'react';

interface Route {
  path: string;
  component: React.ComponentType<any>;
  props?: any;
}

export function useHashRouter(routes: Route[]) {
  const [currentRoute, setCurrentRoute] = useState<Route | null>(null);
  const [routeParams, setRouteParams] = useState<any>({});

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1); // Remove the # character
      
      if (!hash || hash === '/') {
        setCurrentRoute(null);
        setRouteParams({});
        return;
      }

      // Check for /list/:slug pattern
      const listMatch = hash.match(/^\/list\/(.+)$/);
      if (listMatch) {
        const slug = decodeURIComponent(listMatch[1]);
        const route = routes.find(r => r.path === '/list/:slug');
        if (route) {
          setCurrentRoute(route);
          setRouteParams({ slug });
          return;
        }
      }

      // Check for exact matches
      const exactRoute = routes.find(r => r.path === hash);
      if (exactRoute) {
        setCurrentRoute(exactRoute);
        setRouteParams({});
      } else {
        setCurrentRoute(null);
        setRouteParams({});
      }
    };

    // Handle initial load
    handleHashChange();

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);
    
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [routes]);

  const navigate = (path: string) => {
    window.location.hash = path;
  };

  return { currentRoute, routeParams, navigate };
}
