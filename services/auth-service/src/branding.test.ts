import { describe, expect, it } from 'vitest';
import {
  CLIENT_ID_PATTERN,
  colorContrastRatio,
  defaultBrandingDoc,
  markdownToSafeHtml,
  validateBrandingDoc,
  type BrandingBlock,
  type BrandingDoc,
} from './branding';

function validDoc(overrides: Partial<BrandingDoc> = {}): BrandingDoc {
  return {
    version: 1,
    titleSuffix: 'Test Auth',
    theme: { accentColor: '#0a4d92', accentText: '#ffffff', radius: 'md' },
    blocks: [
      { id: 'block-heading-1', type: 'heading', text: 'Welcome' },
      { id: 'block-loginf-01', type: 'loginForm' },
      { id: 'block-footer-1', type: 'footer', text: 'Monitored use only.' },
    ],
    ...overrides,
  };
}

describe('validateBrandingDoc', () => {
  it('accepts the built-in default document', () => {
    const result = validateBrandingDoc(defaultBrandingDoc());
    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed document and normalizes colors', () => {
    const result = validateBrandingDoc(validDoc());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.theme?.accentColor).toBe('#0a4d92');
    }
  });

  it('keeps legacy version 1 partial color overrides readable instead of dropping the profile', () => {
    const result = validateBrandingDoc(validDoc({
      theme: { accentColor: '#0a4d92' },
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.theme).toMatchObject({
        accentColor: '#0a4d92',
        accentText: '#ffffff',
      });
    }
  });

  it('rejects non-objects and wrong versions', () => {
    expect(validateBrandingDoc('nope').ok).toBe(false);
    expect(validateBrandingDoc(null).ok).toBe(false);
    expect(validateBrandingDoc({ ...validDoc(), version: 2 }).ok).toBe(false);
  });

  it('rejects documents without exactly one loginForm', () => {
    const missing = validDoc({
      blocks: [{ id: 'block-heading-1', type: 'heading', text: 'Hi' }],
    });
    expect(validateBrandingDoc(missing).ok).toBe(false);

    const duplicated = validDoc({
      blocks: [
        { id: 'block-loginf-01', type: 'loginForm' },
        { id: 'block-loginf-02', type: 'loginForm' },
      ],
    });
    expect(validateBrandingDoc(duplicated).ok).toBe(false);
  });

  it('rejects unknown block types', () => {
    const raw = {
      ...validDoc(),
      blocks: [
        ...validDoc().blocks,
        { id: 'block-script-1', type: 'script', text: '<script>' },
      ],
    } as unknown;
    expect(validateBrandingDoc(raw).ok).toBe(false);
  });

  it('rejects duplicate block ids and enforces caps', () => {
    const base = validDoc();
    const doc = validDoc({
      blocks: [...base.blocks, { id: 'block-heading-1', type: 'divider' } as never],
    });
    expect(validateBrandingDoc(doc).ok).toBe(false);

    const blocks: BrandingBlock[] = Array.from({ length: 20 }, (_, i) => ({
      id: `block-div-${String(i).padStart(2, '0')}`,
      type: 'divider',
    }));
    blocks.push({ id: 'block-loginf-01', type: 'loginForm' });
    const result = validateBrandingDoc(validDoc({ blocks }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.join(' ')).toContain('at most');
  });

  it('rejects bad colors, radii, heights, urls and lengths', () => {
    expect(
      validateBrandingDoc(validDoc({ theme: { accentColor: 'red; background:url(x)' } })).ok
    ).toBe(false);
    expect(validateBrandingDoc(validDoc({ theme: { radius: 'huge' as never } })).ok).toBe(false);

    const tallLogo = validDoc({
      blocks: [
        { id: 'block-logo-001', type: 'logo', url: 'https://x.test/a.png', alt: 'Logo', heightPx: 500 },
        { id: 'block-loginf-01', type: 'loginForm' },
      ],
    });
    expect(validateBrandingDoc(tallLogo).ok).toBe(false);

    const jsUrl = validDoc({
      blocks: [
        { id: 'block-logo-001', type: 'logo', url: 'javascript:alert(1)', alt: 'Logo', heightPx: 32 },
        { id: 'block-loginf-01', type: 'loginForm' },
      ],
    });
    expect(validateBrandingDoc(jsUrl).ok).toBe(false);

    const plainHttpUrl = validDoc({
      blocks: [
        { id: 'block-logo-001', type: 'logo', url: 'http://cdn.test/logo.png', alt: 'Logo', heightPx: 32 },
        { id: 'block-loginf-01', type: 'loginForm' },
      ],
    });
    const httpResult = validateBrandingDoc(plainHttpUrl);
    expect(httpResult.ok).toBe(false);
    expect(httpResult.ok === false && httpResult.issues.join(' ')).toContain('must use https');

    const httpsUrl = validDoc({
      blocks: [
        { id: 'block-logo-001', type: 'logo', url: 'https://cdn.test/l.png', alt: 'Logo', heightPx: 48 },
        { id: 'block-loginf-01', type: 'loginForm' },
      ],
    });
    expect(validateBrandingDoc(httpsUrl).ok).toBe(true);

    const relativeUrl = validDoc({
      blocks: [
        { id: 'block-logo-001', type: 'logo', url: '/etc/passwd', alt: 'Logo', heightPx: 32 },
        { id: 'block-loginf-01', type: 'loginForm' },
      ],
    });
    expect(validateBrandingDoc(relativeUrl).ok).toBe(false);

    const longHeading = validDoc({
      blocks: [
        { id: 'block-heading-1', type: 'heading', text: 'x'.repeat(121) },
        { id: 'block-loginf-01', type: 'loginForm' },
      ],
    });
    expect(validateBrandingDoc(longHeading).ok).toBe(false);
  });

  it('rejects unreadable functional color pairs in either supported color scheme', () => {
    const result = validateBrandingDoc(validDoc({
      theme: {
        cardBackground: '#ffffff',
        textColor: '#ffffff',
        mutedTextColor: '#ffffff',
        accentColor: '#ffffff',
        accentText: '#ffffff',
      },
    }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.issues.join(' ')).toContain('contrast');
    expect(colorContrastRatio('#000000', '#ffffff')).toBe(21);
  });

  it('strips unexpected properties from blocks', () => {
    const raw = {
      version: 1,
      blocks: [{ id: 'block-loginf-01', type: 'loginForm', onclick: 'alert(1)' }],
    } as unknown;
    const result = validateBrandingDoc(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blocks[0]).toEqual({ id: 'block-loginf-01', type: 'loginForm' });
    }
  });

  it('validates client ids for profile keys', () => {
    expect(CLIENT_ID_PATTERN.test('uar-portal')).toBe(true);
    expect(CLIENT_ID_PATTERN.test('../etc')).toBe(false);
    expect(CLIENT_ID_PATTERN.test('render')).toBe(true); // routing excludes it
  });
});

describe('markdownToSafeHtml', () => {
  it('renders allowed inline formatting', () => {
    const html = markdownToSafeHtml('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('allows links with http(s) and mailto schemes only', () => {
    const good = markdownToSafeHtml('[site](https://example.com)');
    expect(good).toContain('href="https://example.com"');
    expect(good).toContain('rel="noopener noreferrer nofollow"');

    const bad = markdownToSafeHtml('[click](javascript:alert(1))');
    expect(bad).not.toContain('javascript:');
  });

  it('strips scripts, images, and event handlers', () => {
    const html = markdownToSafeHtml('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });

  it('is byte-stable across calls (preview/prod parity)', () => {
    const sample = '# Heading\n\nA [link](https://x.test) and `code`.';
    expect(markdownToSafeHtml(sample)).toBe(markdownToSafeHtml(sample));
  });
});
