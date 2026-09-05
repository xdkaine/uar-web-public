import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import {
  AUTOMATION_TRIGGER_KEYS,
  isAutomationTriggerKey,
  validateRuleDefinition,
} from '@/lib/automation/catalog';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories } from '@/lib/audit-log';

const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;

interface CreateRuleBody {
  name?: unknown;
  description?: unknown;
  triggerKey?: unknown;
  conditions?: unknown;
  actions?: unknown;
  enabled?: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'automation.manage')) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    const rules = await prisma.automationRule.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { runs: true } } },
    });

    return NextResponse.json({
      rules: rules.map(({ _count, ...rule }) => ({ ...rule, runCount: _count.runs })),
      triggerCatalog: AUTOMATION_TRIGGER_KEYS,
    });
  } catch (error) {
    console.error('Error listing automation rules:', error);
    return NextResponse.json({ error: 'Failed to list automation rules' }, { status: 500 });
  }
}

function rejectInvalidName(body: CreateRuleBody): string | null {
  if (typeof body.name !== 'string') return null;
  const trimmed = body.name.trim();
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) return null;
  return trimmed;
}

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'automation.manage')) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    let body: CreateRuleBody;
    try {
      body = (await request.json()) as CreateRuleBody;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const name = rejectInvalidName(body);
    if (!name) {
      return NextResponse.json(
        { error: `name is required and must be 1-${NAME_MAX} characters` },
        { status: 400 }
      );
    }

    if (
      typeof body.description !== 'undefined' &&
      body.description !== null &&
      (typeof body.description !== 'string' || body.description.trim().length > DESCRIPTION_MAX)
    ) {
      return NextResponse.json(
        { error: `description must be at most ${DESCRIPTION_MAX} characters` },
        { status: 400 }
      );
    }

    if (!isAutomationTriggerKey(body.triggerKey)) {
      return NextResponse.json(
        { error: `triggerKey must be one of: ${AUTOMATION_TRIGGER_KEYS.join(', ')}` },
        { status: 400 }
      );
    }

    const validation = validateRuleDefinition({
      conditions: body.conditions ?? [],
      actions: body.actions,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const enabled = body.enabled === true;

    const created = await prisma.automationRule.create({
      data: {
        name,
        description:
          typeof body.description === 'string' && body.description.trim()
            ? body.description.trim()
            : null,
        triggerKey: body.triggerKey,
        triggerConfig: {},
        conditions: validation.definition.conditions as unknown as Prisma.InputJsonValue,
        actions: validation.definition.actions as unknown as Prisma.InputJsonValue,
        enabled,
        createdBy: admin.username,
        updatedBy: admin.username,
      },
    });

    await logAuditAction({
      action: 'create_automation_rule',
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: created.id,
      targetType: 'AutomationRule',
      details: {
        name,
        triggerKey: created.triggerKey,
        enabled,
        conditionCount: validation.definition.conditions.length,
        actionKeys: validation.definition.actions.map((action) => action.key),
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ rule: created }, { status: 201 });
  } catch (error) {
    console.error('Error creating automation rule:', error);
    return NextResponse.json({ error: 'Failed to create automation rule' }, { status: 500 });
  }
}
