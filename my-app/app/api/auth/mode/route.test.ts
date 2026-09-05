import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ policy: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/auth/sign-in-policy', () => ({ getPortalSignInPolicy: mocks.policy }));
vi.mock('@/lib/logger', () => ({ appLogger: { error: mocks.error } }));

import { GET } from './route';

const methods = [
  { id: 'oidc', displayName: 'Campus Auth', description: 'Continue to Campus Auth.', enabled: true, ready: true, readinessIssue: null },
  { id: 'native_ad', displayName: 'Active Directory', description: 'Sign in directly.', enabled: true, ready: true, readinessIssue: null },
  { id: 'local_break_glass', displayName: 'Local break-glass', description: 'Use a portal local account.', enabled: false, ready: true, readinessIssue: null },
];

describe('GET /api/auth/mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.policy.mockResolvedValue({ source: 'database', methods });
  });

  it('returns ordered display objects and temporary compatibility fields', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      methods: [
        { id: 'oidc', displayName: 'Campus Auth', description: 'Continue to Campus Auth.' },
        { id: 'native_ad', displayName: 'Active Directory', description: 'Sign in directly.' },
      ],
      policySource: 'database',
      authMode: 'oidc',
      configuredAuthMode: 'oidc',
      availableSignInMethods: ['oidc', 'native_ad'],
    });
  });

  it('never advertises an enabled method that is not ready', async () => {
    mocks.policy.mockResolvedValue({ source: 'database', methods: methods.map((method) =>
      method.id === 'oidc' ? { ...method, ready: false, readinessIssue: 'missing config' } : method
    ) });
    const response = await GET();
    const data = await response.json();
    expect(data.availableSignInMethods).toEqual(['native_ad']);
    expect(data.authMode).toBe('native');
  });

  it('fails closed when no enabled method is usable', async () => {
    mocks.policy.mockResolvedValue({ source: 'database', methods: methods.map((method) => ({ ...method, ready: false })) });
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'No sign-in method is currently available.', methods: [] });
  });
});
