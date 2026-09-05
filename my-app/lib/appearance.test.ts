import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAV_LINKS,
  DEFAULT_REQUEST_EXTERNAL_CONTENT,
  HOME_SUBTITLE_LINKS,
  normalizeLegacyPageContent,
  PAGE_APPEARANCE_REGISTRY,
  segmentHomeSubtitle,
  validateNavLinks,
  validateRegisteredPageContent,
  validateRequestExternalContent,
  validateRequestInternalContent,
} from './appearance';

describe('page appearance registry', () => {
  it('covers the primary request, support, home, and profile surfaces', () => {
    expect(Object.keys(PAGE_APPEARANCE_REGISTRY)).toEqual(expect.arrayContaining([
      'home', 'requestInternal', 'requestExternal', 'supportTickets', 'supportCreate', 'supportTicketDetail', 'profile',
    ]));
  });

  it('rejects unknown pages and invalid page content', () => {
    expect(() => validateRegisteredPageContent('pages.unknown', {})).toThrow(/Unknown page/);
    expect(() => validateRegisteredPageContent('pages.profile', { title: 'x'.repeat(121), subtitle: '' })).toThrow(/120/);
  });

  it('uses the production landing copy as the configurable home baseline', () => {
    expect(PAGE_APPEARANCE_REGISTRY.home.defaultContent).toEqual({
      title: 'User Access Request Portal',
      subtitle:
        'Request access for the Mitchell C. Hill Student Data Center resources which are monitored and managed by the Student Directors of the SOC & SDC.',
    });
  });

  it('upgrades only the former built-in home copy to the production baseline', () => {
    expect(normalizeLegacyPageContent('home', {
      title: 'User Access Request Portal',
      subtitle: 'Request and manage access to Student Data Center resources.',
    })).toEqual(PAGE_APPEARANCE_REGISTRY.home.defaultContent);

    const custom = {
      title: 'User Access Request Portal',
      subtitle: 'A locally customized introduction.',
    };
    expect(normalizeLegacyPageContent('home', custom)).toBe(custom);

    const legacyWithNotice = {
      title: 'User Access Request Portal',
      subtitle: 'Request and manage access to Student Data Center resources.',
      notice: 'Local operating notice',
    };
    expect(normalizeLegacyPageContent('home', legacyWithNotice)).toBe(legacyWithNotice);
  });

  it('preserves the production institutional links while allowing surrounding copy to change', () => {
    expect(segmentHomeSubtitle(PAGE_APPEARANCE_REGISTRY.home.defaultContent.subtitle)).toEqual([
      { text: 'Request access for the ' },
      { ...HOME_SUBTITLE_LINKS[0] },
      { text: ' resources which are monitored and managed by the ' },
      { ...HOME_SUBTITLE_LINKS[1] },
      { text: '.' },
    ]);

    expect(segmentHomeSubtitle('A completely custom introduction.')).toEqual([
      { text: 'A completely custom introduction.' },
    ]);
  });
});

