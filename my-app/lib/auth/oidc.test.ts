import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  authorizationCodeGrant: vi.fn(),
}));

vi.mock('openid-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openid-client')>();
  return {
    ...actual,
    authorizationCodeGrant: mocks.authorizationCodeGrant,
  };
});

import {
  exchangeCallback,
  getOidcRuntimeConfig,
  isOidcEnabled,
  portalBaseUrl,
  probeOidcProviderAvailability,
  prepareLogin,
  OIDC_PROVIDER_REQUEST_TIMEOUT_MS,
} from './oidc';

const METADATA = {
  issuer: 'https://auth.example.test',
  authorization_endpoint: 'https://auth.example.test/auth',
  token_endpoint: 'https://auth.example.test/token',
};

function setEnv(mode?: string) {
  if (mode) {
    process.env.AUTH_MODE = mode;
  } else {
    delete process.env.AUTH_MODE;
  }
  process.env.AUTH_ISSUER = 'https://auth.example.test';
  process.env.AUTH_CLIENT_SECRET = 'secret';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3002';
  delete process.env.OIDC_INTERNAL_ISSUER_URL;
}

beforeEach(() => {
  vi.clearAllMocks();
  setEnv();
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...METADATA }) });
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('isOidcEnabled', () => {
  it('is off by default and requires issuer plus client secret', () => {
    delete process.env.AUTH_ISSUER;
    expect(isOidcEnabled()).toBe(false);

    setEnv('native');
    expect(isOidcEnabled()).toBe(false);

    setEnv('oidc');
    expect(isOidcEnabled()).toBe(true);
  });
});

describe('prepareLogin', () => {
  it('keeps only internal relative redirect paths', async () => {
    setEnv('oidc');
    const prepared = await prepareLogin('https://evil.example.test/phish', 'http://localhost:3002');

    expect(prepared.redirectPath).toBe('/instructions');
    const url = new URL(prepared.authorizationUrl);
    expect(url.origin).toBe('https://auth.example.test');
  });

  it('passes through safe internal redirects', async () => {
    setEnv('oidc');
    const prepared = await prepareLogin('/admin/settings', 'http://localhost:3002');

    expect(prepared.redirectPath).toBe('/admin/settings');
  });

  it('builds the callback URL from the configured origin with PKCE', async () => {
    setEnv('oidc');
    const prepared = await prepareLogin(null, 'http://localhost:3002/');
    const url = new URL(prepared.authorizationUrl);

    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3002/api/auth/oidc/callback'
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
  });

  it('mirrors server-called endpoints onto the internal base while keeping identity browser-facing', async () => {
    setEnv('oidc');
    process.env.OIDC_INTERNAL_ISSUER_URL = 'http://auth-service:3003';

    const prepared = await prepareLogin(null, 'http://localhost:3002/');
    const url = new URL(prepared.authorizationUrl);

    // Authorization stays browser-facing.
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.example.test/auth');

    // Discovery was fetched over the internal base.
    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://auth-service:3003/.well-known/openid-configuration',
      expect.objectContaining({ cache: 'no-store' })
    );

    await exchangeCallback({
      callbackUrl: new URL('http://localhost:3002/api/auth/oidc/callback?code=c&state=s'),
      expectedState: 's',
      codeVerifier: 'verifier-string',
      expectedNonce: 'n',
    }).catch(() => undefined);

    // Token exchange goes to the INTERNAL endpoint (via server metadata).
    expect(mocks.authorizationCodeGrant).toHaveBeenCalledTimes(1);
    const configArg = mocks.authorizationCodeGrant.mock.calls[0]?.[0] as unknown as {
      serverMetadata?: () => { token_endpoint?: string; issuer: string };
    };
    const meta = configArg.serverMetadata?.();
    expect(meta?.token_endpoint).toBe('http://auth-service:3003/token');
    // Identity stays browser-facing for ID-token iss validation.
    expect(meta?.issuer).toBe('https://auth.example.test');
  });

  it('bounds login-start discovery and preserves qualifying timeout evidence', async () => {
    vi.useFakeTimers();
    setEnv('oidc');
    process.env.OIDC_INTERNAL_ISSUER_URL = 'http://auth-service:3003';
    mocks.fetch.mockImplementation((_url, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));

    const pending = prepareLogin(null, 'http://localhost:3002');
    await vi.advanceTimersByTimeAsync(OIDC_PROVIDER_REQUEST_TIMEOUT_MS + 1);

    await expect(pending).rejects.toMatchObject({
      reason: 'connect_timeout',
      qualifiesForOutageFallback: true,
    });
  });
});

