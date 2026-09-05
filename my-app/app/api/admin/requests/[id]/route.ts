import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { resolveLDAPUserDisplayNames } from '@/lib/ldap';
import { resolveRequestReview } from '@/lib/workflow/request-review';
import { validateWorkflowStages, WORKFLOW_STAGE_CATALOG } from '@/lib/workflow/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkReviewAccessWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'access_requests.read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const resolvedParams = await params;
    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
      omit: { verificationToken: true, verificationTokenHash: true },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            description: true,
            endDate: true,
          },
        },
      },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Security: Don't return decrypted passwords in API responses
    // Use the dedicated /api/admin/requests/[id]/reveal-password endpoint instead
    const hasPassword = !!accessRequest.accountPassword;
    const passwordStatus = hasPassword 
      ? (accessRequest.isInternal ? 'encrypted_internal' : 'available')
      : null;

    // Exclude accountPassword from response, provide status indicator instead
    const { accountPassword: _excluded, ...safeRequest } = accessRequest;
    const responseData = {
      ...safeRequest,
      hasPassword,
      passwordStatus,
    };

    const actorUsernames = Array.from(new Set([
      accessRequest.acknowledgedBy,
      accessRequest.approvedBy,
      accessRequest.sentToFacultyBy,
      accessRequest.rejectedBy,
      accessRequest.manuallyAssignedBy,
    ].filter((value): value is string => Boolean(value))));
    let actorDisplayNames: Record<string, string> = {};
    try {
      const resolvedNames = await resolveLDAPUserDisplayNames(actorUsernames);
      actorDisplayNames = Object.fromEntries(actorUsernames.map((username) => [
        username,
        resolvedNames.get(username.toLowerCase()) || username,
      ]));
    } catch {
      actorDisplayNames = Object.fromEntries(actorUsernames.map((username) => [username, username]));
    }

    const capabilities = {
      canRespond: actorHasPermission(admin, 'access_requests.respond'),
      canProvision: actorHasPermission(admin, 'access_requests.provision'),
      canReviewDirector: actorHasPermission(admin, 'access_requests.review.director'),
      canReviewFaculty: actorHasPermission(admin, 'access_requests.review.faculty'),
      canRejectPreVerification: actorHasPermission(admin, 'access_requests.read'),
      canConfigureGovernance: actorHasPermission(admin, 'governance.configure'),
    };
    const [facultyHandoffTemplate, vpnModuleEnabled, review] = await Promise.all([
      capabilities.canReviewFaculty
        ? import('@/lib/messages/core').then(({ getMessageTemplate }) => getMessageTemplate('faculty.handoff_message')).then((template) => template.body)
        : Promise.resolve(null),
      capabilities.canProvision
        ? import('@/lib/modules/core').then(({ isModuleEnabled }) => isModuleEnabled('vpn.management'))
        : Promise.resolve(false),
      resolveRequestReview(accessRequest, admin),
    ]);
    const workflowRecoveryOptions = review.workflow.warning && capabilities.canConfigureGovernance
      ? (await prisma.workflowDefinition.findMany({
          where: {
            requestTypeKey: accessRequest.requestTypeKey || 'standard_access',
            status: { in: ['published', 'archived'] },
          },
          orderBy: { version: 'desc' },
          select: { id: true, version: true, status: true, stages: true },
        })).flatMap((definition) => {
          const parsed = validateWorkflowStages(definition.stages);
          if (!parsed.ok || !parsed.stages.some((stage) => WORKFLOW_STAGE_CATALOG[stage.key].status === accessRequest.status)) return [];
          return [{
            id: definition.id,
            version: definition.version,
            status: definition.status,
            stageLabels: parsed.stages.map((stage) => stage.label),
          }];
        })
      : [];

    // Log viewing the request
    await logAuditAction({
      action: AuditActions.VIEW_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      details: {
        requestName: accessRequest.name,
        requestEmail: accessRequest.email,
        status: accessRequest.status,
        isInternal: accessRequest.isInternal,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ request: responseData, actorDisplayNames, capabilities, review, workflowRecoveryOptions, facultyHandoffTemplate, vpnModuleEnabled });
  } catch (error) {
    console.error('Error fetching request:', error);
    return NextResponse.json(
      { error: 'Failed to fetch request' },
      { status: 500 }
    );
  }
}
