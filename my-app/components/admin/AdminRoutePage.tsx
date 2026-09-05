'use client';

import { useEffect, type ReactNode } from 'react';
import { useAdminPageTracking } from '@/hooks/useAdminPageTracking';

interface AdminRoutePageProps {
  /** Page title; also sets document.title. */
  title: string;
  /** Legacy dashboard tab id, kept for analytics continuity. */
  tabId: string;
  /** Analytics category (see the previous dashboard's category map). */
  category: string;
  children: ReactNode;
}

/**
 * Common wrapper for admin route pages: full-width content, document title,
 * and view tracking consistent with the previous single-page dashboard.
 */
export function AdminRoutePage({ title, tabId, category, children }: AdminRoutePageProps) {
  useEffect(() => {
    document.title = `${title} | UAR Admin`;
  }, [title]);
  useAdminPageTracking(`Admin Dashboard - ${tabId}`, category);
  return <div className="mx-auto w-full px-4 py-6 sm:px-6 lg:px-8">{children}</div>;
}

/**
 * Rendered when a page's capability module is disabled. The sidebar grays the
 * entry out; this covers direct navigation and stale links.
 */
export function ModuleDisabledNotice({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/40 p-8 text-center">
      <p className="text-sm font-medium text-foreground">{title} is currently disabled.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Enable the module under Admin Console &rsaquo; System Configuration &rsaquo; Modules.
      </p>
    </div>
  );
}
