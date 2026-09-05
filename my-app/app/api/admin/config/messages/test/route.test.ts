import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  actorHasPermission: vi.fn(),
  getLDAPUserEmail: vi.fn(),
  sendMessageTemplateTest: vi.fn(),
  logAuditAction: vi.fn(),
  findManyRevisions: vi.fn(),
  checkRateLimitAsync: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/rbac/core', () => ({
  actorHasPermission: mocks.actorHasPermission,
}));

vi.mock('@/lib/ldap', () => ({
  getLDAPUserEmail: mocks.getLDAPUserEmail,
}));

vi.mock('@/lib/email', () => ({
  sendMessageTemplateTest: mocks.sendMessageTemplateTest,
}));

vi.mock('@/lib/audit-log', () => ({
  AuditActions: { TEST_MASS_EMAIL: 'test_mass_email' },
  AuditCategories: { MASS_EMAIL: 'mass_email' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { messageTemplateRevision: { findMany: mocks.findManyRevisions } },
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
  getClientIp: vi.fn(() => '127.0.0.1'),
  isRateLimitUnavailable: vi.fn(() => false),
  RateLimitPresets: { messageTemplateTest: { maxRequests: 5, windowMs: 3_600_000 } },
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
    admin: { username: 'admin1' },
    response: null,
  });
  mocks.actorHasPermission.mockReturnValue(true);
  mocks.getLDAPUserEmail.mockResolvedValue('admin1@example.edu');
  mocks.sendMessageTemplateTest.mockResolvedValue({ messageId: 'message-1', accepted: [] });
  mocks.logAuditAction.mockResolvedValue(undefined);
  mocks.findManyRevisions.mockResolvedValue([]);
  mocks.checkRateLimitAsync.mockResolvedValue({ success: true, limit: 5, remaining: 4, reset: Date.now() + 3_600_000 });
});