describe('validateNavLinks', () => {
  it('accepts a stored JSON string and canonicalizes each entry', () => {
    const links = validateNavLinks(
      JSON.stringify([
        { label: 'Status', href: 'https://status.example.test', section: 'services' },
        { label: 'Support', href: '/support/tickets', requiresAuth: true },
      ])
    );

    expect(links).toEqual([
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
  });

  it('treats null and undefined as "use defaults"', () => {
    expect(validateNavLinks(null)).toEqual([]);
    expect(validateNavLinks(undefined)).toEqual([]);
  });

  it('currently rejects a raw empty string because strings are JSON-parsed first', () => {
    // Documented current behavior: the '' sentinel never reaches the
    // "empty means use defaults" branch for string inputs.
    expect(() => validateNavLinks('')).toThrow(/invalid JSON/);
    // A JSON-encoded empty value does reach it.
    expect(validateNavLinks('null')).toEqual([]);
    expect(validateNavLinks('[]')).toEqual([]);
  });

  it.each([
    ['invalid JSON payload', '{not-json'],
    ['non-array payloads', JSON.stringify({ label: 'x' })],
    ['non-object entries', JSON.stringify(['link'])],
  ])('rejects %s', (_label, value) => {
    expect(() => validateNavLinks(value)).toThrow();
  });

  it('caps the number of links', () => {
    const flood = Array.from({ length: 25 }, (_, index) => ({
      label: `Link ${index}`,
      href: `/page-${index}`,
      section: 'main',
    }));

    expect(() => validateNavLinks(flood)).toThrow(/at most 24/);
  });

  it.each([
    ['empty labels', { label: '', href: '/ok' }],
    ['labels over 60 characters', { label: 'x'.repeat(61), href: '/ok' }],
    ['empty hrefs', { label: 'Ok', href: '' }],
    ['hrefs over 400 characters', { label: 'Ok', href: `/${'x'.repeat(400)}` }],
    ['plain http targets', { label: 'Ok', href: 'http://insecure.example.test' }],
    ['protocol-relative targets', { label: 'Ok', href: '//evil.example.test' }],
    ['arbitrary schemes', { label: 'Ok', href: 'javascript:alert(1)' }],
  ])('rejects %s', (_label, entry) => {
    expect(() => validateNavLinks([entry])).toThrow();
  });

  it('keeps internal paths and https URLs while coercing unknown sections to main', () => {
    const links = validateNavLinks([
      { label: 'Home', href: '/', section: 'unknown-section' },
      { label: 'Docs', href: 'https://docs.example.test' },
    ]);

    expect(links).toHaveLength(2);
    expect(links[0].section).toBe('main');
    expect(links[1].href).toBe('https://docs.example.test');
  });
});

describe('page content validators', () => {
  it('passes through stored overrides with trimming', () => {
    expect(
      validateRequestInternalContent(
        JSON.stringify({ title: '  Custom title  ', subtitle: 'Custom subtitle', notice: 'Notice' })
      )
    ).toEqual({ title: 'Custom title', subtitle: 'Custom subtitle', notice: 'Notice' });
  });

  it('treats blank notices as absent so defaults can merge back in', () => {
    const content = validateRequestExternalContent({
      title: 'T',
      subtitle: 'S',
      notice: '   ',
    });

    expect(content.notice).toBeUndefined();
  });

  it('treats null and undefined as "use defaults"', () => {
    expect(validateRequestInternalContent(null)).toEqual({ title: '', subtitle: '' });
  });

  it('currently rejects raw empty strings because strings are JSON-parsed first', () => {
    expect(() => validateRequestInternalContent('')).toThrow(/invalid JSON/);
    expect(validateRequestInternalContent('null')).toEqual({ title: '', subtitle: '' });
  });

  it('rejects malformed stored rows instead of guessing', () => {
    expect(() => validateRequestInternalContent('{broken')).toThrow(/invalid JSON/);
    expect(() => validateRequestInternalContent(['not-an-object'])).toThrow(/JSON object/);
    expect(() => validateRequestExternalContent(42 as unknown as Record<string, unknown>)).toThrow();
  });

  it('enforces length ceilings on every field', () => {
    expect(() =>
      validateRequestInternalContent({ title: 'x'.repeat(121), subtitle: 's' })
    ).toThrow(/title/);
    expect(() =>
      validateRequestInternalContent({ title: 't', subtitle: 'x'.repeat(401) })
    ).toThrow(/subtitle/);
    expect(() =>
      validateRequestInternalContent({ title: 't', subtitle: 's', notice: 'x'.repeat(801) })
    ).toThrow(/notice/);
  });

  it('leaves the built-in defaults importable for fallback rendering', () => {
    expect(DEFAULT_NAV_LINKS.length).toBeGreaterThan(0);
    expect(DEFAULT_REQUEST_EXTERNAL_CONTENT.title.length).toBeGreaterThan(0);
  });
});
