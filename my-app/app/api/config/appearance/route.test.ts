import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfigValue: vi.fn(),
  managedPageRevisionFindMany: vi.fn(),
}));

vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.getConfigValue,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    managedPageRevision: {
      findMany: mocks.managedPageRevisionFindMany,
    },
  },
}));

import { GET } from './route';
import {
  DEFAULT_NAV_LINKS,
  DEFAULT_APPEARANCE_THEME,
  DEFAULT_REQUEST_EXTERNAL_CONTENT,
  DEFAULT_REQUEST_INTERNAL_CONTENT,
  PAGE_APPEARANCE_IDS,
  PAGE_APPEARANCE_REGISTRY,
} from '@/lib/appearance';

/**
 * The route reads exactly these three keys; every stored value must be a
 * string for this endpoint's own parsing layer.
 */
function storedValues(values: Record<string, string>) {
  mocks.getConfigValue.mockImplementation(async (key: string) => {
    if (key in values) return values[key];
    throw new Error(`config key ${key} unavailable`);
  });
}

function defaultBody() {
  const pages = Object.fromEntries(PAGE_APPEARANCE_IDS.map((id) => [id, PAGE_APPEARANCE_REGISTRY[id].defaultContent]));
  return {
    theme: DEFAULT_APPEARANCE_THEME,
    navLinks: DEFAULT_NAV_LINKS,
    requestInternal: DEFAULT_REQUEST_INTERNAL_CONTENT,
    requestExternal: DEFAULT_REQUEST_EXTERNAL_CONTENT,
    pages,
    managedPages: {},
  };
}

describe('public appearance resolution', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.managedPageRevisionFindMany.mockResolvedValue([]);
    storedValues({});
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('fails open to the built-in defaults when the config store is unreadable', async () => {
    mocks.getConfigValue.mockRejectedValue(new Error('config store down'));

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ...defaultBody(), appearanceVersion: expect.any(String) });
    expect(response.headers.get('etag')).toBe(`"${body.appearanceVersion}"`);
    expect(mocks.getConfigValue).toHaveBeenCalledWith('nav.links');
    expect(mocks.getConfigValue).toHaveBeenCalledWith('appearance.theme');
    expect(mocks.getConfigValue).toHaveBeenCalledWith('pages.requestInternal');
    expect(mocks.getConfigValue).toHaveBeenCalledWith('pages.requestExternal');
  });

  it('lets stored overrides win over the defaults when every key resolves', async () => {
    storedValues({
      'nav.links': JSON.stringify([
        { label: 'Status', href: 'https://status.example.test', section: 'services' },
        { label: 'Support', href: '/support/tickets', requiresAuth: true },
      ]),
      'pages.requestInternal': JSON.stringify({ title: 'Custom internal title' }),
      'pages.requestExternal': JSON.stringify({ subtitle: 'External override only' }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.navLinks).toEqual([
      {
        label: 'Status',
        href: 'https://status.example.test',
        section: 'services',
        requiresAuth: false,
        requiresAdmin: false,
      },
      {
        label: 'Support',
        href: '/support/tickets',
        section: 'main',
        requiresAuth: true,
        requiresAdmin: false,
      },
    ]);
    expect(body.requestInternal.title).toBe('Custom internal title');
    // Unspecified copy fields merge back to the built-in defaults.
    expect(body.requestInternal.subtitle).toBe(DEFAULT_REQUEST_INTERNAL_CONTENT.subtitle);
    expect(body.requestExternal.subtitle).toBe('External override only');
    expect(body.requestExternal.title).toBe(DEFAULT_REQUEST_EXTERNAL_CONTENT.title);
  });

  it('treats the former built-in home copy as the current production baseline', async () => {
    storedValues({
      'pages.home': JSON.stringify({
        title: 'User Access Request Portal',
        subtitle: 'Request and manage access to Student Data Center resources.',
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pages.home).toEqual(PAGE_APPEARANCE_REGISTRY.home.defaultContent);
  });

  it('falls back to defaults for malformed nav rows while keeping valid page overrides', async () => {
    storedValues({
      'nav.links': '{not-json',
      'pages.requestInternal': JSON.stringify({ title: 'Still custom' }),
      'pages.requestExternal': JSON.stringify({}),
    });

    const response = await GET();
    const body = await response.json();

    expect(body.navLinks).toEqual(DEFAULT_NAV_LINKS);
    expect(body.requestInternal.title).toBe('Still custom');
  });

  it('falls back independently when one page key cannot be loaded', async () => {
    storedValues({
      'nav.links': JSON.stringify([
        { label: 'Status', href: 'https://status.example.test', section: 'services' },
      ]),
      'pages.requestInternal': JSON.stringify({ title: 'Custom' }),
      // pages.requestExternal deliberately missing -> rejected -> '' sentinel.
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.navLinks[0].label).toBe('Status');
    expect(body.requestInternal.title).toBe('Custom');
    expect(body.requestExternal).toEqual(DEFAULT_REQUEST_EXTERNAL_CONTENT);
  });
});

describe('public appearance resilience to malformed rows', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.managedPageRevisionFindMany.mockResolvedValue([]);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('fails open only for the malformed page row', async () => {
    mocks.getConfigValue.mockImplementation(async (key: string) => {
      if (key === 'nav.links') {
        return JSON.stringify([
          { label: 'Status', href: 'https://status.example.test', section: 'services' },
        ]);
      }
      if (key === 'pages.requestInternal') return '{broken';
      if (key === 'pages.requestExternal') return '{"title":"External"}';
      throw new Error(`config key ${key} unavailable`);
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(consoleError).toHaveBeenCalled();
    expect(body.navLinks[0].label).toBe('Status');
    expect(body.requestInternal).toEqual({
      title: DEFAULT_REQUEST_INTERNAL_CONTENT.title,
      subtitle: DEFAULT_REQUEST_INTERNAL_CONTENT.subtitle,
      notice: DEFAULT_REQUEST_INTERNAL_CONTENT.notice,
    });
    expect(body.requestExternal.title).toBe('External');
  });
});
