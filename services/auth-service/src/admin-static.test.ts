import { describe, expect, it } from 'vitest';
import { ADMIN_CSS, ADMIN_EDITOR_HTML, ADMIN_JS } from './admin-static';

describe('auth manager presentation contracts', () => {
  it('ships executable console JavaScript', () => {
    expect(() => new Function(ADMIN_JS)).not.toThrow();
  });

  it('uses the IdP administration shell and self-hosted Geist typefaces', () => {
    expect(ADMIN_EDITOR_HTML).toContain('class="console-masthead"');
    expect(ADMIN_EDITOR_HTML).not.toContain('class="provider-mark"');
    expect(ADMIN_EDITOR_HTML).toContain('id="btn-mobile-nav"');
    expect(ADMIN_EDITOR_HTML).toContain('aria-controls="console-sidebar"');
    expect(ADMIN_EDITOR_HTML).toContain('class="sidebar" inert');
    expect(ADMIN_CSS).toContain('/ui/fonts/geist-v1-latin.woff2');
    expect(ADMIN_CSS).toContain('/ui/fonts/geist-mono-v1-latin.woff2');
    expect(ADMIN_CSS).not.toContain('radial-gradient');
    expect(ADMIN_EDITOR_HTML).not.toContain('class="nav-index"');
    expect(ADMIN_EDITOR_HTML).not.toMatch(/sdc/i);
    expect(ADMIN_CSS).toContain('@media(max-width:340px){.identity-login{width:100%;padding-inline:.625rem}}');
    expect(ADMIN_CSS).toContain('--bg:#ffffff');
    expect(ADMIN_CSS).toContain('--text:#09090b');
    expect(ADMIN_CSS).not.toContain('#175cd3');
  });

  it('preserves every view hook used by the console script', () => {
    for (const id of ['dashboard', 'identity', 'policies', 'sessions', 'users', 'clients', 'branding', 'audit']) {
      expect(ADMIN_EDITOR_HTML).toContain(`id="view-${id}"`);
      expect(ADMIN_EDITOR_HTML).toContain(`id="btn-view-${id}"`);
    }
    expect(ADMIN_JS).toContain("setAttribute('aria-current'");
    expect(ADMIN_JS).toContain("setAttribute('aria-busy'");
    expect(ADMIN_JS).toContain('sidebar.inert = closedOnMobile');
    expect(ADMIN_JS).toContain("event.key !== 'Tab'");
    expect(ADMIN_JS).toContain('window.location.hash');
    expect(ADMIN_JS).toContain("window.history.pushState(null, '', hash)");
    expect(ADMIN_JS).toContain("'authmgr:view-change'");
  });

  it('keeps sensitive and unavailable operational states explicit', () => {
    expect(ADMIN_JS).toContain('Rotating this secret immediately invalidates the current credential');
    expect(ADMIN_JS).toContain('Copy secret');
    expect(ADMIN_JS).toContain('60 * 1000');
    expect(ADMIN_JS).toContain('Operational data is unavailable. Counts are not shown.');
    expect(ADMIN_JS).toContain('dashboardState');
  });

  it('keeps authentication sources and policy ownership visible without process decoration', () => {
    expect(ADMIN_EDITOR_HTML).toContain('Identity sources');
    expect(ADMIN_EDITOR_HTML).toContain('Active Directory');
    expect(ADMIN_EDITOR_HTML).toContain('Auth Manager recovery');
    expect(ADMIN_EDITOR_HTML).toContain('Never issued');
    expect(ADMIN_EDITOR_HTML).toContain('Sign-in rules');
    expect(ADMIN_EDITOR_HTML).toContain('Deployment environment');
    expect(ADMIN_EDITOR_HTML).not.toContain('class="trust-route"');
    expect(ADMIN_EDITOR_HTML).not.toContain('Provider decision order');
    expect(ADMIN_EDITOR_HTML).not.toContain('class="overview-brief"');
    expect(ADMIN_EDITOR_HTML).not.toContain('placeholder=');
    expect(ADMIN_EDITOR_HTML).toContain('Human verification is disabled in preview.');
    expect(ADMIN_EDITOR_HTML).not.toContain('shown as a placeholder');
    expect(ADMIN_JS).toContain('/admin/api/identity-configuration');
    expect(ADMIN_JS).toContain('not in tokens');
  });
});
