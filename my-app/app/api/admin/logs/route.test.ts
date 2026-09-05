import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), logs: vi.fn(), count: vi.fn(), audit: vi.fn(), names: vi.fn(), matches: vi.fn() }));
vi.mock('@/lib/adminAuth', () => ({ checkAuditAccessWithRateLimit: mocks.auth, checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { auditLog: { findMany: mocks.logs, count: mocks.count } } }));
vi.mock('@/lib/account-display-names', () => ({ resolveAccountDisplayNames: mocks.names, findAccountUsernamesByName: mocks.matches }));
vi.mock('@/lib/audit-log', () => ({ logAuditAction: mocks.audit, AuditActions: { VIEW_AUDIT_LOGS: 'view_audit_logs' }, AuditCategories: { LOGS: 'logs' }, getIpAddress: vi.fn(), getUserAgent: vi.fn(), sanitizeAuditDetails: (value: unknown) => value }));
import { GET } from './route';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'auditor', permissions: new Set(['audit.read']) }, response: null });
  mocks.logs.mockResolvedValue([{ id: 'log-1', username: 'admin1', subjectUsername: 'person1', details: null, success: true }]);
  mocks.count.mockResolvedValue(1);
  mocks.names.mockResolvedValue(new Map([['admin1', 'Alex Admin'], ['person1', 'Pat Person']]));
  mocks.matches.mockResolvedValue([]); mocks.audit.mockResolvedValue(undefined);
});
describe('audit log collection', () => {
  it('adds display labels without rewriting stored actor/subject identifiers', async () => {
    const response = await GET(new NextRequest('https://example.test/api/admin/logs'));
    expect(response.status).toBe(200);
    expect((await response.json()).logs[0]).toMatchObject({ username: 'admin1', actorDisplayName: 'Alex Admin', subjectUsername: 'person1', subjectDisplayName: 'Pat Person' });
    expect(mocks.names).toHaveBeenCalledExactlyOnceWith(['admin1', 'person1']);
  });
  it.each(['page=0', 'page=NaN', 'limit=10000', 'startDate=broken', 'startDate=2026-09-05&endDate=2026-09-01', 'success=maybe'])(
    'rejects invalid %s before reading logs or names', async (query) => {
      const response = await GET(new NextRequest(`https://example.test/api/admin/logs?${query}`));
      expect(response.status).toBe(400); expect(mocks.logs).not.toHaveBeenCalled(); expect(mocks.names).not.toHaveBeenCalled();
    },
  );
  it('combines person-name actor search with other filters', async () => {
    mocks.matches.mockResolvedValue(['admin1']);
    const response = await GET(new NextRequest('https://example.test/api/admin/logs?username=Alex&category=lifecycle'));
    expect(response.status).toBe(200);
    expect(mocks.logs.mock.calls[0][0].where).toMatchObject({ category: 'lifecycle', AND: [{ OR: [
      { username: { contains: 'Alex', mode: 'insensitive' } }, { username: { in: ['admin1'], mode: 'insensitive' } },
    ] }] });
  });
  it('does not resolve identities before authentication', async () => {
    mocks.auth.mockResolvedValue({ admin: null, response: null });
    expect((await GET(new NextRequest('https://example.test/api/admin/logs'))).status).toBe(401);
    expect(mocks.names).not.toHaveBeenCalled(); expect(mocks.matches).not.toHaveBeenCalled();
  });
});
