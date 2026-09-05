import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import {
  clearModuleStateCache,
  getResolvedModuleStates,
  isModuleEnabled,
  MODULE_STATE_LOCK_NAMESPACE,
} from '@/lib/modules/core';
import { getModuleDefinition, isKnownModuleId } from '@/lib/modules/registry';
import { actorHasPermission } from '@/lib/rbac/core';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Read access is open to all administrators: the UI needs module states to
  // filter navigation. Toggling requires the dedicated permission below.
  const states = await getResolvedModuleStates();
  const definitions = states.map((state) => ({
    ...state,
    definition: getModuleDefinition(state.moduleId),
  }));

  return NextResponse.json({ modules: definitions });
}

export async function PATCH(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'modules.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseJsonWithLimit<{ moduleId?: unknown; enabled?: unknown }>(
      request,
      MAX_REQUEST_BODY_SIZE.SMALL
    );
    const { moduleId, enabled } = body ?? {};

    if (typeof moduleId !== 'string' || !isKnownModuleId(moduleId)) {
      return NextResponse.json({ error: 'Unknown module id' }, { status: 400 });
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    const definition = getModuleDefinition(moduleId)!;
    for (const dependency of definition.dependsOn) {
      if (!(await isModuleEnabled(dependency))) {
        return NextResponse.json(
          {
            error: `Cannot enable ${moduleId}: required module ${dependency} is disabled.`,
            code: 'MODULE_DEPENDENCY_DISABLED',
          },
          { status: 409 }
        );
      }
    }

    const { previous, state } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ lock_acquired: string }>>`
        SELECT 'locked'::text AS lock_acquired
        FROM pg_advisory_xact_lock(hashtextextended(${moduleId}, ${MODULE_STATE_LOCK_NAMESPACE}))
      `;
      const previousState = await tx.moduleState.findUnique({ where: { moduleId } });
      const nextState = await tx.moduleState.upsert({
        where: { moduleId },
        update: { enabled, updatedBy: admin.username },
        create: { moduleId, enabled, updatedBy: admin.username },
      });
      return { previous: previousState, state: nextState };
    });

    clearModuleStateCache();

    await logAuditAction({
      action: AuditActions.UPDATE_SETTINGS,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: moduleId,
      targetType: 'ModuleState',
      eventKind: 'write',
      outcome: 'success',
      details: {
        moduleId,
        previousEnabled: previous?.enabled ?? true,
        enabled,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ module: state });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error updating module state:', error);
    return NextResponse.json(
      { error: 'Failed to update module state' },
      { status: 500 }
    );
  }
}
