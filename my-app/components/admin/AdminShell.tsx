'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getVisibleAdminNavDestinations, getVisibleAdminNavSections, isAdminNavItemModuleDisabled, type AdminNavItem, type AdminNavSection } from '@/lib/admin/navigation';
import { AdminShellCommandPalette } from './AdminShellCommandPalette';
import { AdminShellHeader } from './AdminShellHeader';
import { AdminDesktopSidebar, AdminMobileNavigation } from './AdminShellNavigation';

const SIDEBAR_COLLAPSED_KEY = 'uar.admin.sidebarCollapsed';
const sidebarCollapsedStore = {
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); },
  getSnapshot(): boolean { return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; },
  getServerSnapshot(): boolean { return false; },
  set(value: boolean) { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0'); this.listeners.forEach((listener) => listener()); },
};

interface AdminShellProps { children: React.ReactNode; }
type NavigationLoadState = 'loading' | 'ready' | 'error';
export interface AdminNavigationContextValue { state: NavigationLoadState; error: string | null; visibleSections: AdminNavSection[]; isModuleDisabled: (item: AdminNavItem) => boolean; canSearchRecords: boolean; permissions: ReadonlySet<string>; retry: () => void; }
const AdminNavigationContext = createContext<AdminNavigationContextValue | null>(null);
export function useAdminNavigation() { return useContext(AdminNavigationContext); }

export default function AdminShell({ children }: AdminShellProps) {
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams(); const searchKey = searchParams.toString();
  const { permissions, disabledModules, navigationState, navigationError, retryNavigation } = useAdminNavigationState(); const [mobileOpen, setMobileOpen] = useState(false); const [paletteOpen, setPaletteOpen] = useState(false);
  const collapsed = useSyncExternalStore(sidebarCollapsedStore.subscribe.bind(sidebarCollapsedStore), sidebarCollapsedStore.getSnapshot.bind(sidebarCollapsedStore), sidebarCollapsedStore.getServerSnapshot.bind(sidebarCollapsedStore));
  const mainContentRef = useRef<HTMLDivElement>(null); const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const toggleCollapsed = useCallback(() => sidebarCollapsedStore.set(!sidebarCollapsedStore.getSnapshot()), []);
  usePaletteShortcut(setPaletteOpen);
  const visibleSections = useMemo(() => navigationState === 'ready' ? getVisibleAdminNavSections(permissions) : [], [navigationState, permissions]);
  const visibleDestinations = useMemo(() => navigationState === 'ready' ? getVisibleAdminNavDestinations(permissions, disabledModules) : [], [disabledModules, navigationState, permissions]);
  const navItemsById = useMemo(() => { const itemsById = new Map<string, AdminNavItem>(); for (const section of visibleSections) for (const item of section.items) itemsById.set(item.id, item); return itemsById; }, [visibleSections]);
  const isModuleDisabled = useCallback((item: AdminNavItem) => isAdminNavItemModuleDisabled(item, disabledModules), [disabledModules]);
  const closeMobileNavigation = useCallback(() => { setMobileOpen(false); window.requestAnimationFrame(() => mobileTriggerRef.current?.focus()); }, []);
  useMobileNavigationLock(mobileOpen, mainContentRef);
  useDeepLinkFocus(pathname, searchKey);
  const navigate = useCallback((href: string) => { setPaletteOpen(false); if (mobileOpen) closeMobileNavigation(); router.push(href); }, [closeMobileNavigation, mobileOpen, router]);
  const navigationContext = useMemo<AdminNavigationContextValue>(() => ({ state: navigationState, error: navigationError, visibleSections, isModuleDisabled, canSearchRecords: navigationState === 'ready' && permissions.has('admin.search'), permissions, retry: retryNavigation }), [isModuleDisabled, navigationError, navigationState, permissions, retryNavigation, visibleSections]);
  const navigationProps = { state: navigationState, error: navigationError, visibleSections, pathname, collapsed, onRetry: retryNavigation, isModuleDisabled };
  return <AdminNavigationContext.Provider value={navigationContext}><div className="flex min-h-screen bg-background text-foreground"><AdminDesktopSidebar {...navigationProps} onToggle={toggleCollapsed} /><AdminMobileNavigation {...navigationProps} open={mobileOpen} onOpenChange={(open) => open ? setMobileOpen(true) : closeMobileNavigation()} onClose={closeMobileNavigation} /><div className="flex min-w-0 flex-1 flex-col"><AdminShellHeader canSearchRecords={navigationContext.canSearchRecords} shortcutLabel="Ctrl/⌘ K" mobileTriggerRef={mobileTriggerRef} onOpenNavigation={() => setMobileOpen(true)} onOpenPalette={() => setPaletteOpen(true)} /><div ref={mainContentRef} className="min-w-0 flex-1">{children}</div></div><AdminShellCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} state={navigationState} error={navigationError} sections={visibleSections} destinations={visibleDestinations} itemsById={navItemsById} onRetry={retryNavigation} onNavigate={navigate} isModuleDisabled={isModuleDisabled} /></div></AdminNavigationContext.Provider>;
}

