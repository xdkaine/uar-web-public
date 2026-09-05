import { afterEach, describe, expect, it } from 'vitest';

import { getClientIp } from './ratelimit';

describe('rate-limit client IP attribution', () => {
  const originalTrust = process.env.TRUST_PROXY_HEADERS;

  afterEach(() => {
    if (originalTrust === undefined) delete process.env.TRUST_PROXY_HEADERS;
    else process.env.TRUST_PROXY_HEADERS = originalTrust;
  });

  it('uses the rightmost proxy-overwritten hop just like the auth service', () => {
    process.env.TRUST_PROXY_HEADERS = 'true';
    const request = new Request('https://portal.example.test/api/auth/login', {
      headers: { 'x-forwarded-for': '198.51.100.8, 203.0.113.10' },
    });

    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it('ignores forwarding headers unless proxy trust is explicit', () => {
    process.env.TRUST_PROXY_HEADERS = 'false';
    const request = new Request('https://portal.example.test/api/auth/login', {
      headers: { 'x-forwarded-for': '198.51.100.8' },
    });

    expect(getClientIp(request)).toBe('unknown');
  });
});
