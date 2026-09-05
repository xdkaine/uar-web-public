import { describe, expect, it, vi } from 'vitest';
import {
  configuredBootstrapApplication,
  providerErrorRenderer,
  renderApplicationLanding,
  renderProtocolErrorPage,
} from './public-ui';

describe('public identity landing and protocol errors', () => {
  it('groups identity and external applications while escaping curated copy', () => {
    const html = renderApplicationLanding([
      { id: '1', slug: 'portal', name: 'Portal <x>', description: 'Reviews & access', launchUrl: 'https://portal.test/', iconUrl: null, kind: 'oidc', oidcClientId: 'portal', visibility: 'public', sortOrder: 0, publishedAt: new Date() },
      { id: '2', slug: 'docs', name: 'Docs', description: null, launchUrl: 'https://docs.test/', iconUrl: null, kind: 'external', oidcClientId: null, visibility: 'public', sortOrder: 1, publishedAt: new Date() },
    ]);
    expect(html).toContain('Uses Cal Poly SOC IdP');
    expect(html).toContain('<span class="brand">Cal Poly SOC</span>');
    expect(html).toContain('<span class="issuer">IdP</span>');
    expect(html).toContain('Other services');
    expect(html).toContain('Portal &lt;x&gt;');
    expect(html).not.toContain('Portal <x>');
    expect(html).toContain('.name{display:block');
    expect(html).toContain('.desc{display:-webkit-box');
    expect(html).toContain('-webkit-line-clamp:1');
    expect(html).toContain('<span class="open">Open</span>');
    expect(html).not.toContain('Open&nbsp;↗');
    expect(html).toContain('--canvas:#ffffff');
    expect(html).toContain('--ink:#09090b');
    expect(html).not.toContain('#1769aa');
  });

  it('derives a safe bootstrap portal launch from its registered redirect origin', () => {
    expect(configuredBootstrapApplication('uar-portal', [
      'https://portal.example.test/api/auth/oidc/callback',
    ])).toMatchObject({
      name: 'UAR Portal',
      launchUrl: 'https://portal.example.test/',
      kind: 'oidc',
      oidcClientId: 'uar-portal',
    });
    expect(configuredBootstrapApplication('unsafe', ['http://example.test/callback'])).toBeNull();
  });

  it('maps protocol errors to safe copy and never reflects provider descriptions', async () => {
    const html = renderProtocolErrorPage('invalid_request');
    expect(html).toContain('Sign-in link not valid');
    expect(html).toContain('Back to applications');

    const ctx = { set: vi.fn(), type: '', body: '' };
    await providerErrorRenderer(ctx, { error: 'invalid_client', error_description: '<secret detail>' });
    expect(ctx.type).toBe('html');
    expect(ctx.body).toContain('Application not registered');
    expect(ctx.body).not.toContain('secret detail');
    expect(ctx.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
