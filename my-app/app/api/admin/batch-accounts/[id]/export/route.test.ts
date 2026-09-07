import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), config: vi.fn(), build: vi.fn(), audit: vi.fn(), decrypt: vi.fn() }));
vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: (admin: { permissions: Set<string> }, permission: string) => admin.permissions.has(permission) }));
vi.mock('@/lib/prisma', () => ({ prisma: { batchAccountCreation: { findUnique: mocks.find } } }));
vi.mock('@/lib/config/resolver', () => ({ getConfigValue: mocks.config }));
vi.mock('@/lib/encryption', () => ({ decryptPassword: mocks.decrypt }));
vi.mock('@/lib/batch-account-export', () => ({ buildBatchAccountExport: mocks.build }));
vi.mock('@/lib/audit-log', () => ({ logAuditAction: mocks.audit, AuditCategories: { BATCH: 'batch' }, getIpAddress: () => '127.0.0.1', getUserAgent: () => 'test' }));
import { POST } from './route';
const params = { params: Promise.resolve({ id: 'batch-1' }) };
const request = (csrf = true) => new NextRequest('http://localhost/api/admin/batch-accounts/batch-1/export', {
  method: 'POST', headers: csrf ? { cookie: 'csrf-token=test-csrf', 'x-csrf-token': 'test-csrf' } : {},
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'operator', permissions: new Set(['batch.manage']) } });
  mocks.find.mockResolvedValue({ id: 'batch-1', createdBy: 'Operator', status: 'completed', accounts: [{ id: 'item-1' }] });
  mocks.config.mockResolvedValue(7);
  mocks.build.mockResolvedValue({ bytes: new Uint8Array([80, 75]), disclosures: [{ itemId: 'item-1', availability: 'Available: initial password (may have changed)' }] });
});

describe('batch export authorization and disclosure', () => {
  it('returns a no-store XLSX attachment only after durable audit', async () => {
    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('content-disposition')).toContain('attachment; filename="batch-accounts-batch-1.xlsx"');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'export_batch_initial_passwords', username: 'operator', details: { accounts: [{ itemId: 'item-1', availability: 'Available: initial password (may have changed)' }], totalAccounts: 1 } }));
    expect(mocks.build.mock.invocationCallOrder[0]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0]);
  });

  it('rejects unauthenticated requests before reading credentials', async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({}, { status: 401 }) });
    expect((await POST(request(), params)).status).toBe(401);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it('preserves rate limiting', async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({}, { status: 429 }) });
    expect((await POST(request(), params)).status).toBe(429);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it('requires batch.manage and CSRF', async () => {
    expect((await POST(request(false), params)).status).toBe(403);
    mocks.auth.mockResolvedValue({ admin: { username: 'operator', permissions: new Set() } });
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it('rejects a different batch manager', async () => {
    mocks.find.mockResolvedValue({ id: 'batch-1', createdBy: 'another-operator', status: 'completed' });
    expect((await POST(request(), params)).status).toBe(403);
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it('handles absent batches', async () => {
    mocks.find.mockResolvedValue(null);
    expect((await POST(request(), params)).status).toBe(404);
  });
  it.each(['processing', 'rolling_back', 'reconciliation_required', 'cancelled'])('rejects %s batches', async status => {
    mocks.find.mockResolvedValue({ createdBy: 'operator', status });
    expect((await POST(request(), params)).status).toBe(409);
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it('fails closed for invalid retention configuration', async () => {
    mocks.config.mockResolvedValue(0);
    expect((await POST(request(), params)).status).toBe(503);
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it.each(['audit', 'build'] as const)('releases no file when %s fails without leaking exceptions', async operation => {
    mocks[operation].mockRejectedValue(new Error('synthetic-sensitive-input'));
    const response = await POST(request(), params);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await response.text()).not.toContain('synthetic-sensitive-input');
  });
});
