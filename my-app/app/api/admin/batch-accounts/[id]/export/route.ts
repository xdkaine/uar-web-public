import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { getConfigValue } from '@/lib/config/resolver';
import { decryptPassword } from '@/lib/encryption';
import { logAuditAction, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, validateCsrfTokenPair } from '@/lib/csrf-cookie-policy';
import { buildBatchAccountExport } from '@/lib/batch-account-export';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff' };
const failure = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      if (response) {
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        return response;
      }
      return failure('Unauthorized', 401);
    }
    if (!actorHasPermission(admin, 'batch.manage')) return failure('Forbidden', 403);
    if (!validateCsrfTokenPair(request.headers.get(CSRF_HEADER_NAME), request.cookies.get(CSRF_COOKIE_NAME)?.value)) return failure('Invalid CSRF token', 403);
    const { id } = await params;
    const batch = await prisma.batchAccountCreation.findUnique({
      where: { id },
      select: {
        id: true, description: true, createdBy: true, status: true, completedAt: true,
        accounts: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, batchId: true, lifecycleOwnerKind: true, accessRequestId: true, accountType: true,
            name: true, email: true, ldapUsername: true, vpnUsername: true, password: true,
            accountExpiresAt: true, isInternal: true, status: true, mutationStage: true, completedAt: true,
            ldapCreatedAt: true, vpnCreatedAt: true, targetDirectoryDn: true, targetDirectoryObjectGuid: true,
            adAccountStatus: true,
            vpnAccount: { select: { portalType: true, status: true, username: true, batchId: true, accessRequestId: true } },
          },
        },
      },
    });
    if (!batch) return failure('Batch not found', 404);
    if (batch.createdBy.trim().toLowerCase() !== admin.username.trim().toLowerCase()) return failure('Only the batch creator can export initial passwords', 403);
    if (!['completed', 'failed'].includes(batch.status)) return failure('Wait until batch processing and reconciliation have finished', 409);
    const retentionDays = await getConfigValue<number>('password.cleanup.retentionDays');
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) return failure('Credential retention policy is unavailable', 503);
    const result = await buildBatchAccountExport(batch, retentionDays, decryptPassword);
    // Persist disclosure evidence before returning any plaintext. No workbook values enter audit/logs.
    await logAuditAction({
      action: 'export_batch_initial_passwords', category: AuditCategories.BATCH, eventKind: 'security',
      username: admin.username, targetId: batch.id, targetType: 'BatchAccountCreation',
      details: { accounts: result.disclosures, totalAccounts: batch.accounts.length },
      ipAddress: getIpAddress(request), userAgent: getUserAgent(request),
    });
    return new NextResponse(result.bytes, {
      headers: {
        ...headers,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="batch-accounts-${batch.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx"`,
      },
    });
  } catch {
    // Encryption/library exceptions may contain sensitive input; keep the failure generic.
    return failure('Could not export batch accounts. No file was released.', 500);
  }
}
