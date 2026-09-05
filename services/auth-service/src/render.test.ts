import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { defaultBrandingDoc, validateBrandingDoc, type BrandingDoc } from './branding';
import { interactionContentSecurityPolicy, interactionHtmlHeaders, INTERACTION_CONTENT_SECURITY_POLICY, renderBrandingPage } from './render';

function doc(): BrandingDoc {
  const parsed = validateBrandingDoc(defaultBrandingDoc());
  if (!parsed.ok) throw new Error('default doc must validate');
  return parsed.value;
}

describe('renderBrandingPage', () => {
  it('renders a form-first sign-in window with self-hosted Geist typefaces', () => {
    const html = renderBrandingPage('login', doc(), {
      uid: 'uid-123456',
      requestingApplication: 'UAR Portal',
      preview: true,
    });
    expect(html).toContain('class="identity-shell"');
    expect(html).toContain('class="credential-window"');
    expect(html).toContain('class="provider-organization">Cal Poly SOC</span>');
    expect(html).toContain('class="provider-service">IdP</span>');
    expect(html).toContain('/ui/fonts/geist-v1-latin.woff2');
    expect(html).toContain('/ui/fonts/geist-mono-v1-latin.woff2');
    expect(html).not.toContain('radial-gradient');
    expect(html).toContain('--page-bg:#ffffff');
    expect(html).toContain('--accent:#18181b');
    expect(html).not.toContain('#006fee');
    expect(html).not.toContain('box-shadow:0 24px');
    expect(html).toContain('<h1>Sign in to UAR Portal</h1>');
    expect(html).toContain('Use your directory username &amp; password.');
    expect(html).not.toContain('Sign in with your directory account');
    expect(html).not.toContain('UAR Portal Sign-in');
    expect(html).not.toContain('Authenticate with your Active Directory account');
    expect(html).not.toContain('class="trust-route"');
    expect(html).not.toContain('One identity. Every trusted service.');
    expect(html).not.toContain('Secure connection');
    expect(html).not.toContain('Your password is submitted only');
    expect(html).not.toContain('Sign-in activity is logged');
    expect(html).not.toContain('your application');
    expect(html).not.toMatch(/sdc/i);
    expect(html).not.toContain('Cal Poly Pomona');
  });

  it('omits destination context when no verified application name is available', () => {
    const html = renderBrandingPage('login', doc(), { preview: true });
    expect(html).toContain('<h1>Sign in</h1>');
    expect(html).not.toContain('your application');
    expect(html).not.toContain('Continue to');
  });

  it('escapes the interaction uid in form actions', () => {
    const html = renderBrandingPage('login', doc(), {
      uid: 'abc"><script>alert(1)</script>',
      turnstileSiteKey: 'site-key',
    });
    expect(html).toContain('action="/interaction/abc&quot;&gt;&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('includes the first-party device hint field and script on live sign-in pages only', () => {
    const live = renderBrandingPage('login', doc(), { uid: 'u12345678', deviceEvidenceEnabled: true });
    expect(live).toContain('name="deviceId" id="device-id"');
    expect(live).toContain("getElementById('device-id')");
    expect(live).toContain("'v2-'");
    expect(live).toContain("crypto.subtle.digest('SHA-256'");
    expect(live).toContain('getHighEntropyValues');

    const change = renderBrandingPage('change-password', doc(), {
      uid: 'u12345678',
      username: 'user',
      deviceEvidenceEnabled: true,
    });
    expect(change).toContain('name="deviceId" id="device-id"');

    // Preview renders inside a sandboxed iframe: no scripts, no hidden capture.
    const preview = renderBrandingPage('login', doc(), { uid: 'u12345678', preview: true });
    expect(preview).not.toContain('name="deviceId" id="device-id"');
    expect(preview).not.toContain('getElementById');
  });

  it('single-flights repeated submits while device evidence is resolving', async () => {
    const html = renderBrandingPage('login', doc(), {
      uid: 'u12345678',
      deviceEvidenceEnabled: true,
    });
    const inlineMatch = /<script>((?:(?!<\/script>)[\s\S])*)<\/script>\s*<\/body>/.exec(html);
    if (!inlineMatch) throw new Error('device evidence script must render');

    let submitHandler: ((event: { preventDefault(): void }) => void) | undefined;
    let requestSubmits = 0;
    const form = {
      addEventListener: (
        _name: string,
        handler: (event: { preventDefault(): void }) => void
      ) => { submitHandler = handler; },
      requestSubmit: () => { requestSubmits += 1; },
    };
    const evidenceField = { value: '', form };
    const document = {
      getElementById: () => evidenceField,
      createElement: () => ({ getContext: () => null }),
    };
    const navigator = { userAgent: 'test', language: 'en', languages: ['en'] };
    const screen = {
      width: 320,
      height: 640,
      availWidth: 320,
      availHeight: 640,
      colorDepth: 24,
      pixelDepth: 24,
    };
    const windowObject: Record<string, unknown> = {
      document,
      navigator,
      screen,
      devicePixelRatio: 1,
    };
    windowObject.window = windowObject;
    runInNewContext(inlineMatch[1], {
      window: windowObject,
      document,
      navigator,
      screen,
      setTimeout,
      Intl,
      Date,
    });
    const event = { preventDefault: () => undefined };
    submitHandler?.(event);
    submitHandler?.(event);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requestSubmits).toBe(1);
  });

  it('does not fingerprint or submit device evidence when shadow mode is off', () => {
    const html = renderBrandingPage('login', doc(), { uid: 'u12345678' });
    expect(html).not.toContain('name="deviceId"');
    expect(html).not.toContain('getHighEntropyValues');
    expect(html).not.toContain('OfflineAudioContext');
  });

  it('escapes preserved usernames and error messages', () => {
    const html = renderBrandingPage('login', doc(), {
      uid: 'u12345678',
      username: 'user"><img src=x onerror=alert(1)>@calpoly.test',
      errorMessage: 'Invalid <b>input</b>',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('Invalid <b>input</b>');
    expect(html).toContain('Invalid &lt;b&gt;input&lt;/b&gt;');
    expect((html.match(/<form /g) ?? []).length).toBe(1);
  });

  it('applies theme tokens to CSS variables and escapes them by construction', () => {
    const themed = validateBrandingDoc({
      version: 1,
      theme: {
        pageBackground: '#0f172a',
        cardBackground: '#1e293b',
        accentColor: '#38bdf8',
        accentText: '#0f172a',
        textColor: '#f8fafc',
        mutedTextColor: '#94a3b8',
        borderColor: '#334155',
        radius: 'lg',
      },
      blocks: [{ id: 'block-loginf-01', type: 'loginForm' }],
    });
    if (!themed.ok) throw new Error('fixture must validate');
    const html = renderBrandingPage('login', themed.value, {});
    expect(html).toContain('--page-bg:#0f172a');
    expect(html).toContain('--accent:#38bdf8');
    expect(html).toContain('--radius:12px');
    expect(html).toContain('--card-radius:16px');
  });

  it('renders logo blocks with validated urls and escaped alts', () => {
    const withLogo = validateBrandingDoc({
      version: 1,
      blocks: [
        { id: 'block-logo-001', type: 'logo', url: 'https://cdn.test/l.png', alt: 'App "logo"', heightPx: 48 },
        { id: 'block-loginf-01', type: 'loginForm' },
      ],
    });
    if (!withLogo.ok) throw new Error('fixture must validate');
    const html = renderBrandingPage('login', withLogo.value, {});
    expect(html).toContain('src="https://cdn.test/l.png"');
    expect(html).toContain('alt="App &quot;logo&quot;"');
    expect(html).toContain('height:48px');
  });

  it('renders markdown blocks through the sanitizer pipeline', () => {
    const withMd = validateBrandingDoc({
      version: 1,
      blocks: [
        { id: 'block-markdown-1', type: 'markdown', markdown: 'Use your **campus** account.' },
        { id: 'block-loginf-01', type: 'loginForm' },
      ],
    });
    if (!withMd.ok) throw new Error('fixture must validate');
    const html = renderBrandingPage('login', withMd.value, {});
    expect(html).toContain('<strong>campus</strong>');
  });

  it('change-password kind keeps fixed copy and its own form', () => {
    const html = renderBrandingPage('change-password', doc(), {
      uid: 'uid-123456',
      username: 'user@calpoly.test',
      turnstileSiteKey: 'k',
    });
    expect(html).toContain('Password change required');
    expect(html).toContain('/interaction/uid-123456/change-password');
    expect(html).toContain('name="next"');
    // login form must NOT appear on this page
    expect(html).not.toContain('id="login-form"');
    expect(html).toContain('class="identity-shell"');
  });

  it('keeps a visible focus token independent from approved custom branding', () => {
    const themed = validateBrandingDoc({
      version: 1,
      theme: {
        cardBackground: '#ffffff',
        textColor: '#1f1f1f',
        mutedTextColor: '#555555',
        accentColor: '#005bbb',
        accentText: '#ffffff',
      },
      blocks: [{ id: 'block-loginf-02', type: 'loginForm' }],
    });
    if (!themed.ok) throw new Error('fixture must validate');
    const html = renderBrandingPage('login', themed.value, {});
    expect(html).toContain('--focus:#18181b');
    expect(html).toContain('--focus-contrast:#ffffff');
    expect(html).toContain('outline:2px solid var(--focus)');
    expect(html).toContain('0 0 0 6px var(--focus-contrast)');
  });

  it('keeps one page heading when custom state copy provides only a body', () => {
    const customized = validateBrandingDoc({
      version: 1,
      stateCopy: { login: { body: 'Use the account assigned to you.' } },
      blocks: [{ id: 'block-loginf-03', type: 'loginForm' }],
    });
    if (!customized.ok) throw new Error('fixture must validate');
    const html = renderBrandingPage('login', customized.value, {});
    expect((html.match(/<h1>/g) ?? []).length).toBe(1);
    expect(html).toContain('<h1>Sign in</h1>');
    expect(html).toContain('Use the account assigned to you.');
  });

  it('shows an escaped requesting application and a same-origin leave action', () => {
    const html = renderBrandingPage('login', doc(), {
      requestingApplication: 'Portal <Admin>',
      cancelUrl: '/interaction/return',
    });
    expect(html).toContain('Sign in to Portal &lt;Admin&gt;');
    expect(html).toContain('href="/interaction/return">Back to applications');
    expect(html).not.toContain('Portal <Admin>');

    const unsafe = renderBrandingPage('login', doc(), { cancelUrl: 'https://untrusted.example/' });
    expect(unsafe).toContain('href="/">Back to applications');
    const backslash = renderBrandingPage('login', doc(), { cancelUrl: '/\\evil.example/path' });
    expect(backslash).toContain('href="/">Back to applications');
  });

  it('error kind renders message without any form or turnstile script in preview', () => {
    const html = renderBrandingPage('error', doc(), {
      errorMessage: 'Session expired <script>alert(1)</script>',
      preview: true,
    });
    expect(html).not.toContain('<form');
    expect(html).not.toContain('challenges.cloudflare.com');
    expect(html).toContain('Session expired &lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('gives live error pages a same-origin recovery action', () => {
    const html = renderBrandingPage('error', doc(), {
      errorMessage: 'This request expired.',
      cancelUrl: '/applications',
    });
    expect(html).toContain('href="/applications">Back to applications');
  });

  it('preview mode marks verification disabled and omits the CDN script', () => {
    const html = renderBrandingPage('login', doc(), {
      uid: 'uid-123456',
      turnstileSiteKey: 'k',
      preview: true,
    });
    expect(html).not.toContain('challenges.cloudflare.com');
    expect(html).toContain('preview-verification');
    expect(html).toContain('Human verification is disabled in preview');
  });

  it('uses the responsive Turnstile size and preserves its 300px minimum at 320px', () => {
    const html = renderBrandingPage('login', doc(), {
      uid: 'uid-123456',
      turnstileSiteKey: 'k',
    });
    expect(html).toContain('data-size="flexible"');
    expect(html).toContain('@media(max-width:340px){.identity-shell{padding-inline:.625rem}}');
    expect(html).not.toContain('.cf-turnstile{overflow:hidden}');
  });

  it('non-preview pages load the turnstile script exactly once', () => {
    const html = renderBrandingPage('login', doc(), { uid: 'uid-123456', deviceEvidenceEnabled: true });
    expect((html.match(/challenges\.cloudflare\.com/g) ?? []).length).toBe(1);
  });

  it('uses titleSuffix in the document title', () => {
    expect(renderBrandingPage('login', doc(), {})).toContain(
      '<title>Sign in | UAR Authentication</title>'
    );
    const custom = validateBrandingDoc({
      version: 1,
      titleSuffix: 'Campus SSO',
      blocks: [{ id: 'block-loginf-01', type: 'loginForm' }],
    });
    if (!custom.ok) throw new Error('fixture must validate');
    expect(renderBrandingPage('login', custom.value, {})).toContain(
      '<title>Sign in | Campus SSO</title>'
    );
  });
});

describe('interaction page frame protections (issue #41)', () => {
  it('CSP pins default-src self, bounded img-src, and frame-ancestors none', () => {
    expect(INTERACTION_CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(INTERACTION_CONTENT_SECURITY_POLICY).toContain("img-src 'self' data: https:");
    expect(INTERACTION_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(INTERACTION_CONTENT_SECURITY_POLICY).toContain("base-uri 'none'");
    expect(INTERACTION_CONTENT_SECURITY_POLICY).toContain("font-src 'self'");
  });

  it('allows only the Turnstile origin for scripts and frames, plus the hashed inline hint', () => {
    const scriptDirectives = INTERACTION_CONTENT_SECURITY_POLICY
      .split(';')
      .map((directive) => directive.trim());
    const scriptSrc = scriptDirectives.find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain('https://challenges.cloudflare.com');
    // No blanket unsafe-inline for scripts.
    expect(scriptSrc).not.toContain('unsafe-inline');

    const hashes = scriptSrc.match(/sha256-[A-Za-z0-9+/=]+/g) ?? [];
    expect(hashes.length).toBe(1);
    const html = renderBrandingPage('login', doc(), {
      uid: 'uid-123456',
      deviceEvidenceEnabled: true,
    });
    const inlineMatch = /<script>((?:(?!<\/script>)[\s\S])*)<\/script>\s*<\/body>/.exec(html);
    expect(inlineMatch).not.toBeNull();
    const actual = createHash('sha256').update(inlineMatch?.[1] ?? '').digest('base64');
    expect(hashes[0]).toBe(`sha256-${actual}`);
  });

  it('header helper emits CSP, DENY framing, and referrer policy', () => {
    const headers = interactionHtmlHeaders({ 'Content-Type': 'text/html' });
    expect(headers['Content-Security-Policy']).toBe(INTERACTION_CONTENT_SECURITY_POLICY);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['Content-Type']).toBe('text/html');
  });

  it('allows only configured HTTP(S) redirect origins through the form redirect chain', () => {
    const policy = interactionContentSecurityPolicy([
      'https://portal.example.test/api/auth/oidc/callback',
      'https://portal.example.test/other',
      'http://127.0.0.1:4402/api/auth/oidc/callback',
      'javascript:alert(1)',
      'not-a-uri',
    ]);
    const formAction = policy.split(';').map((directive) => directive.trim()).find((directive) => directive.startsWith('form-action'));
    expect(formAction).toBe("form-action 'self' https://portal.example.test http://127.0.0.1:4402");
    expect(interactionHtmlHeaders({}, ['https://portal.example.test/callback'])['Content-Security-Policy']).toContain(
      "form-action 'self' https://portal.example.test"
    );
  });

  it('every rendered kind is compatible with the policy (no inline handlers, external assets limited to turnstile)', () => {
    for (const kind of ['login', 'change-password', 'error'] as const) {
      const html = renderBrandingPage(kind === 'error' ? 'error' : kind, doc(), {
        uid: 'uid-123456',
        username: 'user',
        errorMessage: 'boom',
        turnstileSiteKey: 'k',
      });
      expect(html).not.toMatch(/\son[a-z]+=/i);
      expect(html).not.toMatch(/src="http:\/\/(?!challenges\.cloudflare\.com)/);
    }
  });
});
