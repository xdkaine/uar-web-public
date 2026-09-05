'use client';

import Link from 'next/link';
import { PanelLeftOpen, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function AdminShellHeader({ canSearchRecords, shortcutLabel, mobileTriggerRef, onOpenNavigation, onOpenPalette }: { canSearchRecords: boolean; shortcutLabel: string; mobileTriggerRef: React.RefObject<HTMLButtonElement | null>; onOpenNavigation: () => void; onOpenPalette: () => void }) {
  return <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-8"><Button variant="ghost" size="sm" className="lg:hidden" onClick={onOpenNavigation} aria-label="Open navigation" ref={mobileTriggerRef}><PanelLeftOpen className="h-4 w-4" /></Button><button type="button" onClick={onOpenPalette} className="inline-flex h-9 min-w-0 max-w-md flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-accent sm:flex-none sm:w-72" aria-label="Open command palette"><Search className="h-3.5 w-3.5" /><span className="truncate">Jump to section…</span><kbd className="pointer-events-none ml-auto hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-foreground sm:inline-block">{shortcutLabel}</kbd></button>{canSearchRecords && <div className="ml-auto flex items-center gap-2"><Button asChild variant="outline" size="sm"><Link href="/admin/search" className="gap-1.5" aria-label="Search records"><Search className="h-3.5 w-3.5" /><span className="hidden sm:inline">Search records</span></Link></Button></div>}</header>;
}
