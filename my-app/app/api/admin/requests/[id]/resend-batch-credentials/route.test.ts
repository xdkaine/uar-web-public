import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  send: vi.fn(),
  decrypt: vi.fn(),
  finalize: vi.fn(),
  audit: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: { accessRequest: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/email', () => ({ sendCredentialsEmail: mocks.send }));
vi.mock('@/lib/encryption', () => ({ decryptPassword: mocks.decrypt }));
vi.mock('@/lib/batch-credential-lifecycle', () => ({ finalizeDeliveredCredential: mocks.finalize }));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.audit,
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: () => '203.0.113.50',
  getUserAgent: () => 'credential-resend-test',
}));
vi.mock('@/lib/logger', () => ({ appLogger: { error: mocks.error } }));

import { POST } from './route';

const params = { params: Promise.resolve({ id: 'request-1' }) };
const request = (body?: Record<string, string>) => new NextRequest(
  'https://portal.example.test/api/admin/requests/request-1/resend-batch-credentials',
  {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  }
);

describe('batch credential delivery recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ admin: { username: 'live-admin', permissions: new Set(['access_requests.provision']) }, response: null });
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      name: 'Batch User',
      email: 'batch@example.test',
      ldapUsername: 'batchuser',
      accountPassword: 'ciphertext',
      accountExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      provisioningState: 'delivery_failed',
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.decrypt.mockReturnValue('Plaintext-Only-In-Memory!');
    mocks.send.mockResolvedValue(undefined);
    mocks.finalize.mockResolvedValue('completed');
    mocks.audit.mockResolvedValue(undefined);
  });

  it('requires authenticated live-admin authorization', async () => {
    mocks.auth.mockResolvedValue({
      admin: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await POST(request(), params);

    expect(response.status).toBe(401);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it('rejects an authenticated admin without provisioning permission before reading request input or data', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'read-only-admin', permissions: new Set(['access_requests.read']) },
      response: null,
    });
    const deniedRequest = request({ reconciliationOutcome: 'delivered' });
    const jsonSpy = vi.spyOn(deniedRequest, 'json');
    const paramsThen = vi.fn();
    const deniedParams = {
      params: { then: paramsThen } as unknown as Promise<{ id: string }>,
    };

    const response = await POST(deniedRequest, deniedParams);

    expect(response.status).toBe(403);
    expect(paramsThen).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('claims one delivery retry and finalizes ciphertext after delivery', async () => {
    const response = await POST(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ provisioningState: 'delivery_failed' }),
      data: expect.objectContaining({ provisioningState: 'delivery_retrying' }),
    }));
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.finalize).toHaveBeenCalledWith(
      'request-1',
      'ciphertext',
      'delivery_retrying'
    );
    expect(JSON.stringify(await response.json())).not.toContain('Plaintext-Only-In-Memory!');
  });

  it('rejects concurrent retries before decrypting', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(request(), params);

    expect(response.status).toBe(409);
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });

  it('moves an ambiguous SMTP failure to reconciliation without exposing plaintext', async () => {
    mocks.send.mockRejectedValue(new Error('SMTP unavailable Plaintext-Only-In-Memory!'));

    const response = await POST(request(), params);

    expect(response.status).toBe(202);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ provisioningState: 'delivery_reconciliation_required' }),
    }));
    expect(JSON.stringify({
      body: await response.json(),
      logs: mocks.error.mock.calls,
    })).not.toContain('Plaintext-Only-In-Memory!');
  });

  it('does not recover an active delivery lease', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      accountPassword: 'ciphertext',
      provisioningState: 'delivery_retrying',
      updatedAt: new Date(),
    });

    const response = await POST(request(), params);

    expect(response.status).toBe(409);
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('moves an expired delivery lease to reconciliation without resending', async () => {
    const staleUpdatedAt = new Date(Date.now() - 10 * 60 * 1000);
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      accountPassword: 'ciphertext',
      provisioningState: 'delivery_sending',
      updatedAt: staleUpdatedAt,
    });

    const response = await POST(request(), params);

    expect(response.status).toBe(202);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provisioningState: 'delivery_sending',
        accountPassword: 'ciphertext',
        updatedAt: staleUpdatedAt,
      }),
      data: expect.objectContaining({ provisioningState: 'delivery_reconciliation_required' }),
    }));
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('clears ciphertext after an operator confirms ambiguous delivery', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      accountPassword: 'ciphertext',
      provisioningState: 'delivery_reconciliation_required',
      updatedAt: new Date(),
    });

    const response = await POST(request({ reconciliationOutcome: 'delivered' }), params);

    expect(response.status).toBe(200);
    expect(mocks.finalize).toHaveBeenCalledWith(
      'request-1',
      'ciphertext',
      'delivery_reconciliation_required'
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('allows retry only after an operator confirms non-delivery', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      accountPassword: 'ciphertext',
      provisioningState: 'delivery_reconciliation_required',
      updatedAt: new Date(),
    });

    const response = await POST(request({ reconciliationOutcome: 'not_delivered' }), params);

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        provisioningState: 'delivery_reconciliation_required',
        accountPassword: 'ciphertext',
      }),
      data: expect.objectContaining({ provisioningState: 'delivery_failed' }),
    }));
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('reports a failed delivered reconciliation when finalization cannot claim the row', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'request-1',
      accountPassword: 'ciphertext',
      provisioningState: 'delivery_reconciliation_required',
      updatedAt: new Date(),
    });
    mocks.finalize.mockResolvedValue('reconciliation_required');

    const response = await POST(request({ reconciliationOutcome: 'delivered' }), params);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: false,
      provisioningState: 'reconciliation_required',
    });
  });

  it('re-reads and reports durable state when non-delivery reconciliation loses its claim', async () => {
    mocks.findUnique
      .mockResolvedValueOnce({
        id: 'request-1',
        accountPassword: 'ciphertext',
        provisioningState: 'delivery_reconciliation_required',
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({ provisioningState: 'delivery_reconciliation_required' });
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request({ reconciliationOutcome: 'not_delivered' }), params);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: false,
      provisioningState: 'delivery_reconciliation_required',
    });
  });

  it('does not report non-delivery success when a competing operator confirmed delivery', async () => {
    mocks.findUnique
      .mockResolvedValueOnce({
        id: 'request-1',
        accountPassword: 'ciphertext',
        provisioningState: 'delivery_reconciliation_required',
        updatedAt: new Date(),
      })
      .mockResolvedValueOnce({ provisioningState: 'completed' });
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request({ reconciliationOutcome: 'not_delivered' }), params);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ success: false, provisioningState: 'completed' });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      details: expect.objectContaining({
        confirmedOutcome: 'not_delivered',
        provisioningState: 'completed',
      }),
    }));
  });
});