function useAdminNavigationState() {
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [disabledModules, setDisabledModules] = useState<Set<string>>(new Set());
  const [navigationState, setNavigationState] = useState<NavigationLoadState>('loading');
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  useEffect(() => { let cancelled = false; const loadNavigation = async () => { try { const [sessionResponse, modulesResponse] = await Promise.all([fetch('/api/auth/session', { cache: 'no-store' }), fetch('/api/admin/modules', { cache: 'no-store' })]); if (!sessionResponse.ok || !modulesResponse.ok) throw new Error('Unable to load the navigation available to this account.'); const [session, moduleState] = await Promise.all([sessionResponse.json() as Promise<{ permissions?: unknown }>, modulesResponse.json() as Promise<{ modules?: unknown }>]); if (!Array.isArray(session.permissions) || !Array.isArray(moduleState.modules)) throw new Error('The navigation response was incomplete.'); const disabledModuleIds = new Set<string>(); for (const moduleRecord of moduleState.modules) { if (!moduleRecord || typeof moduleRecord !== 'object') continue; const candidate = moduleRecord as { moduleId?: unknown; enabled?: unknown }; if (typeof candidate.moduleId === 'string' && candidate.enabled === false) disabledModuleIds.add(candidate.moduleId); } if (cancelled) return; setPermissions(new Set(session.permissions.filter((permission): permission is string => typeof permission === 'string'))); setDisabledModules(disabledModuleIds); setNavigationState('ready'); } catch (error) { if (cancelled) return; setPermissions(new Set()); setDisabledModules(new Set()); setNavigationState('error'); setNavigationError(error instanceof Error ? error.message : 'Unable to load navigation.'); } }; void loadNavigation(); return () => { cancelled = true; }; }, [loadVersion]);
  const retryNavigation = useCallback(() => { setNavigationState('loading'); setNavigationError(null); setLoadVersion((version) => version + 1); }, []);
  return { permissions, disabledModules, navigationState, navigationError, retryNavigation };
}

function usePaletteShortcut(setPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>) { useEffect(() => { const down = (event: KeyboardEvent) => { if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setPaletteOpen((open) => !open); } }; document.addEventListener('keydown', down); return () => document.removeEventListener('keydown', down); }, [setPaletteOpen]); }
function useMobileNavigationLock(mobileOpen: boolean, mainContentRef: React.RefObject<HTMLDivElement | null>) { useEffect(() => { if (!mobileOpen) return; const main = mainContentRef.current; const previousOverflow = document.body.style.overflow; const mainWasInert = main?.hasAttribute('inert') ?? false; document.body.style.overflow = 'hidden'; if (main) main.setAttribute('inert', ''); return () => { document.body.style.overflow = previousOverflow; if (main && !mainWasInert) main.removeAttribute('inert'); }; }, [mobileOpen, mainContentRef]); }
function useDeepLinkFocus(pathname: string, searchKey: string) { useEffect(() => { let frame = 0; let attempts = 0; const focusTarget = () => { const rawTarget = window.location.hash.slice(1); if (!rawTarget) return; let targetId = rawTarget; try { targetId = decodeURIComponent(rawTarget); } catch { /* Keep literal invalid percent encoding. */ } const target = document.getElementById(targetId); if (!target) { if (attempts++ < 90) frame = window.requestAnimationFrame(focusTarget); return; } if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1'); const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); target.focus({ preventScroll: true }); }; const start = () => { window.cancelAnimationFrame(frame); attempts = 0; frame = window.requestAnimationFrame(focusTarget); }; start(); window.addEventListener('hashchange', start); return () => { window.removeEventListener('hashchange', start); window.cancelAnimationFrame(frame); }; }, [pathname, searchKey]); }
