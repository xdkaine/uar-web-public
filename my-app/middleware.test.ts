import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { middleware } from './middleware';

describe('middleware access logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    '/api/verify?token=verification-canary',
    '/api/auth/reset-password?token=reset-canary',
    '/api/offboard/verify/confirm?token=offboard-canary',
  ])('logs only the pathname for token-bearing request %s', async (path) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const request = new NextRequest(`https://example.test${path}`, {
      headers: {
        referer: `https://example.test/reset-password?token=referer-canary`,
      },
    });

    await middleware(request);

    const serializedLogs = log.mock.calls.flat().join(' ');
    expect(serializedLogs).toContain(new URL(request.url).pathname);
    expect(serializedLogs).not.toContain(new URL(request.url).search.slice(1));
    expect(serializedLogs).not.toContain('referer-canary');
    expect(serializedLogs).not.toContain('reset-password?token=');
  });

  it('preserves non-sensitive access-log fields', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const request = new NextRequest('https://example.test/api/settings/banner', {
      headers: { 'user-agent': 'vitest-agent' },
    });

    await middleware(request);

    const entry = JSON.parse(String(log.mock.calls[0][0]));
    expect(entry).toMatchObject({
      message: 'Incoming Request',
      method: 'GET',
      pathname: '/api/settings/banner',
      userAgent: 'vitest-agent',
      type: 'access_log',
    });
    expect(entry).not.toHaveProperty('url');
    expect(entry).not.toHaveProperty('referer');
  });

  it('does not copy unrelated admin query parameters into the login redirect', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const request = new NextRequest('https://example.test/admin/requests?token=sensitive-canary');

    const response = await middleware(request);

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).not.toBeNull();
    expect(new URL(location!).searchParams.get('redirect')).toBe('/admin/requests');
    expect(location).not.toContain('sensitive-canary');
  });

  it('overwrites a client-supplied admin pathname before forwarding the request', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const request = new NextRequest('https://example.test/admin/requests', {
      headers: {
        cookie: 'session_token=test-session',
        'x-uar-admin-pathname': '/admin/settings',
      },
    });

    const response = await middleware(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-uar-admin-pathname')).toBe('/admin/requests');
  });

});
