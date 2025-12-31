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

      // Check for /list/:id pattern (Jazz CoValue IDs)
      const listMatch = hash.match(/^\/list\/(.+)$/);
      if (listMatch) {
        const id = decodeURIComponent(listMatch[1]);
        const route = routes.find(r => r.path === '/list/:id');
        if (route) {
          setCurrentRoute(route);
          setRouteParams({ id });
          return;
        }
      }

      // Check for /invite/:inviteLink pattern (Jazz invite links)
      const inviteMatch = hash.match(/^\/invite\/(.+)$/);
      if (inviteMatch) {
        const inviteLink = decodeURIComponent(inviteMatch[1]);
        const route = routes.find(r => r.path === '/invite/:inviteLink');
        if (route) {
          setCurrentRoute(route);
          setRouteParams({ inviteLink });
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
