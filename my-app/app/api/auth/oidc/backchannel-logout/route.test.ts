import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  revokeSessionsByProviderSid: vi.fn(),
  logAuditAction: vi.fn(),
  checkRateLimitAsync: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  revokeSessionsByProviderSid: mocks.revokeSessionsByProviderSid,
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getRequiredClientIp: () => '192.0.2.7',
  isRateLimitUnavailable: (error: unknown) =>
    error instanceof Error && error.name === 'RateLimitUnavailableError',
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  getIpAddress: () => '203.0.113.9',
  getUserAgent: () => 'auth-service-backchannel',
}));

vi.mock('@/lib/logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { POST } from './route';
import { resetBackchannelJwksCache } from '@/lib/auth/backchannel-receiver';

const ISSUER = 'https://auth.example.test';
const CLIENT_ID = 'uar-portal';
const KID = 'auth-service-key-1';
const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

const provider = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function publicJwk(): JsonWebKey {
  return {
    ...(provider.publicKey.export({ format: 'jwk' }) as JsonWebKey),
    kid: KID,
    alg: 'RS256',
    use: 'sig',
  };
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signLogoutToken(claims: Record<string, unknown>, signingKey?: crypto.KeyObject): string {
  const header = { alg: 'RS256', kid: KID };
  const key = signingKey ?? provider.privateKey;
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url');
  return `${signingInput}.${signature}`;
}

function baseClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    iat: Math.floor(Date.now() / 1000),
    jti: 'logout-jti',
    events: { [BACKCHANNEL_EVENT]: {} },
    sid: 'provider-session-1',
    ...overrides,
  };
}

function serveDiscoveryAndJwks(keys: JsonWebKey[] = [publicJwk()]): void {
  mocks.fetch.mockImplementation(async (url: string | URL) => {
    const target = String(url);
    if (target === `${ISSUER}/.well-known/openid-configuration`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` }),
      };
    }
    if (target === `${ISSUER}/jwks`) {
      return { ok: true, status: 200, json: async () => ({ keys }) };
    }
    throw new Error(`unexpected fetch: ${target}`);
  });
}

function post(body: string): NextRequest {
  return new NextRequest('https://portal.example.test/api/auth/oidc/backchannel-logout', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

function postLogoutToken(token: string): NextRequest {
  return post(new URLSearchParams({ logout_token: token }).toString());
}

beforeEach(() => {
  vi.clearAllMocks();
  resetBackchannelJwksCache();
  process.env.AUTH_MODE = 'oidc';
  process.env.AUTH_ISSUER = ISSUER;
  process.env.AUTH_CLIENT_ID = CLIENT_ID;
  process.env.AUTH_CLIENT_SECRET = 'test-secret';
  delete process.env.OIDC_INTERNAL_ISSUER_URL;
  serveDiscoveryAndJwks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.checkRateLimitAsync.mockResolvedValue({
    success: true,
    limit: 60,
    remaining: 59,
    reset: Date.now() + 60_000,
  });
  mocks.revokeSessionsByProviderSid.mockResolvedValue([
    { sessionId: 'session-row-1', username: 'tphao' },
  ]);
  mocks.logAuditAction.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/auth/oidc/backchannel-logout', () => {
  it('throttles excessive unauthenticated traffic before any crypto or state work', async () => {
    mocks.checkRateLimitAsync.mockResolvedValue({
      success: false,
      limit: 60,
      remaining: 0,
      reset: Date.now() + 60_000,
    });

    const response = await POST(postLogoutToken(signLogoutToken(baseClaims())));

    expect(response.status).toBe(429);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.revokeSessionsByProviderSid).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('fails closed with 503 when the rate-limit store is unavailable', async () => {
    const outage = new Error('redis down');
    outage.name = 'RateLimitUnavailableError';
    mocks.checkRateLimitAsync.mockRejectedValue(outage);

    const response = await POST(postLogoutToken(signLogoutToken(baseClaims())));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.revokeSessionsByProviderSid).not.toHaveBeenCalled();
  });

  it('revokes the matching session and answers 200 no-store with an audit row', async () => {
    const response = await POST(postLogoutToken(signLogoutToken(baseClaims())));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({});
    expect(mocks.revokeSessionsByProviderSid).toHaveBeenCalledWith('provider-session-1');
    expect(mocks.logAuditAction).toHaveBeenCalledTimes(1);
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'idp_backchannel_logout',
        category: 'session',
        username: 'tphao',
        actorType: 'system',
        targetType: 'Session',
        targetId: 'session-row-1',
        outcome: 'success',
        success: true,
        details: expect.objectContaining({ matchedSession: true, revokedSessionCount: 1 }),
      })
    );
  });

  it('still answers 200 and audits a distinct skipped row for an unknown sid', async () => {
    mocks.revokeSessionsByProviderSid.mockResolvedValue([]);

    const response = await POST(postLogoutToken(signLogoutToken(baseClaims())));

    expect(response.status).toBe(200);
    expect(mocks.revokeSessionsByProviderSid).toHaveBeenCalledTimes(1);
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'idp_backchannel_logout',
        username: 'unknown',
        outcome: 'skipped',
        success: false,
        details: expect.objectContaining({ matchedSession: false, revokedSessionCount: 0 }),
      })
    );
  });

  it('returns 503 instead of falsely acknowledging a session revocation failure', async () => {
    mocks.revokeSessionsByProviderSid.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(postLogoutToken(signLogoutToken(baseClaims())));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it.each([
    ['bad signature', signLogoutToken(baseClaims(), attacker.privateKey)],
    ['wrong aud', signLogoutToken(baseClaims({ aud: 'other-client' }))],
    ['wrong iss', signLogoutToken(baseClaims({ iss: 'https://evil.example.test' }))],
    ['missing event', signLogoutToken(baseClaims({ events: {} }))],
    ['nonce present', signLogoutToken(baseClaims({ nonce: 'n' }))],
    ['far-future iat', signLogoutToken(baseClaims({ iat: Math.floor(Date.now() / 1000) + 3600 }))],
  ])('rejects %s with 400 and NO side effects', async (_label, token) => {
    const response = await POST(postLogoutToken(token));

    expect(response.status).toBe(400);
    expect(mocks.revokeSessionsByProviderSid).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('tolerates replayed logout tokens - both attempts answer 200', async () => {
    const token = signLogoutToken(baseClaims());

    const first = await POST(postLogoutToken(token));
    mocks.revokeSessionsByProviderSid.mockResolvedValue([]);
    const second = await POST(postLogoutToken(token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.revokeSessionsByProviderSid).toHaveBeenNthCalledWith(1, 'provider-session-1');
    expect(mocks.revokeSessionsByProviderSid).toHaveBeenNthCalledWith(2, 'provider-session-1');
  });

  it.each([
    ['empty body', ''],
    ['form without logout_token field', 'other=value'],
    ['json garbage', '{"logout_token": 1}'],
    ['plain text', 'not-a-form-body'],
  ])('answers 400 for malformed body: %s', async (_label, body) => {
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.revokeSessionsByProviderSid).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('keeps answering 200 when the audit write itself fails', async () => {
    mocks.logAuditAction.mockRejectedValue(new Error('audit db down'));

    const response = await POST(postLogoutToken(signLogoutToken(baseClaims())));

    expect(response.status).toBe(200);
    expect(mocks.revokeSessionsByProviderSid).toHaveBeenCalledTimes(1);
  });
});
