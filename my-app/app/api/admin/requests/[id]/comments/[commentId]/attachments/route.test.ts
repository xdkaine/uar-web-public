import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimit: vi.fn(),
  commentFindFirst: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  attachmentCount: vi.fn(),
  attachmentCreateMany: vi.fn(),
  stage: vi.fn(),
  cleanup: vi.fn(),
  classify: vi.fn(),
  scan: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  readFile: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('node:fs', () => ({
  createReadStream: vi.fn(() => ({})),
  promises: { readFile: mocks.readFile },
}));
vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/ratelimit', () => ({ checkRateLimitAsync: mocks.rateLimit }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    requestComment: { findFirst: mocks.commentFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/assets/multipart-upload', () => ({
  MultipartUploadError: class MultipartUploadError extends Error {},
  stageMultipartUpload: mocks.stage,
  cleanupStagedUpload: mocks.cleanup,
}));
vi.mock('@/lib/assets/attachment-policy', () => ({ classifyAttachment: mocks.classify }));
vi.mock('@/lib/assets/clamav', () => ({ scanAttachmentStream: mocks.scan }));
vi.mock('@/lib/assets/storage', () => ({
  putAssetBytes: mocks.put,
  deleteAssetBytes: mocks.remove,
  sha256Hex: vi.fn(() => 'sha256'),
}));
vi.mock('@/lib/audit-log', () => ({
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
}));

import { POST } from './route';

const context = { params: Promise.resolve({ id: 'request-1', commentId: 'comment-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    admin: { username: 'operator', permissions: new Set(['access_requests.respond']) },
    response: null,
  });
  mocks.rateLimit.mockResolvedValue({ success: true });
  mocks.commentFindFirst.mockResolvedValue({
    id: 'comment-1',
    author: 'operator',
    type: null,
    _count: { attachments: 4 },
  });
  mocks.stage.mockResolvedValue({
    files: [{ path: '/tmp/image.png', filename: 'image.png', declaredContentType: 'image/png' }],
  });
  mocks.readFile.mockResolvedValue(Buffer.from('png'));
  mocks.classify.mockReturnValue({ ok: true, contentType: 'image/png', extension: 'png' });
  mocks.scan.mockResolvedValue({ status: 'clean' });
  mocks.put.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.attachmentCount.mockResolvedValue(4);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    $queryRaw: mocks.queryRaw,
    requestCommentAttachment: {
      count: mocks.attachmentCount,
      createMany: mocks.attachmentCreateMany,
    },
  }));
});

function request() {
  return new NextRequest('https://example.test/api/admin/requests/request-1/comments/comment-1/attachments', {
    method: 'POST',
    body: new Uint8Array([1]),
  });
}

describe('request comment attachment upload', () => {
  it('rejects attaching evidence to another actor comment', async () => {
    mocks.commentFindFirst.mockResolvedValue({
      id: 'comment-1',
      author: 'another-operator',
      type: null,
      _count: { attachments: 0 },
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'COMMENT_ATTACHMENT_PROVENANCE_REQUIRED' });
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it('rejects attaching evidence to a system workflow comment', async () => {
    mocks.commentFindFirst.mockResolvedValue({
      id: 'comment-1',
      author: 'operator',
      type: 'approval',
      _count: { attachments: 0 },
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(403);
    expect(mocks.stage).not.toHaveBeenCalled();
  });

  it('locks and rechecks capacity before inserting attachment metadata', async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(201);
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.attachmentCount).toHaveBeenCalledWith({ where: { commentId: 'comment-1' } });
    expect(mocks.attachmentCreateMany).toHaveBeenCalledOnce();
  });

  it('removes staged asset bytes when a concurrent upload fills the comment', async () => {
    mocks.attachmentCount.mockResolvedValue(5);

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'COMMENT_ATTACHMENT_LIMIT_REACHED' });
    expect(mocks.attachmentCreateMany).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
});
