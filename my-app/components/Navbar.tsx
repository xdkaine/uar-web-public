'use client';

import React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { fetchWithCsrf, invalidateCsrfTokenCache } from '@/lib/csrf';
import { publishClientSessionState, type ClientSessionState } from '@/lib/client-session-state';
import PortalNav, { type PortalNavSessionState } from '@/components/PortalNav';
import { DEFAULT_APPEARANCE_THEME, DEFAULT_NAV_LINKS, type NavLinkConfig } from '@/lib/appearance';
import { useAppearance } from '@/lib/use-appearance';

const Navbar: React.FC = () => {
  const appearance = useAppearance();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const navLinks: NavLinkConfig[] = appearance.navLinks?.length
    ? appearance.navLinks
    : DEFAULT_NAV_LINKS;
  const logoUrl = appearance.theme?.logoUrl ?? DEFAULT_APPEARANCE_THEME.logoUrl;

  const publishSession = useCallback((state: Partial<ClientSessionState>) => {
    publishClientSessionState({
      isAuthenticated: Boolean(state.isAuthenticated),
      isAdmin: Boolean(state.isAdmin),
      username: state.username || '',
      displayName: state.displayName || state.username || '',
    });
  }, []);

  const fetchSession = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/auth/session', {
        signal,
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      if (!res.ok) throw new Error(`Session request failed: ${res.status}`);
      const data = await res.json();
      if (signal?.aborted) return;
      setIsAuthenticated(data.isAuthenticated);
      setIsAdmin(data.isAdmin);
      setUsername(data.username || '');
      setDisplayName(data.displayName || data.username || '');
      publishSession(data);
    } catch (error) {
      if (signal?.aborted) return;
      console.error('Failed to fetch session:', error);
      setIsAuthenticated(false);
      setIsAdmin(false);
      setUsername('');
      setDisplayName('');
      publishSession({ isAuthenticated: false });
    }
  }, [publishSession]);

  useEffect(() => {
    const controller = new AbortController();
    const refreshSession = () => fetchSession(controller.signal);
    const initialFetch = window.setTimeout(refreshSession, 0);
    const authChangeTimers = new Set<ReturnType<typeof setTimeout>>();

    const handleAuthChange = () => {
      const timer = setTimeout(() => {
        authChangeTimers.delete(timer);
        refreshSession();
      }, 100);
      authChangeTimers.add(timer);
    };

    window.addEventListener('authStateChanged', handleAuthChange);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshSession();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      controller.abort();
      window.clearTimeout(initialFetch);
      for (const timer of authChangeTimers) clearTimeout(timer);
      authChangeTimers.clear();
      window.removeEventListener('authStateChanged', handleAuthChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchSession]);

  const handleSignOut = async () => {
    try {
      await fetchWithCsrf('/api/auth/logout', { method: 'POST' });
      invalidateCsrfTokenCache();
      setIsAuthenticated(false);
      setIsAdmin(false);
      setUsername('');
      setDisplayName('');
      publishSession({ isAuthenticated: false });
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const sessionState: PortalNavSessionState = isAuthenticated
    ? isAdmin
      ? 'admin'
      : 'user'
    : 'anonymous';

  return (
    <PortalNav
      links={navLinks}
      sessionState={sessionState}
      displayName={displayName}
      username={username}
      onSignOut={handleSignOut}
      logoUrl={logoUrl}
    />
  );
};

export default Navbar;
