import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuditAccessWithRateLimit } from '@/lib/adminAuth';
import { sanitizeAuditDetails } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

/**
 * Per-request governance dossier (roadmap §8 evidence contract): one
 * read-only correlation view of everything that happened to an access
 * request - the workflow version pinned at submission, each review decision
 * with its actor, provisioning outcomes, and the durable audit trail.
 *
 * Credential material is excluded at the query level: accountPassword and
 * verificationToken are never selected, so they cannot leak through this
 * surface regardless of downstream handling.
 */

const REQUEST_SELECT = {
  id: true,
  createdAt: true,
  updatedAt: true,
  name: true,
  email: true,
  isInternal: true,
  needsDomainAccount: true,
  institution: true,
  eventReason: true,
  accessEndTime: true,
  isVerified: true,
  verifiedAt: true,
  status: true,
  acknowledgedByDirector: true,
  acknowledgedAt: true,
  acknowledgedBy: true,
  approvedAt: true,
  approvedBy: true,
  approvalMessage: true,
  ldapUsername: true,
  vpnUsername: true,
  accountExpiresAt: true,
  sentToFacultyAt: true,
  sentToFacultyBy: true,
  rejectedAt: true,
  rejectedBy: true,
  rejectionReason: true,
  isGrandfatheredAccount: true,
  isManuallyAssigned: true,
  manuallyAssignedAt: true,
  manuallyAssignedBy: true,
  linkedAdUsername: true,
  linkedVpnUsername: true,
  manualAssignmentNotes: true,
  adAccountStatus: true,
  adDisabledAt: true,
  adDisabledBy: true,
  adDisabledReason: true,
  adEnabledAt: true,
  adEnabledBy: true,
  vpnAccountStatus: true,
  vpnRevokedAt: true,
  vpnRevokedBy: true,
  vpnRevokedReason: true,
  vpnRestoredAt: true,
  vpnRestoredBy: true,
  provisioningState: true,
  provisioningStartedAt: true,
  provisioningCompletedAt: true,
  provisioningError: true,
  accountCreatedAt: true,
  requestTypeKey: true,
  workflowVersionId: true,
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkAuditAccessWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const accessRequest = await prisma.accessRequest.findUnique({
    where: { id },
    select: REQUEST_SELECT,
  });

  if (!accessRequest) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  const [workflowVersion, comments, auditEntries] = await Promise.all([
    accessRequest.workflowVersionId
      ? prisma.workflowDefinition.findUnique({
          where: { id: accessRequest.workflowVersionId },
          select: {
            id: true,
            requestTypeKey: true,
            version: true,
            status: true,
            stages: true,
            createdAt: true,
          },
        })
      : Promise.resolve(null),
    prisma.requestComment.findMany({
      where: { requestId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, author: true, type: true, comment: true },
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [{ relatedRequestId: id }, { targetType: 'AccessRequest', targetId: id }],
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: {
        id: true,
        action: true,
        category: true,
        eventKind: true,
        outcome: true,
        success: true,
        username: true,
        actorType: true,
        details: true,
        errorMessage: true,
        correlationId: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    dossier: {
      generatedAt: new Date().toISOString(),
      request: accessRequest,
      governance: workflowVersion
        ? {
            requestTypeKey: workflowVersion.requestTypeKey,
            version: workflowVersion.version,
            versionStatus: workflowVersion.status,
            publishedAt: workflowVersion.createdAt,
            stages: workflowVersion.stages,
          }
        : null,
      comments,
      auditTrail: auditEntries.map((entry) => ({
        ...entry,
        details: parseEntryDetails(entry.details),
      })),
    },
  });
}

function parseEntryDetails(details: string | null): Record<string, unknown> | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details);
    return sanitizeAuditDetails(parsed) as Record<string, unknown>;
  } catch {
    return { raw: sanitizeAuditDetails(details ?? '') };
  }
}
