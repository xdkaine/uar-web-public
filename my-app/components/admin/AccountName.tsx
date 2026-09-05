'use client';

import { useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** A readable label with the exact account identity on hover, focus, or tap. */
export function AccountName({ username, displayName, className }: {
  username: string | null | undefined;
  displayName?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const show = () => { if (timer.current) clearTimeout(timer.current); setOpen(true); };
  const hide = () => { timer.current = setTimeout(() => setOpen(false), 120); };
  if (!username) return <span className={className}>{displayName?.trim() || '—'}</span>;
  const label = displayName?.trim() || username;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className={cn('max-w-full truncate rounded-sm text-left font-medium underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
        aria-label={`${label} — account ${username}`} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
        {label}
      </button>
    </PopoverTrigger>
    <PopoverContent aria-label={`${label} account username`} side="top" align="start" className="w-auto max-w-xs px-3 py-2 text-xs" onMouseEnter={show} onMouseLeave={hide}
      onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <span className="block text-muted-foreground">Account username</span>
      <span className="mt-0.5 block break-all font-mono">{username}</span>
    </PopoverContent>
  </Popover>;
}
