import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkRateLimitAsync: vi.fn(),
  verifyTurnstileToken: vi.fn(),
  searchUserByEmail: vi.fn(),
  getLDAPUserEmail: vi.fn(),
  getSessionFromCookies: vi.fn(),
  logActionHistoryEvent: vi.fn(),
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getRequiredClientIp: () => '203.0.113.10',
  isRateLimitUnavailable: () => false,
  RateLimitPresets: {
    passwordReset: {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
    },
  },
}));

vi.mock('@/lib/turnstile', () => ({
  verifyTurnstileToken: mocks.verifyTurnstileToken,
}));

vi.mock('@/lib/ldap', () => ({
  getLDAPUserEmail: mocks.getLDAPUserEmail,
  searchUserByEmail: mocks.searchUserByEmail,
}));

vi.mock('@/lib/session', () => ({
  getSessionFromCookies: mocks.getSessionFromCookies,
}));

vi.mock('@/lib/action-history', () => ({
  logActionHistoryEvent: mocks.logActionHistoryEvent,
}));

vi.mock('@/lib/audit-log', () => ({
  AuditActions: {
    PASSWORD_RESET_DENIED: 'password_reset_denied',
    PASSWORD_RESET_LINK_SENT: 'password_reset_link_sent',
  },
  AuditCategories: { AUTH: 'auth' },
  getUserAgent: () => 'vitest',
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/email', () => ({ sendPasswordResetEmail: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('@/lib/standardErrors', () => ({
  StandardErrors: {
    RATE_LIMIT_EXCEEDED: 'Rate limit exceeded',
    TURNSTILE_VALIDATION_FAILED: 'Turnstile validation failed',
    INVALID_INPUT: 'Invalid input',
    UNAUTHORIZED: 'Unauthorized',
    FORBIDDEN: 'Forbidden',
    SERVICE_UNAVAILABLE: 'Service unavailable',
  },
  internalError: () => NextResponse.json({ error: 'Internal error' }, { status: 500 }),
}));

import { POST } from './route';

function request(email: string, turnstileToken?: string) {
  return new NextRequest('https://portal.example.test/api/auth/request-password-reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, turnstileToken }),
  });
}

function allowedRateLimit(remaining = 9) {
  return {
    success: true,
    limit: 10,
    remaining,
    reset: Date.now() + 60 * 60 * 1000,
  };
}

describe('public password-reset target quota ordering', () => {
  let targetAttempts: number;

  beforeEach(() => {
    vi.clearAllMocks();
    targetAttempts = 0;
    mocks.checkRateLimitAsync.mockImplementation(async (key: string) => {
      if (key !== 'password-reset-target') {
        return allowedRateLimit();
      }

      targetAttempts += 1;
      return {
        success: targetAttempts <= 3,
        limit: 3,
        remaining: Math.max(0, 3 - targetAttempts),
        reset: Date.now() + 60 * 60 * 1000,
      };
    });
    mocks.verifyTurnstileToken.mockImplementation(
      async (token: string) => token === 'valid-turnstile-token'
    );
    mocks.searchUserByEmail.mockResolvedValue(null);
    mocks.logActionHistoryEvent.mockResolvedValue(undefined);
  });

  it.each([
    ['missing', undefined],
    ['invalid', 'invalid-turnstile-token'],
  ])(
    'does not consume a victim target quota for %s Turnstile attempts',
    async (_label, invalidToken) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const rejected = await POST(request('victim@example.test', invalidToken));
        expect(rejected.status).toBe(400);
      }

      const accepted = await POST(
        request('victim@example.test', 'valid-turnstile-token')
      );

      expect(accepted.status).toBe(200);
      expect(targetAttempts).toBe(1);
    }
  );

  it('validates public email syntax before consuming a target quota', async () => {
    const response = await POST(
      request('not-an-email', 'valid-turnstile-token')
    );

    expect(response.status).toBe(400);
    expect(targetAttempts).toBe(0);
  });

  it('still applies the three-request target quota after valid challenges', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const accepted = await POST(
        request('victim@example.test', 'valid-turnstile-token')
      );
      expect(accepted.status).toBe(200);
    }

    const limited = await POST(
      request('victim@example.test', 'valid-turnstile-token')
    );

    expect(limited.status).toBe(429);
    expect(targetAttempts).toBe(4);
  });
});