describe('probeOidcProviderAvailability', () => {
  it('requires the explicit internal issuer before automatic fallback can qualify', async () => {
    setEnv('oidc');
    delete process.env.OIDC_INTERNAL_ISSUER_URL;

    await expect(probeOidcProviderAvailability()).resolves.toEqual({
      available: false,
      reason: 'unknown_failure',
      qualifiesForOutageFallback: false,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('qualifies a refused internal service connection as outage evidence', async () => {
    setEnv('oidc');
    process.env.OIDC_INTERNAL_ISSUER_URL = 'http://auth-service:3003';
    mocks.fetch.mockRejectedValue(new TypeError('fetch failed', {
      cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
    }));

    await expect(probeOidcProviderAvailability()).resolves.toEqual({
      available: false,
      reason: 'connection_refused',
      qualifiesForOutageFallback: true,
    });
  });

  it('never qualifies TLS or HTTP failures for native downgrade', async () => {
    setEnv('oidc');
    process.env.OIDC_INTERNAL_ISSUER_URL = 'https://auth-service:3003';
    mocks.fetch.mockRejectedValueOnce(new TypeError('fetch failed', {
      cause: Object.assign(new Error('certificate'), { code: 'CERT_HAS_EXPIRED' }),
    }));
    await expect(probeOidcProviderAvailability()).resolves.toMatchObject({
      available: false,
      reason: 'tls_failure',
      qualifiesForOutageFallback: false,
    });

    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(probeOidcProviderAvailability()).resolves.toMatchObject({
      available: false,
      reason: 'http_error',
      qualifiesForOutageFallback: false,
    });
  });
});

describe('exchangeCallback', () => {
  it('fails fast without stashed state, verifier, or nonce', async () => {
    await expect(
      exchangeCallback({
        callbackUrl: new URL('http://localhost:3002/api/auth/oidc/callback?code=abc'),
        expectedState: undefined,
        codeVerifier: undefined,
        expectedNonce: undefined,
      })
    ).rejects.toThrow('Missing login state');

    expect(mocks.authorizationCodeGrant).not.toHaveBeenCalled();
  });

  it('returns the lowercased subject from verified claims', async () => {
    mocks.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'TPhao', preferred_username: 'tphao', amr: ['ad'] }),
    });

    const identity = await exchangeCallback({
      callbackUrl: new URL('http://localhost:3002/api/auth/oidc/callback?code=abc&state=s'),
      expectedState: 's',
      codeVerifier: 'verifier-string',
      expectedNonce: 'n',
    });

    expect(identity.username).toBe('tphao');
    expect(identity.amr).toEqual(['ad']);
  });

  it('surfaces the provider session sid when the ID token carries one', async () => {
    mocks.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({
        sub: 'tphao',
        preferred_username: 'tphao',
        amr: ['ad'],
        sid: 'provider-session-uid',
        provider_session_expires_at: 1_800_000_000,
      }),
    });

    const identity = await exchangeCallback({
      callbackUrl: new URL('http://localhost:3002/api/auth/oidc/callback?code=abc&state=s'),
      expectedState: 's',
      codeVerifier: 'verifier-string',
      expectedNonce: 'n',
    });

    expect(identity.sid).toBe('provider-session-uid');
    expect(identity.providerSessionExpiresAt).toBe(1_800_000_000);
  });

  it.each([undefined, '1800000000', -1, 1.5])(
    'omits malformed provider-session expiry %s',
    async (providerSessionExpiresAt) => {
      mocks.authorizationCodeGrant.mockResolvedValue({
        claims: () => ({
          sub: 'tphao',
          preferred_username: 'tphao',
          provider_session_expires_at: providerSessionExpiresAt,
        }),
      });

      const identity = await exchangeCallback({
        callbackUrl: new URL('http://localhost:3002/api/auth/oidc/callback?code=abc&state=s'),
        expectedState: 's',
        codeVerifier: 'verifier-string',
        expectedNonce: 'n',
      });

      expect(identity.providerSessionExpiresAt).toBeUndefined();
    },
  );

  it('omits sid when the ID token has none (defensive for exotic ASes)', async () => {
    mocks.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'tphao', preferred_username: 'tphao' }),
    });

    const identity = await exchangeCallback({
      callbackUrl: new URL('http://localhost:3002/api/auth/oidc/callback?code=abc&state=s'),
      expectedState: 's',
      codeVerifier: 'verifier-string',
      expectedNonce: 'n',
    });

    expect(identity.sid).toBeUndefined();
  });

  it('survives a proxy-mangled iss parameter and strips RFC 9207 enforcement', async () => {
    // The fronting proxy injects a trailing slash into the percent-encoded
    // iss response parameter; oauth4webapi strict-compares it against the
    // issuer whenever it is PRESENT (the metadata flag only controls whether
    // it is required). Both defenses must be neutralized: the flag stripped
    // from metadata AND the parameter removed from the callback URL - then
    // validation passes and the token exchange is attempted.
    setEnv('oidc');
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...METADATA,
        authorization_response_iss_parameter_supported: true,
      }),
    });
    mocks.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'tphao', preferred_username: 'tphao' }),
    });

    await exchangeCallback({
      callbackUrl: new URL(
        'http://localhost:3002/api/auth/oidc/callback?code=c&state=s&iss=https%3A%2F%2Fauth.example.test%2F'
      ),
      expectedState: 's',
      codeVerifier: 'verifier-string',
      expectedNonce: 'n',
    });

    expect(mocks.authorizationCodeGrant).toHaveBeenCalledTimes(1);
    const configArg = mocks.authorizationCodeGrant.mock.calls[0]?.[0] as unknown as {
      serverMetadata?: () => Record<string, unknown>;
    };
    expect(configArg.serverMetadata?.()).not.toHaveProperty(
      'authorization_response_iss_parameter_supported'
    );
    const urlArg = mocks.authorizationCodeGrant.mock.calls[0]?.[1] as URL;
    expect(urlArg.searchParams.has('iss')).toBe(false);
  });

  it('normalizes provider errors into an opaque failure', async () => {
    mocks.authorizationCodeGrant.mockRejectedValue(new Error('unexpected JWT alg received'));
    await expect(
      exchangeCallback({
        callbackUrl: new URL('http://localhost:3002/api/auth/oidc/callback?code=abc&state=s'),
        expectedState: 's',
        codeVerifier: 'v',
        expectedNonce: 'n',
      })
    ).rejects.toThrow('Sign-in could not be completed');
  });

  it('requires the stashed nonce for ID-token binding', async () => {
    await expect(
      exchangeCallback({
        callbackUrl: new URL('http://localhost:3002/api/auth/oidc/callback?code=abc&state=s'),
        expectedState: 's',
        codeVerifier: 'v',
        expectedNonce: undefined,
      })
    ).rejects.toThrow('Missing login state');
    expect(mocks.authorizationCodeGrant).not.toHaveBeenCalled();
  });
});

describe('getOidcRuntimeConfig', () => {
  it('derives the callback path from NEXT_PUBLIC_APP_URL when unset', () => {
    delete process.env.AUTH_REDIRECT_URI;
    const config = getOidcRuntimeConfig();
    expect(config?.redirectUri).toBe('http://localhost:3002/api/auth/oidc/callback');
  });
});

describe('portalBaseUrl', () => {
  it.each(['NEXT_PUBLIC_APP_URL', 'OIDC_BROWSER_BASE_URL'] as const)('uses configured %s and strips trailing slashes', (envVar) => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.OIDC_BROWSER_BASE_URL;
    process.env[envVar] = 'https://portal.example.test/';

    expect(portalBaseUrl()).toBe('https://portal.example.test');
  });

  it('prefers OIDC_BROWSER_BASE_URL over NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://prod.example.test';
    process.env.OIDC_BROWSER_BASE_URL = 'http://localhost:3002';

    expect(portalBaseUrl()).toBe('http://localhost:3002');
  });

  it('fails loud instead of trusting request-supplied hosts when unconfigured', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.OIDC_BROWSER_BASE_URL;

    expect(() => portalBaseUrl()).toThrow(/base URL is not configured/);
  });
});