describe('POST /api/admin/config/messages/test', () => {
  it('rejects an unauthenticated request', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValueOnce({ admin: null, response: null });
    const response = await POST(new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(401);
    expect(mocks.sendMessageTemplateTest).not.toHaveBeenCalled();
  });

  it('requires the messages.manage permission', async () => {
    mocks.actorHasPermission.mockReturnValueOnce(false);
    const response = await POST(new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }));
    expect(response.status).toBe(403);
    expect(mocks.sendMessageTemplateTest).not.toHaveBeenCalled();
  });

  it('requires a verified directory email for the current administrator', async () => {
    mocks.getLDAPUserEmail.mockResolvedValueOnce(null);
    const response = await POST(new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'request.rejection_notice', subject: 'Update', body: '<p>Hello</p>' }),
    }));
    expect(response.status).toBe(409);
    expect(mocks.sendMessageTemplateTest).not.toHaveBeenCalled();
  });

  it('rejects a malformed directory email before auditing or sending', async () => {
    mocks.getLDAPUserEmail.mockResolvedValueOnce('not-an-email');
    const response = await POST(new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'request.rejection_notice', subject: 'Update', body: '<p>Hello</p>' }),
    }));

    expect(response.status).toBe(409);
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
    expect(mocks.sendMessageTemplateTest).not.toHaveBeenCalled();
  });

  it('sends to a validated specific address without resolving the administrator directory email', async () => {
    const response = await POST(new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice', subject: 'Update', body: '<p>Hello</p>',
        recipientMode: 'specific', recipient: ' Reviewer@Example.edu ',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.getLDAPUserEmail).not.toHaveBeenCalled();
    expect(mocks.sendMessageTemplateTest).toHaveBeenCalledWith(expect.objectContaining({
      to: 'reviewer@example.edu',
    }));
  });

  it('rejects an invalid specific address before auditing or sending', async () => {
    const response = await POST(new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice', subject: 'Update', body: '<p>Hello</p>',
        recipientMode: 'specific', recipient: 'not-an-email',
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.getLDAPUserEmail).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
    expect(mocks.sendMessageTemplateTest).not.toHaveBeenCalled();
  });

  it('sends the exact authoring sample with placeholders resolved', async () => {
    mocks.findManyRevisions.mockResolvedValue([
      {
        status: 'draft', version: 2, updatedAt: new Date('2026-08-28T10:00:00.000Z'),
        subject: 'Access update for {{name}}',
        body: '<p>Hello {{name}}</p><p>{{reason}}</p>',
        css: 'p { color: #333333; }',
      },
    ]);
    const request = new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice',
        subject: 'Access update for {{name}}',
        body: '<p>Hello {{name}}</p><p>{{reason}}</p>',
        css: 'p { color: #333333; }',
        expectedDraftUpdatedAt: '2026-08-28T10:00:00.000Z',
        expectedPublishedVersion: null,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.sendMessageTemplateTest).toHaveBeenCalledTimes(1);
    const sent = mocks.sendMessageTemplateTest.mock.calls[0][0];
    expect(sent.subject).toBe('[TEST] Access update for Alex Rivera');
    expect(sent.html).toContain('Hello Alex Rivera');
    expect(sent.html).toContain('Duplicate request');
    expect(sent.html).toMatch(/color:\s*#333333/i);
    expect(sent.html).not.toContain('{{name}}');
    expect(sent.html).not.toContain('{{reason}}');
    expect(sent.text).toContain('Hello Alex Rivera');
    expect(mocks.logAuditAction).toHaveBeenNthCalledWith(1, expect.objectContaining({ outcome: 'pending' }));
    expect(mocks.logAuditAction).toHaveBeenNthCalledWith(2, expect.objectContaining({ outcome: 'success' }));
  });

  it('renders stored revision content instead of caller-supplied HTML', async () => {
    mocks.findManyRevisions.mockResolvedValue([
      {
        status: 'draft', version: 2, updatedAt: new Date('2026-08-28T10:00:00.000Z'),
        subject: 'Stored subject for {{name}}',
        body: '<p>Stored body for {{name}}</p>',
        css: 'p { color: #123456; }',
      },
    ]);
    const request = new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice', subject: 'Posted subject', body: '<p>Posted body</p>', css: '',
        expectedDraftUpdatedAt: '2026-08-28T10:00:00.000Z', expectedPublishedVersion: null,
      }),
    });

    const response = await POST(request);
    const sent = mocks.sendMessageTemplateTest.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(sent.subject).toBe('[TEST] Stored subject for Alex Rivera');
    expect(sent.html).toContain('Stored body for Alex Rivera');
    expect(sent.html).not.toContain('Posted body');
  });

  it('returns success after SMTP acceptance when final audit update fails', async () => {
    mocks.logAuditAction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('audit unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'request.rejection_notice', subject: 'Update', body: '<p>Hello {{name}}</p>' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.sendMessageTemplateTest).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it('does not send when the pending audit record cannot be created', async () => {
    mocks.logAuditAction.mockRejectedValueOnce(new Error('audit unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'request.rejection_notice', subject: 'Update', body: '<p>Hello {{name}}</p>' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(mocks.sendMessageTemplateTest).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('records an SMTP failure after a pending send audit', async () => {
    mocks.sendMessageTemplateTest.mockRejectedValueOnce(new Error('relay rejected'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'request.rejection_notice', subject: 'Update', body: '<p>Hello {{name}}</p>' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(mocks.logAuditAction).toHaveBeenNthCalledWith(2, expect.objectContaining({ outcome: 'failure' }));
    consoleError.mockRestore();
  });

  it('rejects a stale editor revision before resolving a recipient or sending', async () => {
    mocks.findManyRevisions.mockResolvedValue([
      { status: 'draft', version: 2, updatedAt: new Date('2026-08-28T10:00:00.000Z') },
    ]);
    const request = new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice', subject: 'Update', body: '<p>Hello</p>',
        expectedDraftUpdatedAt: '2026-08-28T09:00:00.000Z', expectedPublishedVersion: null,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(409);
    expect(mocks.getLDAPUserEmail).not.toHaveBeenCalled();
    expect(mocks.sendMessageTemplateTest).not.toHaveBeenCalled();
  });

  it('applies the dedicated message-test rate limit', async () => {
    mocks.checkRateLimitAsync.mockResolvedValueOnce({ success: false, limit: 5, remaining: 0, reset: Date.now() + 3_600_000 });
    const request = new NextRequest('http://localhost/api/admin/config/messages/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'request.rejection_notice', subject: 'Update', body: '<p>Hello</p>' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(mocks.sendMessageTemplateTest).not.toHaveBeenCalled();
  });
});
