/**
 * Portal appearance configuration (ADR-0005 registry keys `nav.links`,
 * `pages.requestInternal`, `pages.requestExternal`). Operators may override
 * the navbar and the copy on the access-request pages; everything falls back
 * to the built-in defaults below when nothing is configured. Only safe,
 * non-secret strings live here.
 */

export type NavSection = 'main' | 'services';

export interface NavLinkConfig {
  label: string;
  /** Internal route (starts with /) or absolute URL. */
  href: string;
  section: NavSection;
  requiresAuth?: boolean;
  requiresAdmin?: boolean;
}

export interface PageContentConfig {
  title: string;
  subtitle: string;
  notice?: string;
}

export interface AppearanceThemeConfig {
  logoUrl: string;
  brandAccent: string;
  radius: 'compact' | 'standard' | 'soft';
}

export const HOME_SUBTITLE_LINKS = [
  {
    text: 'Mitchell C. Hill Student Data Center',
    href: 'https://www.cpp.edu/cba/digital-innovation/index.shtml',
  },
  {
    text: 'Student Directors of the SOC & SDC',
    href: 'https://www.calpolysoc.org/team',
  },
] as const;

export type HomeSubtitleSegment = {
  text: string;
  href?: string;
};

const LEGACY_HOME_DEFAULT_CONTENT: PageContentConfig = {
  title: 'User Access Request Portal',
  subtitle: 'Request and manage access to Student Data Center resources.',
};

/** Adds the production institutional links without interpreting editor copy as HTML. */
export function segmentHomeSubtitle(subtitle: string): HomeSubtitleSegment[] {
  const segments: HomeSubtitleSegment[] = [];
  let remaining = subtitle;

  while (remaining) {
    const nextLink = HOME_SUBTITLE_LINKS
      .map((link) => ({ ...link, index: remaining.indexOf(link.text) }))
      .filter((link) => link.index >= 0)
      .sort((left, right) => left.index - right.index)[0];

    if (!nextLink) {
      segments.push({ text: remaining });
      break;
    }

    if (nextLink.index > 0) {
      segments.push({ text: remaining.slice(0, nextLink.index) });
    }
    segments.push({ text: nextLink.text, href: nextLink.href });
    remaining = remaining.slice(nextLink.index + nextLink.text.length);
  }

  return segments;
}

export const DEFAULT_APPEARANCE_THEME: AppearanceThemeConfig = {
  logoUrl: '/logo3og.png', brandAccent: '#F2B705', radius: 'standard',
};

