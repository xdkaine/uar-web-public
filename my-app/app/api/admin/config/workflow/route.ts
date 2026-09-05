import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { actorHasPermission } from '@/lib/rbac/core';
import { KNOWN_REVIEWER_ROLE_KEYS } from '@/lib/rbac/permissions';
import { clearWorkflowCache, getActiveWorkflow } from '@/lib/workflow/core';
import {
  DEFAULT_STANDARD_WORKFLOW_STAGES,
  WORKFLOW_STAGE_CATALOG,
  validateWorkflowStages,
} from '@/lib/workflow/schema';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'governance.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [active, history] = await Promise.all([
    getActiveWorkflow(),
    prisma.workflowDefinition.findMany({
      where: { requestTypeKey: 'standard_access' },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        status: true,
        stages: true,
        createdBy: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    workflow: active,
    history,
    catalog: {
      stages: Object.entries(WORKFLOW_STAGE_CATALOG).map(([key, entry]) => ({
        key,
        status: entry.status,
        defaultLabel: entry.defaultLabel,
      })),
      reviewerRoles: KNOWN_REVIEWER_ROLE_KEYS,
      defaults: DEFAULT_STANDARD_WORKFLOW_STAGES,
    },
  });
}

export async function PUT(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'governance.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseJsonWithLimit<{ stages?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const validation = validateWorkflowStages(body.stages);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Ensure the standard request type exists (pre-seeded by migration).
    const requestType = await prisma.requestType.findUnique({
      where: { key: 'standard_access' },
    });
    if (!requestType) {
      return NextResponse.json(
        { error: 'Standard access request type is not initialized. Run pending migrations first.' },
        { status: 409 }
      );
    }

    const latest = await prisma.workflowDefinition.findFirst({
      where: { requestTypeKey: 'standard_access' },
      orderBy: { version: 'desc' },
    });

    // Publishing is append-only: existing versions are immutable so requests
    // pinned to them keep their original governance.
    const definition = await prisma.workflowDefinition.create({
      data: {
        requestTypeKey: 'standard_access',
        version: (latest?.version ?? 0) + 1,
        status: 'published',
        stages: validation.stages as unknown as Prisma.InputJsonValue,
        createdBy: admin.username,
      },
    });

    clearWorkflowCache();

    await logAuditAction({
      action: AuditActions.UPDATE_SETTINGS,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: definition.id,
      targetType: 'WorkflowDefinition',
      eventKind: 'write',
      outcome: 'success',
      details: {
        requestTypeKey: 'standard_access',
        publishedVersion: definition.version,
        previousVersion: latest?.version ?? null,
        stages: validation.stages,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ workflow: definition });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    // Concurrent publishes race on @@unique([requestTypeKey, version]);
    // surface that as a retryable conflict instead of a 500.
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'A new workflow version was just published. Reload and try again.' },
        { status: 409 }
      );
    }
    console.error('Error publishing workflow:', error);
    return NextResponse.json({ error: 'Failed to publish workflow' }, { status: 500 });
  }
}
