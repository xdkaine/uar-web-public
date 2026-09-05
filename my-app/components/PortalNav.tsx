'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  User,
  LogOut,
  Menu,
  ChevronDown,
  Cloud,
  Server,
  Network,
  MessageCircle,
  Home,
  Globe,
  LifeBuoy,
  Shield,
  Link2,
} from "lucide-react";
import type { NavLinkConfig } from '@/lib/appearance';
import NotificationBell from '@/components/NotificationBell';

export type PortalNavSessionState = 'anonymous' | 'user' | 'admin';

const SERVICE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Kamino: Cloud,
  Proxmox: Server,
  Uma: Network,
  Discord: MessageCircle,
};

function iconFor(link: NavLinkConfig): React.ComponentType<{ className?: string }> {
  if (SERVICE_ICONS[link.label]) return SERVICE_ICONS[link.label];
  if (link.href === '/') return Home;
  if (link.href === '/request/internal') return User;
  if (link.href === '/request/external') return Globe;
  if (link.href.startsWith('/support')) return LifeBuoy;
  if (link.href.startsWith('/admin')) return Shield;
  return Link2;
}

function isExternal(href: string) {
  return /^https?:\/\//i.test(href);
}

interface PortalNavProps {
  links: NavLinkConfig[];
  sessionState: PortalNavSessionState;
  displayName?: string;
  username?: string;
  onSignOut?: () => void;
  /** Disables navigation inside previews (admin appearance editor). */
  interactive?: boolean;
  logoUrl?: string;
}

const linkClasses =
  'text-white hover:bg-white/10 px-4 py-2 rounded-lg transition duration-300 font-medium flex items-center space-x-2';

const DEFAULT_SUPPORT_LINK: NavLinkConfig = {
  label: 'Support',
  href: '/support/tickets',
  section: 'main',
  requiresAuth: true,
};

