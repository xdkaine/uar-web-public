'use client';

import Link from 'next/link';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { AdminNavItem, AdminNavSection } from '@/lib/admin/navigation';

type NavigationLoadState = 'loading' | 'ready' | 'error';

interface NavigationBodyProps {
  state: NavigationLoadState;
  error: string | null;
  visibleSections: AdminNavSection[];
  pathname: string;
  collapsed: boolean;
  expanded?: boolean;
  onNavigate?: () => void;
  onRetry: () => void;
  isModuleDisabled: (item: AdminNavItem) => boolean;
}

function NavigationBody({ state, error, visibleSections, pathname, collapsed, expanded = false, onNavigate, onRetry, isModuleDisabled }: NavigationBodyProps) {
  if (state === 'loading') return <nav aria-busy="true" aria-label="Admin sections" className="flex-1 space-y-5 overflow-y-auto px-3 py-4"><p className="px-2.5 text-xs text-muted-foreground">Loading navigation…</p><div className="space-y-2 px-2.5" aria-hidden="true"><div className="h-8 rounded-md bg-muted/70" /><div className="h-8 rounded-md bg-muted/50" /><div className="h-8 rounded-md bg-muted/35" /></div></nav>;
  if (state === 'error') return <nav aria-label="Admin sections" className="flex-1 overflow-y-auto px-3 py-4"><div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium text-foreground">Navigation is unavailable</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{error ?? 'Refresh the navigation to see the tools available to this account.'}</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>Try again</Button></div></nav>;
  const compact = collapsed && !expanded;
  return <nav aria-label="Admin sections" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">{visibleSections.map((section) => <div key={section.id}>{!compact && <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{section.label}</p>}<ul className="space-y-0.5">{section.items.map((item) => <NavigationItem key={item.id} item={item} pathname={pathname} compact={compact} onNavigate={onNavigate} disabled={isModuleDisabled(item)} />)}</ul></div>)}</nav>;
}

function NavigationItem({ item, pathname, compact, onNavigate, disabled }: { item: AdminNavItem; pathname: string; compact: boolean; onNavigate?: () => void; disabled: boolean }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`); const Icon = item.icon;
  if (disabled) return <li><span aria-disabled="true" title={`${item.label} is disabled - enable the module in System Configuration`} className={cn('flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground opacity-50', compact && 'justify-center px-2')}><Icon className="h-4 w-4 shrink-0" />{!compact && <span className="truncate">{item.label}</span>}</span></li>;
  return <li><Link href={item.href} onClick={onNavigate} title={compact ? item.label : item.description} aria-current={active ? 'page' : undefined} className={cn('group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors', active ? 'bg-primary/10 font-medium text-foreground ring-1 ring-primary/20' : 'text-muted-foreground hover:bg-accent hover:text-foreground', compact && 'justify-center px-2')}><Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />{!compact && <span className="truncate">{item.label}</span>}</Link></li>;
}

export function AdminDesktopSidebar({ collapsed, onToggle, ...bodyProps }: NavigationBodyProps & { onToggle: () => void }) {
  return <aside data-collapsed={collapsed} className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card/60 backdrop-blur transition-[width] duration-200 lg:flex', collapsed ? 'w-[68px]' : 'w-64')}><NavigationBody {...bodyProps} collapsed={collapsed} /><div className="border-t border-border p-2"><button type="button" onClick={onToggle} className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', collapsed && 'justify-center px-2')} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" />Collapse</>}</button></div></aside>;
}

export function AdminMobileNavigation({ open, onOpenChange, onClose, ...bodyProps }: NavigationBodyProps & { open: boolean; onOpenChange: (open: boolean) => void; onClose: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent showCloseButton={false} className="!inset-y-0 !left-0 !top-0 !h-[100dvh] !w-72 !max-w-[calc(100vw-3rem)] !translate-x-0 !translate-y-0 !rounded-none !border-y-0 !border-l-0 !p-0 lg:hidden"><DialogTitle className="sr-only">Admin navigation</DialogTitle><aside className="flex h-full w-full flex-col bg-background"><div className="flex items-center justify-between border-b border-border px-3 py-2"><span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Navigation</span><Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close navigation"><X className="h-4 w-4" /></Button></div><NavigationBody {...bodyProps} expanded onNavigate={onClose} /></aside></DialogContent></Dialog>;
}
