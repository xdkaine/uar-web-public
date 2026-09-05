import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkRateLimitAsync: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  sendAdminNotification: vi.fn(),
  markNotificationPending: vi.fn(),
  logActionHistoryEvent: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { accessRequest: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getRequiredClientIp: () => '203.0.113.60',
  isRateLimitUnavailable: () => false,
  RateLimitPresets: { verification: { maxRequests: 10, windowMs: 60_000 } },
}));
vi.mock('@/lib/email', () => ({ sendAdminNotification: mocks.sendAdminNotification }));
vi.mock('@/lib/notification-queue', () => ({ markNotificationPending: mocks.markNotificationPending }));
vi.mock('@/lib/logger', () => ({ appLogger: { error: vi.fn() } }));
vi.mock('@/lib/action-history', () => ({ logActionHistoryEvent: mocks.logActionHistoryEvent }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: {
    EMAIL_VERIFICATION_FAILED: 'email_verification_failed',
    EMAIL_VERIFICATION_COMPLETED: 'email_verification_completed',
  },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getUserAgent: () => 'verification-test',
}));

import { POST } from './route';
import { hashAccessRequestVerificationToken } from '@/lib/access-request-verification';

function request() {
  return new NextRequest('https://portal.example.test/api/verify/confirm?token=verification-token', {
    method: 'POST',
  });
}

function record(status: string) {
  return {
    id: 'request-1',
    name: 'Requester',
    email: 'requester@example.test',
    isInternal: false,
    needsDomainAccount: true,
    eventReason: null,
    isVerified: false,
    status,
    verificationToken: null,
    verificationTokenHash: hashAccessRequestVerificationToken('verification-token'),
    verificationAttempts: 0,
    verificationTokenExpiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  };
}

describe('verification claim recovery states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitAsync.mockResolvedValue({ success: true });
    mocks.findFirst.mockResolvedValue(record('verification_email_failed'));
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.sendAdminNotification.mockResolvedValue(undefined);
    mocks.logActionHistoryEvent.mockResolvedValue(undefined);
  });

  it.each(['verification_email_failed', 'verification_email_sending'])(
    'atomically verifies a token from %s',
    async status => {
      mocks.findFirst.mockResolvedValue(record(status));

      const response = await POST(request());

      expect(response.status).toBe(200);
      expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          isVerified: false,
          status: { in: expect.arrayContaining([status]) },
          verificationAttempts: { lt: 5 },
        }),
        data: expect.objectContaining({
          isVerified: true,
          status: 'pending_student_directors',
          verificationToken: null,
          verificationTokenHash: null,
        }),
      }));
    }
  );

  it('rejects an expired recovered-state token before the verification claim', async () => {
    mocks.findFirst.mockResolvedValue({
      ...record('verification_email_sending'),
      verificationTokenExpiresAt: new Date(Date.now() - 60_000),
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.sendAdminNotification).not.toHaveBeenCalled();
  });

  it('rejects replay after another verifier has already claimed the request', async () => {
    mocks.findFirst.mockResolvedValue({
      ...record('verification_email_failed'),
      isVerified: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a competing verification claim', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.sendAdminNotification).not.toHaveBeenCalled();
  });
});