function uniqueLinks(links: NavLinkConfig[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.section}:${link.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getNavigationLinks(links: NavLinkConfig[], isAuthenticated: boolean, isAdmin: boolean) {
  const visibleLinks = links.filter((link) => {
    if (link.requiresAdmin && !(isAuthenticated && isAdmin)) return false;
    if (link.requiresAuth && !isAuthenticated) return false;
    return true;
  });
  const configuredMainLinks = uniqueLinks(visibleLinks.filter((link) => link.section === 'main'));
  const mainLinks = isAuthenticated && !configuredMainLinks.some((link) => link.href === DEFAULT_SUPPORT_LINK.href)
    ? [...configuredMainLinks, DEFAULT_SUPPORT_LINK]
    : configuredMainLinks;
  return { mainLinks, serviceLinks: uniqueLinks(visibleLinks.filter((link) => link.section === 'services')) };
}

function PortalNavLink({ link, interactive, onClick, classNameExtra = '' }: { link: NavLinkConfig; interactive: boolean; onClick?: () => void; classNameExtra?: string }) {
  const classes = `${linkClasses} ${classNameExtra}`;
  if (isExternal(link.href)) {
    return <a href={interactive ? link.href : undefined} target="_blank" rel="noopener noreferrer" className={classes} onClick={onClick}>{React.createElement(iconFor(link), { className: 'h-5 w-5' })}<span>{link.label}</span></a>;
  }
  return <Link href={interactive ? link.href : '#'} className={classes} onClick={onClick}>{React.createElement(iconFor(link), { className: 'h-5 w-5' })}<span>{link.label}</span></Link>;
}

function AdminNavLink({ interactive, onClick }: { interactive: boolean; onClick?: () => void }) {
  return <Link href={interactive ? '/admin' : '#'} className="flex items-center space-x-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition duration-300 hover:bg-primary/90" onClick={onClick}><Shield className="h-5 w-5" /><span>Admin</span></Link>;
}

function DesktopAccountControls({ displayName, interactive, isAuthenticated, onSignOut, username }: { displayName?: string; interactive: boolean; isAuthenticated: boolean; onSignOut?: () => void; username?: string }) {
  if (!isAuthenticated) return <Link href={interactive ? '/login' : '#'} className={linkClasses}><User className="w-5 h-5" /><span>Sign In</span></Link>;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" disabled={!interactive} className="text-white hover:bg-white/10 hover:text-white px-4 py-2 h-auto font-medium space-x-2"><User className="w-5 h-5" /><span>{displayName || username}</span><ChevronDown className="w-4 h-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52"><DropdownMenuItem asChild><Link href="/profile"><User className="w-5 h-5" /><span>Profile</span></Link></DropdownMenuItem>{onSignOut && <DropdownMenuItem onSelect={() => onSignOut()} variant="destructive"><LogOut className="w-5 h-5" /><span>Sign Out</span></DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>;
}

/**
 * Presentational portal navigation. Renders the exact chrome visitors see for
 * a given session state; the live Navbar feeds it real state and the admin
 * appearance editor feeds it draft state for a true live preview.
 */
export default function PortalNav({
  links,
  sessionState,
  displayName,
  username,
  onSignOut,
  interactive = true,
  logoUrl = '/logo3og.png',
}: PortalNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAuthenticated = sessionState !== 'anonymous';
  const isAdmin = sessionState === 'admin';

  const { mainLinks, serviceLinks } = getNavigationLinks(links, isAuthenticated, isAdmin);

  return (
    <nav className="border-t-4 bg-neutral-950 p-4 shadow-lg" style={{ borderTopColor: 'var(--brand-accent)' }}>
      <div className="container mx-auto flex justify-between items-center">
        <div className="text-white text-2xl font-bold">
          <Link href={interactive ? '/' : '#'} aria-label="UAR Portal home">
            <Image
              src={logoUrl}
              alt="UAR Portal"
              width={75}
              height={75}
              className="hover:opacity-80 transition-opacity"
            />
          </Link>
        </div>

        <div className="hidden md:flex space-x-6 items-center">
          {mainLinks.map((link) => <PortalNavLink key={`${link.href}-${link.label}`} link={link} interactive={interactive} />)}
          {serviceLinks.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger className={linkClasses} disabled={!interactive}>
                <Cloud className="w-5 h-5" />
                <span>Services</span>
                <ChevronDown className="w-4 h-4 ml-1" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {serviceLinks.map((link) => {
                  const Icon = iconFor(link);
                  return (
                    <DropdownMenuItem key={`${link.href}-${link.label}`} asChild>
                      <a href={link.href} target="_blank" rel="noopener noreferrer">
                        <Icon className="w-4 h-4" />
                        <span className="font-medium">{link.label}</span>
                      </a>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isAuthenticated && isAdmin && <AdminNavLink interactive={interactive} />}
          {isAuthenticated && <NotificationBell enabled={interactive} />}
          <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
          <DesktopAccountControls displayName={displayName} interactive={interactive} isAuthenticated={isAuthenticated} onSignOut={onSignOut} username={username} />
        </div>

        <div className="md:hidden flex items-center gap-1">
          {isAuthenticated && <NotificationBell enabled={interactive} />}
          <ThemeToggle className="text-white hover:bg-white/10 hover:text-white" />
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-6 h-6" />
          </Button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden bg-neutral-950 px-4 py-2 rounded-lg mt-2 flex flex-col space-y-2 z-50">
          {mainLinks.map((link) => <PortalNavLink key={`${link.href}-${link.label}`} link={link} interactive={interactive} onClick={() => setMobileMenuOpen(false)} />)}

          {serviceLinks.length > 0 && (
            <>
              <div className="border-t border-white/10 my-2"></div>
              <p className="text-white/50 px-4 text-xs font-semibold uppercase tracking-wider">Services</p>
              {serviceLinks.map((link) => {
                const Icon = iconFor(link);
                return (
                  <a
                    key={`${link.href}-${link.label}-mobile`}
                    href={interactive ? link.href : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClasses}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{link.label}</span>
                  </a>
                );
              })}
            </>
          )}

          <div className="border-t border-white/10 my-2"></div>
          {isAuthenticated ? (
            <>
              <div className="text-white px-4 py-2 font-medium flex items-center space-x-2">
                <User className="w-5 h-5" />
                <span>Hello, {displayName || username}!</span>
              </div>
              <Link
                href={interactive ? '/profile' : '#'}
                className={linkClasses}
                onClick={() => setMobileMenuOpen(false)}
              >
                <User className="w-5 h-5" />
                <span>Profile</span>
              </Link>
              {isAdmin && <AdminNavLink interactive={interactive} onClick={() => setMobileMenuOpen(false)} />}
              {onSignOut && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onSignOut();
                  }}
                  className="w-full justify-start text-white hover:bg-white/10 hover:text-white px-4 py-2 h-auto font-medium"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Sign Out</span>
                </Button>
              )}
            </>
          ) : (
            <Link
              href={interactive ? '/login' : '#'}
              className={linkClasses}
              onClick={() => setMobileMenuOpen(false)}
            >
              <User className="w-5 h-5" />
              <span>Sign In</span>
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
