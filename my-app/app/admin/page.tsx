'use client';

import { Suspense, useEffect } from 'react';
import { redirect, useSearchParams } from 'next/navigation';
import * as m from 'framer-motion/m';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';
import { ChevronRight } from 'lucide-react';

import Link from 'next/link';
import { findAdminNavItemByTab, type AdminNavItem, type AdminNavSection } from '@/lib/admin/navigation';
import { useAdminNavigation } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/button';
import { useAdminPageTracking } from '@/hooks/useAdminPageTracking';

function OverviewSection({
  section,
  index,
  isModuleDisabled,
}: {
  section: AdminNavSection;
  index: number;
  isModuleDisabled: (item: AdminNavItem) => boolean;
}) {
  return (
    <m.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      aria-label={section.label}
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {section.label}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {section.items.map((item: AdminNavItem) => {
          const Icon = item.icon;
          const moduleDisabled = isModuleDisabled(item);
          const cardContent = (
            <>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
                  {item.label}
                  {!moduleDisabled && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {moduleDisabled ? 'Module disabled. Enable it in System Configuration to use this tool.' : item.description}
                </span>
              </span>
            </>
          );
          if (moduleDisabled) {
            return (
              <div
                key={item.id}
                aria-disabled="true"
                className="flex cursor-not-allowed items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 opacity-60"
              >
                {cardContent}
              </div>
            );
          }
          return (
            <Link
              key={item.id}
              href={item.href}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 hover:shadow-md"
            >
              {cardContent}
            </Link>
          );
        })}
      </div>
    </m.section>
  );
}

function AdminOverviewPageContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab');
  const navigation = useAdminNavigation();

  useAdminPageTracking('Admin Dashboard - overview', 'navigation');

  useEffect(() => {
    document.title = 'Admin Console | UAR Portal';
  }, []);

  // Legacy deep links (?tab=vpn) can only be resolved once the async
  // capability manifest is ready. redirect() prevents an effect-driven
  // navigation and preserves the authorization/module checks.
  const target = findAdminNavItemByTab(tab);
  const visibleItems = navigation?.visibleSections.flatMap((section) => section.items) ?? [];
  if (
    navigation?.state === 'ready'
    && target
    && visibleItems.some((item) => item.id === target.id)
    && !navigation.isModuleDisabled(target)
  ) {
    redirect(target.href);
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Admin Console
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything that keeps the portal running &mdash; operations, identity, configuration,
          and monitoring. Press{' '}
          <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-foreground">
            ⌘K
          </kbd>{' '}
          to jump anywhere.
        </p>
      </div>
      {navigation?.state === 'loading' && (
        <div aria-busy="true" className="space-y-8">
          <p className="text-sm text-muted-foreground">Loading the tools available to this account…</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-muted/50" />)}
          </div>
        </div>
      )}
      {navigation?.state === 'error' && (
        <div role="alert" className="max-w-xl rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <h2 className="font-semibold text-foreground">Admin navigation is unavailable</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {navigation.error ?? 'Refresh the navigation to see the tools available to this account.'}
          </p>
          <Button type="button" variant="outline" className="mt-4" onClick={navigation.retry}>Try again</Button>
        </div>
      )}
      {navigation?.state === 'ready' && (
        <div className="space-y-8">
          {navigation.visibleSections.map((section, index) => (
            <OverviewSection
              key={section.id}
              section={section}
              index={index}
              isModuleDisabled={navigation.isModuleDisabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminOverviewPage() {
  return (
    <LazyMotionBoundary>
      <Suspense fallback={<AdminOverviewLoading />}>
        <AdminOverviewPageContent />
      </Suspense>
    </LazyMotionBoundary>
  );
}

function AdminOverviewLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8" aria-busy="true">
      <p className="text-sm text-muted-foreground">Loading the tools available to this account…</p>
    </div>
  );
}