export function validateAppearanceTheme(value: unknown): AppearanceThemeConfig {
  if (typeof value === 'string') value = JSON.parse(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('appearance.theme must be a JSON object');
  const raw = value as Record<string, unknown>;
  const logoUrl = typeof raw.logoUrl === 'string' ? raw.logoUrl.trim() : DEFAULT_APPEARANCE_THEME.logoUrl;
  if (!/^\/(?!\/)[\w./-]+$/.test(logoUrl)) throw new Error('Theme logo must be a portal asset path');
  const brandAccent = typeof raw.brandAccent === 'string' ? raw.brandAccent.toUpperCase() : DEFAULT_APPEARANCE_THEME.brandAccent;
  if (!/^#[0-9A-F]{6}$/.test(brandAccent)) throw new Error('Brand accent must be a six-digit hex color');
  return {
    logoUrl, brandAccent,
    radius: raw.radius === 'compact' || raw.radius === 'soft' ? raw.radius : 'standard',
  };
}

export const PAGE_APPEARANCE_REGISTRY = {
  home: { key: 'pages.home', route: '/', label: 'Home', defaultContent: { title: 'User Access Request Portal', subtitle: 'Request access for the Mitchell C. Hill Student Data Center resources which are monitored and managed by the Student Directors of the SOC & SDC.' } },
  requestInternal: { key: 'pages.requestInternal', route: '/request/internal', label: 'Internal request', defaultContent: { title: 'Internal Access Request', subtitle: "Request an account to be created for Kamino, Proxmox, or the SDC Domains. Use this form if you're an internal student director or staff member.", notice: 'Cal Poly Pomona students must submit both this request and the matching CPP ServiceNow request.' } },
  requestExternal: { key: 'pages.requestExternal', route: '/request/external', label: 'External request', defaultContent: { title: 'External Access Request', subtitle: 'Request VPN or server access as an external collaborator. Your sponsor will be asked to confirm your request before provisioning begins.' } },
  supportTickets: { key: 'pages.supportTickets', route: '/support/tickets', label: 'Support queue', defaultContent: { title: 'My Tickets', subtitle: 'Track your support requests and group-assigned work in one queue.' } },
  supportCreate: { key: 'pages.supportCreate', route: '/support/create', label: 'Create ticket', defaultContent: { title: 'Create a Support Ticket', subtitle: 'Tell the support team what happened and include the details needed to investigate.' } },
  supportTicketDetail: { key: 'pages.supportTicketDetail', route: '/support/tickets/:id', label: 'Ticket detail', defaultContent: { title: 'Support Ticket', subtitle: 'Review ownership, conversation, and supporting evidence.' } },
  profile: { key: 'pages.profile', route: '/profile', label: 'Profile', defaultContent: { title: 'My Profile', subtitle: 'Review your identity, access, and account information.' } },
} as const satisfies Record<string, {
  key: `pages.${string}`;
  route: string;
  label: string;
  defaultContent: PageContentConfig;
}>;

export type PageAppearanceId = keyof typeof PAGE_APPEARANCE_REGISTRY;
export const PAGE_APPEARANCE_IDS = Object.keys(PAGE_APPEARANCE_REGISTRY) as PageAppearanceId[];
export const PAGE_APPEARANCE_KEYS = PAGE_APPEARANCE_IDS.map((id) => PAGE_APPEARANCE_REGISTRY[id].key);

/**
 * Treat the former built-in home copy as a baseline, not an operator override.
 * This lets upgraded installations adopt the production landing baseline while
 * preserving every genuinely customized title, subtitle, or notice.
 */
export function normalizeLegacyPageContent(
  page: PageAppearanceId,
  content: PageContentConfig
): PageContentConfig {
  if (
    page === 'home'
    && content.title === LEGACY_HOME_DEFAULT_CONTENT.title
    && content.subtitle === LEGACY_HOME_DEFAULT_CONTENT.subtitle
    && !content.notice
  ) {
    return { ...PAGE_APPEARANCE_REGISTRY.home.defaultContent };
  }
  return content;
}

export const DEFAULT_NAV_LINKS: NavLinkConfig[] = [
  { label: 'Home', href: '/', section: 'main' },
  { label: 'Internal', href: '/request/internal', section: 'main' },
  { label: 'External', href: '/request/external', section: 'main' },
  { label: 'Kamino', href: 'https://kamino.sdc.cpp', section: 'services' },
  { label: 'Proxmox', href: 'https://proxmox.sdc.cpp', section: 'services' },
  { label: 'Uma', href: 'https://uma.sdc.cpp', section: 'services' },
  { label: 'Discord', href: 'https://discord.gg/6smequDTHM', section: 'services' },
  { label: 'Support', href: '/support/tickets', section: 'main', requiresAuth: true },
];

export const DEFAULT_REQUEST_INTERNAL_CONTENT: PageContentConfig = {
  ...PAGE_APPEARANCE_REGISTRY.requestInternal.defaultContent,
};

export const DEFAULT_REQUEST_EXTERNAL_CONTENT: PageContentConfig = {
  ...PAGE_APPEARANCE_REGISTRY.requestExternal.defaultContent,
};

const MAX_LINKS = 24;

function validateLabel(value: unknown): string {
  const label = typeof value === 'string' ? value.trim() : '';
  if (!label || label.length > 60) {
    throw new Error('Nav link labels must be 1-60 characters');
  }
  return label;
}

function validateHref(value: unknown): string {
  const href = typeof value === 'string' ? value.trim() : '';
  if (!href || href.length > 400) {
    throw new Error('Nav link targets must be 1-400 characters');
  }
  const isInternal = href.startsWith('/') && !href.startsWith('//');
  const isHttpUrl = /^https:\/\//i.test(href);
  if (!isInternal && !isHttpUrl) {
    throw new Error('Nav link targets must be internal paths (/...) or https:// URLs');
  }
  return href;
}

/** Validates a raw nav-links value (parsed JSON array) into canonical form. */
export function validateNavLinks(value: unknown): NavLinkConfig[] {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('nav.links contains invalid JSON');
    }
  }
  if (value === null || value === undefined || value === '') {
    return []; // empty means "use defaults"
  }
  if (!Array.isArray(value)) {
    throw new Error('nav.links must be a JSON array of link objects');
  }
  if (value.length > MAX_LINKS) {
    throw new Error(`nav.links allows at most ${MAX_LINKS} entries`);
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Each nav link must be an object');
    }
    const record = entry as Record<string, unknown>;
    const section = record.section === 'services' ? 'services' : 'main';
    return {
      label: validateLabel(record.label),
      href: validateHref(record.href),
      section,
      requiresAuth: record.requiresAuth === true,
      requiresAdmin: record.requiresAdmin === true,
    };
  });
}

export function validatePageContent(key: string, value: unknown): PageContentConfig {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error(`${key} contains invalid JSON`);
    }
  }
  if (value === null || value === undefined || value === '') {
    return { title: '', subtitle: '' }; // empty means "use defaults"
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const subtitle = typeof record.subtitle === 'string' ? record.subtitle.trim() : '';
  const notice = typeof record.notice === 'string' ? record.notice.trim() : '';
  if (title.length > 120) throw new Error(`${key}.title must be at most 120 characters`);
  if (subtitle.length > 400) throw new Error(`${key}.subtitle must be at most 400 characters`);
  if (notice.length > 800) throw new Error(`${key}.notice must be at most 800 characters`);
  return { title, subtitle, notice: notice || undefined };
}

export function validateRegisteredPageContent(key: string, value: unknown): PageContentConfig {
  if (!PAGE_APPEARANCE_KEYS.includes(key as (typeof PAGE_APPEARANCE_KEYS)[number])) {
    throw new Error(`Unknown page appearance key "${key}"`);
  }
  return validatePageContent(key, value);
}

export function validateRequestInternalContent(value: unknown): PageContentConfig {
  return validatePageContent('pages.requestInternal', value);
}

export function validateRequestExternalContent(value: unknown): PageContentConfig {
  return validatePageContent('pages.requestExternal', value);
}
