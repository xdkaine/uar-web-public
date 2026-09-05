'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import PortalPageHeading, { PortalPageHeadingView } from '@/components/appearance/PortalPageHeading';
import type { PageAppearanceId, PageContentConfig } from '@/lib/appearance';
import { cn } from '@/lib/utils';

type RequestKind = 'internal' | 'external';

function RequestWindow({ kind, heading, children, preview = false }: {
  kind: RequestKind;
  heading: ReactNode;
  children: ReactNode;
  preview?: boolean;
}) {
  return (
    <section className={cn('w-full border bg-card', preview ? 'rounded-lg shadow-sm' : 'rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.08)]')}>
      <div className="flex items-baseline justify-between border-b px-5 py-4 sm:px-8">
        <span className="text-sm font-semibold tracking-tight">Cal Poly SOC</span>
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {kind} access request
        </span>
      </div>
      <div className={cn('mx-auto max-w-xl', preview ? 'space-y-4 p-5' : 'space-y-6 px-5 py-7 sm:px-8 sm:py-9')}>
        {heading}
        {children}
      </div>
      <ol className="grid grid-cols-3 border-t text-center text-[11px] text-muted-foreground">
        {['1 · Details', '2 · Verify', '3 · Review'].map((step) => <li key={step} className="border-r px-2 py-3 last:border-r-0">{step}</li>)}
      </ol>
    </section>
  );
}

export function PublicRequestShell({ page, kind, children }: {
  page: Extract<PageAppearanceId, 'requestInternal' | 'requestExternal'>;
  kind: RequestKind;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-muted/20 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Portal home
        </Link>
        <RequestWindow kind={kind} heading={<PortalPageHeading page={page} />}>
          {children}
        </RequestWindow>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Need help? <a href="mailto:soc@cpp.edu" className="underline underline-offset-2 hover:text-foreground">soc@cpp.edu</a>
        </p>
      </div>
    </main>
  );
}

export function PublicRequestShellPreview({ content, kind }: { content: PageContentConfig; kind: RequestKind }) {
  return (
    <RequestWindow kind={kind} preview heading={<PortalPageHeadingView content={content} />}>
      <div className="space-y-3" aria-hidden="true">
        <div><div className="mb-1.5 h-3 w-20 rounded bg-muted-foreground/25" /><div className="h-9 rounded-md border bg-background" /></div>
        <div><div className="mb-1.5 h-3 w-28 rounded bg-muted-foreground/25" /><div className="h-9 rounded-md border bg-background" /></div>
        <div className="h-10 rounded-md bg-primary" />
      </div>
    </RequestWindow>
  );
}
