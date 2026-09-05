import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  sendVerificationEmail: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { accessRequest: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/email', () => ({ sendVerificationEmail: mocks.sendVerificationEmail }));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditActions: { RESEND_VERIFICATION_EMAIL: 'resend_verification_email' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: () => '203.0.113.42',
  getUserAgent: () => 'resend-test',
}));
vi.mock('@/lib/logger', () => ({
  appLogger: { info: vi.fn(), error: vi.fn() },
}));
vi.mock('nanoid', () => ({ nanoid: () => 'rotated-token' }));

import { POST } from './route';

const params = { params: Promise.resolve({ id: 'request-1' }) };

function request() {
  return new NextRequest(
    'https://portal.example.test/api/admin/requests/request-1/resend-verification',
    { method: 'POST' }
  );
}

describe('verification email recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'live-admin', permissions: new Set(['access_requests.provision']) },
      response: null,
    });
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      name: 'Requester',
      email: 'requester@example.test',
      isVerified: false,
      status: 'verification_email_failed',
      verificationToken: 'previous-token',
      verificationTokenHash: null,
      verificationAttempts: 1,
      verificationTokenExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.sendVerificationEmail.mockResolvedValue(undefined);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('preserves live-admin authorization', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await POST(request(), params);

    expect(response.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('atomically rotates and completes a failed verification delivery', async () => {
    const response = await POST(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        id: 'request-1',
        verificationToken: 'previous-token',
        verificationTokenHash: null,
        status: { in: ['pending_verification', 'verification_email_failed'] },
      }),
      data: expect.objectContaining({
        verificationToken: null,
        verificationTokenHash: '950141f5143d92b8f45b56cf546a3bef20e359c018127d87e656bd2ba2d1d842',
        status: 'verification_email_sending',
      }),
    }));
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        verificationTokenHash: '950141f5143d92b8f45b56cf546a3bef20e359c018127d87e656bd2ba2d1d842',
        status: 'verification_email_sending',
      }),
      data: expect.objectContaining({ status: 'pending_verification' }),
    }));
    expect(mocks.logAuditAction).toHaveBeenCalledOnce();
  });

  it('rejects an invalid source state without sending', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      isVerified: true,
      status: 'pending_student_directors',
    });

    const response = await POST(request(), params);

    expect(response.status).toBe(400);
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('rejects a concurrent resend claim', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(request(), params);

    expect(response.status).toBe(409);
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('retains the rotated token in a usable failure state when SMTP fails', async () => {
    mocks.sendVerificationEmail.mockRejectedValue(new Error('SMTP unavailable'));

    const response = await POST(request(), params);

    expect(response.status).toBe(500);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'request-1',
        verificationTokenHash: '950141f5143d92b8f45b56cf546a3bef20e359c018127d87e656bd2ba2d1d842',
        status: 'verification_email_sending',
      },
      data: {
        status: 'verification_email_failed',
        provisioningState: 'verification_email_failed',
        provisioningError: 'Verification email delivery failed',
      },
    });
  });

  it('rejects recovery while a delivery lease is still active', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      name: 'Requester',
      email: 'requester@example.test',
      isVerified: false,
      status: 'verification_email_sending',
      verificationToken: 'in-flight-token',
      updatedAt: new Date(),
    });

    const response = await POST(request(), params);

    expect(response.status).toBe(409);
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('reconciles an expired delivery lease without sending a duplicate email', async () => {
    const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000);
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      name: 'Requester',
      email: 'requester@example.test',
      isVerified: false,
      status: 'verification_email_sending',
      verificationToken: 'possibly-delivered-token',
      updatedAt: staleUpdatedAt,
    });

    const response = await POST(request(), params);

    expect(response.status).toBe(202);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'verification_email_sending',
        verificationToken: 'possibly-delivered-token',
        updatedAt: staleUpdatedAt,
      }),
      data: expect.objectContaining({ status: 'pending_verification' }),
    }));
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).toHaveBeenCalledOnce();
  });

  it('returns a recoverable accepted response when delivery completion persistence fails', async () => {
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('database unavailable'));

    const response = await POST(request(), params);

    expect(response.status).toBe(202);
    expect(mocks.sendVerificationEmail).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual(expect.objectContaining({ success: false }));
  });

  it('returns a recoverable accepted response when the completion claim is lost', async () => {
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const response = await POST(request(), params);

    expect(response.status).toBe(202);
    expect(mocks.sendVerificationEmail).toHaveBeenCalledOnce();
  });

  it('recovers after both SMTP and failure-state persistence fail', async () => {
    mocks.sendVerificationEmail.mockRejectedValueOnce(new Error('SMTP outcome unknown'));
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ count: 1 });

    const failedResponse = await POST(request(), params);
    expect(failedResponse.status).toBe(500);

    const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000);
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      name: 'Requester',
      email: 'requester@example.test',
      isVerified: false,
      status: 'verification_email_sending',
      verificationToken: 'rotated-token',
      updatedAt: staleUpdatedAt,
    });
    const recoveryResponse = await POST(request(), params);

    expect(recoveryResponse.status).toBe(202);
    expect(mocks.sendVerificationEmail).toHaveBeenCalledOnce();
  });
});
