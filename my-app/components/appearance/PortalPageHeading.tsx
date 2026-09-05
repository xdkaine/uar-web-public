'use client';

import type { ReactNode } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  PAGE_APPEARANCE_REGISTRY,
  segmentHomeSubtitle,
  type PageAppearanceId,
  type PageContentConfig,
} from '@/lib/appearance';
import { useAppearance } from '@/lib/use-appearance';
import { cn } from '@/lib/utils';
import { ManagedPageRegion } from './ManagedPageRegion';

export function PortalPageHeadingView({
  content,
  action,
  centered = false,
  variant = 'default',
  className,
}: {
  content: PageContentConfig;
  action?: ReactNode;
  centered?: boolean;
  variant?: 'default' | 'home';
  className?: string;
}) {
  const isHome = variant === 'home';

  return (
    <div className={cn('space-y-3', centered && 'text-center', className)}>
      <div className={cn('flex flex-wrap items-start justify-between gap-4', centered && 'justify-center')}>
        <div>
          <h1
            className={cn(
              'font-bold',
              isHome
                ? 'mb-3 px-2 text-2xl leading-tight text-yellow-800 dark:text-yellow-300 sm:mb-4 sm:text-3xl md:text-4xl lg:text-5xl'
                : 'text-2xl tracking-tight text-foreground sm:text-3xl'
            )}
          >
            {content.title}
          </h1>
          <p
            className={cn(
              'max-w-3xl leading-relaxed',
              isHome
                ? 'mx-auto px-4 text-sm text-gray-700 dark:text-gray-300 sm:text-base md:text-lg'
                : 'mt-1 text-sm text-muted-foreground sm:text-base'
            )}
          >
            {isHome
              ? segmentHomeSubtitle(content.subtitle).map((segment, index) =>
                  segment.href ? (
                    <a
                      key={`${segment.href}-${index}`}
                      href={segment.href}
                      className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {segment.text}
                    </a>
                  ) : (
                    <span key={`text-${index}`}>{segment.text}</span>
                  )
                )
              : content.subtitle}
          </p>
        </div>
        {action}
      </div>
      {content.notice && (
        <Alert className="border-amber-500/30 bg-amber-500/10 text-left">
          <AlertDescription className="whitespace-pre-wrap">{content.notice}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default function PortalPageHeading({
  page,
  action,
  centered,
  className,
  title,
  subtitle,
}: {
  page: PageAppearanceId;
  action?: ReactNode;
  centered?: boolean;
  className?: string;
  title?: string;
  subtitle?: string;
}) {
  const appearance = useAppearance();
  const configured = appearance.pages?.[page];
  const fallback = PAGE_APPEARANCE_REGISTRY[page].defaultContent;
  return (
    <div className="space-y-5">
      <PortalPageHeadingView
        content={{
          title: title ?? configured?.title ?? fallback.title,
          subtitle: subtitle ?? configured?.subtitle ?? fallback.subtitle,
          notice: configured?.notice,
        }}
        action={action}
        centered={centered}
        variant={page === 'home' ? 'home' : 'default'}
        className={className}
      />
      <ManagedPageRegion document={appearance.managedPages?.[page]} />
    </div>
  );
}
