import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ appLogger: { warn: mocks.warn } }));

import {
  requestProviderBackchannelLogout,
  requestProviderBackchannelLogoutDetailed,
} from './backchannel';

function setEnv(
  values: Partial<Record<'OIDC_INTERNAL_ISSUER_URL' | 'AUTH_ISSUER' | 'AUTH_CLIENT_ID' | 'AUTH_CLIENT_SECRET', string>>
) {
  delete process.env.OIDC_INTERNAL_ISSUER_URL;
  delete process.env.AUTH_ISSUER;
  delete process.env.AUTH_CLIENT_ID;
  delete process.env.AUTH_CLIENT_SECRET;
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestProviderBackchannelLogout', () => {
  it('is a no-op without a provider sid', async () => {
    setEnv({
      OIDC_INTERNAL_ISSUER_URL: 'http://auth-service:3003',
      AUTH_CLIENT_ID: 'uar-portal',
      AUTH_CLIENT_SECRET: 'secret',
    });

    const result = await requestProviderBackchannelLogout(undefined);

    expect(result).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('is a no-op when credentials are absent (native mode)', async () => {
    setEnv({ AUTH_ISSUER: 'http://auth-service:3003' });

    const result = await requestProviderBackchannelLogout('some-sid');

    expect(result).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('prefers the internal issuer base and authenticates with basic creds', async () => {
    setEnv({
      OIDC_INTERNAL_ISSUER_URL: 'http://auth-service:3003',
      AUTH_ISSUER: 'https://auth.example.test',
      AUTH_CLIENT_ID: 'uar-portal',
      AUTH_CLIENT_SECRET: 'secret',
    });
    mocks.fetch.mockResolvedValue({ ok: true, status: 204 });

    const result = await requestProviderBackchannelLogout('sid-123');

    expect(result).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('http://auth-service:3003/session/backchannel-logout');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('uar-portal:secret').toString('base64')}`
    );
    expect(JSON.parse(init.body)).toEqual({ sid: 'sid-123' });
  });

  it('falls back to the external issuer for non-compose deployments', async () => {
    setEnv({
      AUTH_ISSUER: 'https://auth.example.test',
      AUTH_CLIENT_ID: 'uar-portal',
      AUTH_CLIENT_SECRET: 'secret',
    });
    mocks.fetch.mockResolvedValue({ ok: true, status: 204 });

    await requestProviderBackchannelLogout('sid-123');

    expect((mocks.fetch.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://auth.example.test/session/backchannel-logout'
    );
  });

  it('returns false on rejection responses', async () => {
    setEnv({
      OIDC_INTERNAL_ISSUER_URL: 'http://auth-service:3003',
      AUTH_CLIENT_ID: 'uar-portal',
      AUTH_CLIENT_SECRET: 'secret',
    });
    mocks.fetch.mockResolvedValue({ ok: false, status: 401 });

    const result = await requestProviderBackchannelLogout('sid-123');

    expect(result).toBe(false);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('sid-123');
    expect(mocks.warn).toHaveBeenCalledWith(
      '[Oidc] Backchannel logout rejected',
      expect.objectContaining({ providerSidHash: expect.any(String) }),
    );
  });

  it('survives network failures (logout must not break)', async () => {
    setEnv({
      OIDC_INTERNAL_ISSUER_URL: 'http://auth-service:3003',
      AUTH_CLIENT_ID: 'uar-portal',
      AUTH_CLIENT_SECRET: 'secret',
    });
    mocks.fetch.mockRejectedValue(new Error('connect timeout'));

    const result = await requestProviderBackchannelLogout('sid-123');

    expect(result).toBe(false);
  });
});

describe('requestProviderBackchannelLogoutDetailed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports not-configured without a provider sid', async () => {
    setEnv({
      OIDC_INTERNAL_ISSUER_URL: 'http://auth-service:3003',
      AUTH_CLIENT_ID: 'uar-portal',
      AUTH_CLIENT_SECRET: 'secret',
    });

    const result = await requestProviderBackchannelLogoutDetailed(undefined);

    expect(result).toEqual({ outcome: 'not-configured', providerLogoutAttempted: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('reports not-configured when the auth-service integration is absent', async () => {
    setEnv({});

    const result = await requestProviderBackchannelLogoutDetailed('sid-123');

    expect(result).toEqual({ outcome: 'not-configured', providerLogoutAttempted: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('reports success on a confirmed destruction', async () => {
    setEnv({
      OIDC_INTERNAL_ISSUER_URL: 'http://auth-service:3003',
      AUTH_CLIENT_ID: 'uar-portal',
      AUTH_CLIENT_SECRET: 'secret',
    });
    mocks.fetch.mockResolvedValue({ ok: true, status: 204 });

    const result = await requestProviderBackchannelLogoutDetailed('sid-123');

    expect(result).toEqual({ outcome: 'success', providerLogoutAttempted: true });
  });

  it('reports failure on rejection responses', async () => {
    setEnv({
      OIDC_INTERNAL_ISSUER_URL: 'http://auth-service:3003',
      AUTH_CLIENT_ID: 'uar-portal',
      AUTH_CLIENT_SECRET: 'secret',
    });
    mocks.fetch.mockResolvedValue({ ok: false, status: 503 });

    const result = await requestProviderBackchannelLogoutDetailed('sid-123');

    expect(result).toEqual({ outcome: 'failure', providerLogoutAttempted: true });
  });

  it('reports failure on network errors (IdP unreachable)', async () => {
    setEnv({
      OIDC_INTERNAL_ISSUER_URL: 'http://auth-service:3003',
      AUTH_CLIENT_ID: 'uar-portal',
      AUTH_CLIENT_SECRET: 'secret',
    });
    mocks.fetch.mockRejectedValue(new Error('connect timeout'));

    const result = await requestProviderBackchannelLogoutDetailed('sid-123');

    expect(result).toEqual({ outcome: 'failure', providerLogoutAttempted: true });
  });
});
