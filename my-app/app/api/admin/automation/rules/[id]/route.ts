import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import {
  isAutomationTriggerKey,
  validateRuleDefinition,
} from '@/lib/automation/catalog';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories } from '@/lib/audit-log';

const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;

interface UpdateRuleBody {
  name?: unknown;
  description?: unknown;
  triggerKey?: unknown;
  conditions?: unknown;
  actions?: unknown;
  enabled?: unknown;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'automation.manage')) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    const resolvedParams = await params;
    const existing = await prisma.automationRule.findUnique({
      where: { id: resolvedParams.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Automation rule not found' }, { status: 404 });
    }

    let body: UpdateRuleBody;
    try {
      body = (await request.json()) as UpdateRuleBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (
      'enabled' in body &&
      typeof body.enabled !== 'boolean'
    ) {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    const data: {
      name?: string;
      description?: string | null;
      triggerKey?: string;
      conditions?: Prisma.InputJsonValue;
      actions?: Prisma.InputJsonValue;
      enabled?: boolean;
      updatedBy: string;
    } = { updatedBy: admin.username };

    if ('name' in body) {
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > NAME_MAX) {
        return NextResponse.json(
          { error: `name must be 1-${NAME_MAX} characters` },
          { status: 400 }
        );
      }
      data.name = body.name.trim();
    }

    if ('description' in body) {
      if (body.description === null) {
        data.description = null;
      } else if (
        typeof body.description === 'string' &&
        body.description.trim().length <= DESCRIPTION_MAX
      ) {
        data.description = body.description.trim();
      } else {
        return NextResponse.json(
          { error: `description must be at most ${DESCRIPTION_MAX} characters` },
          { status: 400 }
        );
      }
    }

    let triggerKey = existing.triggerKey;
    let conditions = existing.conditions;
    let actions = existing.actions;

    if ('triggerKey' in body || 'conditions' in body || 'actions' in body) {
      if ('triggerKey' in body) {
        if (!isAutomationTriggerKey(body.triggerKey)) {
          return NextResponse.json(
            { error: 'triggerKey is not a known automation trigger' },
            { status: 400 }
          );
        }
        triggerKey = body.triggerKey;
      }
      if ('conditions' in body) {
        conditions = (body.conditions ?? []) as typeof conditions;
      }
      if ('actions' in body) actions = body.actions as typeof actions;

      const validation = validateRuleDefinition({ conditions, actions });
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
      data.triggerKey = triggerKey;
      // Definition shapes are validated above; persist as JSON inputs.
      data.conditions = validation.definition.conditions as unknown as Prisma.InputJsonValue;
      data.actions = validation.definition.actions as unknown as Prisma.InputJsonValue;
    }

    if ('enabled' in body && typeof body.enabled === 'boolean') {
      data.enabled = body.enabled;
    }

    const updated = await prisma.automationRule.update({
      where: { id: existing.id },
      data,
    });

    await logAuditAction({
      action: 'update_automation_rule',
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: existing.id,
      targetType: 'AutomationRule',
      details: {
        changedFields: Object.keys(body),
        enabled: updated.enabled,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ rule: updated });
  } catch (error) {
    console.error('Error updating automation rule:', error);
    return NextResponse.json({ error: 'Failed to update automation rule' }, { status: 500 });
  }
}
