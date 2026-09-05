import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  runPasswordCleanup: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/password-cleanup', () => ({ runPasswordCleanup: mocks.runPasswordCleanup }));
vi.mock('@/lib/logger', () => ({
  appLogger: { warn: mocks.warn, error: mocks.error },
}));

import { POST } from './route';

function request(token?: string) {
  return new NextRequest('https://portal.example.test/api/cron/process-password-cleanup', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

describe('password cleanup scheduler route', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'cron-secret-with-at-least-32-characters';
    process.env.PASSWORD_CREDENTIAL_RETENTION_DAYS = '7';
    mocks.runPasswordCleanup.mockResolvedValue({
      accessRequestsCleared: 1,
      batchAccountsCleared: 2,
      totalCleared: 3,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects requests without the cron bearer token', async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.runPasswordCleanup).not.toHaveBeenCalled();
  });

  it('runs cleanup with the configured retention period', async () => {
    const response = await POST(request(process.env.CRON_SECRET));

    expect(response.status).toBe(200);
    expect(mocks.runPasswordCleanup).toHaveBeenCalledWith(7);
  });

  it('returns failure when cleanup cannot complete', async () => {
    mocks.runPasswordCleanup.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(request(process.env.CRON_SECRET));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Password cleanup failed' });
  });
});
