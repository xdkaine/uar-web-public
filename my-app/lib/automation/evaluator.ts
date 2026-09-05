import { prisma } from '@/lib/prisma';
import { createHash } from 'node:crypto';
import { appLogger } from '@/lib/logger';
import { createLifecycleGroupAction } from '@/lib/lifecycle-group-action';
import {
  renderTemplate,
  validateRuleDefinition,
  type ActionSpec,
  type AutomationContext,
  type ConditionConfig,
} from './catalog';

export interface RuleRowLike {
  id: string;
  name: string;
  triggerKey: string;
  conditions: unknown;
  actions: unknown;
}

export interface ActionOutcome {
  key: string;
  ok: boolean;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface RuleExecutionResult {
  matched: boolean;
  outcomes: ActionOutcome[];
  error?: string;
}

export function evaluateConditions(
  conditions: ConditionConfig[],
  context: AutomationContext
): boolean {
  for (const condition of conditions) {
    const value = resolveField(context, condition.field);
    if (condition.key === 'context_field_exists') {
      if (value === undefined || value === null || value === '') return false;
      continue;
    }
    if (String(value ?? '') !== condition.value) {
      return false;
    }
  }
  return true;
}

function resolveField(context: AutomationContext, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

async function executeAction(
  action: ActionSpec,
  context: AutomationContext,
  ruleName: string
): Promise<ActionOutcome> {
  try {
    switch (action.key) {
      case 'create_service_alert': {
        const config = action.config as {
          dedupeKey: string;
          category: string;
          severity: string;
          title: string;
          message: string;
        };
        const now = new Date();
        const existing = await prisma.serviceAlert.findUnique({
          where: { dedupeKey: config.dedupeKey },
          select: { id: true },
        });
        if (!existing) {
          await prisma.serviceAlert.create({
            data: {
              dedupeKey: config.dedupeKey,
              category: config.category,
              severity: config.severity,
              title: renderTemplate(config.title, context),
              message: renderTemplate(config.message, context),
              source: `automation:${ruleName}`,
              status: 'active',
              firstSeenAt: now,
              lastSeenAt: now,
            },
          });
          return { key: action.key, ok: true, detail: { created: true } };
        }
        await prisma.serviceAlert.update({
          where: { dedupeKey: config.dedupeKey },
          data: {
            status: 'active',
            severity: config.severity,
            title: renderTemplate(config.title, context),
            message: renderTemplate(config.message, context),
            lastSeenAt: now,
            resolvedAt: null,
            dismissedBy: null,
            dismissedAt: null,
            occurrenceCount: { increment: 1 },
          },
        });
        return { key: action.key, ok: true, detail: { created: false, reoccurred: true } };
      }

      case 'resolve_service_alerts': {
        const config = action.config as { source: string };
        const result = await prisma.serviceAlert.updateMany({
          where: { source: config.source, status: 'active' },
          data: { status: 'resolved', resolvedAt: new Date() },
        });
        return { key: action.key, ok: true, detail: { resolved: result.count } };
      }

      case 'send_email': {
        const config = action.config as { to: string[]; subject: string; body: string };
        const { sendAutomationEmail } = await import('./email-sender');
        const info = await sendAutomationEmail({
          to: config.to,
          subject: renderTemplate(config.subject, context),
          body: renderTemplate(config.body, context),
        });
        return { key: action.key, ok: true, detail: { messageId: info.messageId } };
      }

      case 'enqueue_group_add': {
        const joinGroupDn = context.joinGroupDn;
        const username = context.creatorUsername;
        const ticketId = context.ticketId;
        if (typeof joinGroupDn !== 'string' || !joinGroupDn) {
          throw new Error('context.joinGroupDn is required for enqueue_group_add');
        }
        if (typeof username !== 'string' || !username) {
          throw new Error('context.creatorUsername is required for enqueue_group_add');
        }
        const group = await prisma.allowedTicketSubjectGroup.findUnique({
          where: { dn: joinGroupDn },
          select: {
            dn: true,
            name: true,
            canJoinViaTicket: true,
            autoApproveJoin: true,
            isActive: true,
          },
        });
        if (!group || !group.isActive || !group.canJoinViaTicket) {
          throw new Error('Target group is not approved to be joined via ticket');
        }
        if (!group.autoApproveJoin) {
          throw new Error(
            `"${group.name}" is not configured for automatic adds; enable auto-approve in Support & Routing first`
          );
        }
        const duplicate = await prisma.accountLifecycleAction.findFirst({
          where: {
            actionType: 'add_group_member',
            targetUsername: username,
            relatedTicketId: typeof ticketId === 'string' ? ticketId : null,
            status: { in: ['queued', 'processing'] },
          },
          select: { id: true },
        });
        if (duplicate) {
          return {
            key: action.key,
            ok: true,
            detail: { alreadyQueued: true, actionId: duplicate.id },
          };
        }
        const idempotencyKey = `automation-group:${createHash('sha256').update(JSON.stringify({
          ruleName,
          actionKey: action.key,
          ticketId: typeof ticketId === 'string' ? ticketId : null,
          username,
          groupDn: group.dn.toLowerCase(),
        })).digest('hex')}`;
        const { action: created } = await createLifecycleGroupAction({
          actionType: 'add_group_member',
          username,
          groupDn: group.dn,
          groupName: group.name,
          reason: `Automation rule "${ruleName}" approved ticket membership request for ${group.name}`,
          requestedBy: `automation:${ruleName}`,
          relatedTicketId: typeof ticketId === 'string' ? ticketId : null,
          idempotencyKey,
          canRestore: false,
        });
        return { key: action.key, ok: true, detail: { actionId: created.id } };
      }

      case 'add_ticket_response': {
        const config = action.config as { message: string };
        const ticketId = context.ticketId;
        if (typeof ticketId !== 'string' || !ticketId) {
          throw new Error('context.ticketId is required for add_ticket_response');
        }
        const created = await prisma.ticketResponse.create({
          data: {
            ticketId,
            message: renderTemplate(config.message, context),
            author: 'automation',
            isStaff: true,
          },
        });
        return { key: action.key, ok: true, detail: { responseId: created.id } };
      }

      case 'close_ticket': {
        const ticketId = context.ticketId;
        if (typeof ticketId !== 'string' || !ticketId) {
          throw new Error('context.ticketId is required for close_ticket');
        }
        const ticket = await prisma.supportTicket.findUnique({
          where: { id: ticketId },
          select: { id: true, status: true },
        });
        if (!ticket) {
          throw new Error(`Ticket ${ticketId} not found`);
        }
        if (ticket.status === 'closed') {
          return { key: action.key, ok: true, detail: { alreadyClosed: true } };
        }
        const now = new Date();
        await prisma.$transaction([
          prisma.supportTicket.update({
            where: { id: ticket.id },
            data: {
              status: 'closed',
              closedAt: now,
              closedBy: 'automation',
              updatedAt: now,
            },
          }),
          prisma.ticketStatusLog.create({
            data: {
              ticketId: ticket.id,
              oldStatus: ticket.status,
              newStatus: 'closed',
              changedBy: 'automation',
              isStaff: true,
            },
          }),
        ]);
        return { key: action.key, ok: true, detail: { closed: true } };
      }

      default:
        throw new Error(`No handler registered for action "${action satisfies never}"`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { key: action.key, ok: false, error: message };
  }
}

export async function runAutomationRule(
  rule: RuleRowLike,
  context: AutomationContext
): Promise<RuleExecutionResult> {
  const validation = validateRuleDefinition(rule);
  if (!validation.ok) {
    appLogger.warn('Automation rule has invalid definition; skipping', {
      ruleId: rule.id,
      error: validation.error,
    });
    return { matched: false, outcomes: [], error: `invalid_rule_definition: ${validation.error}` };
  }

  if (!evaluateConditions(validation.definition.conditions, context)) {
    return { matched: false, outcomes: [] };
  }

  const outcomes: ActionOutcome[] = [];
  for (const action of validation.definition.actions) {
    const outcome = await executeAction(action, context, rule.name);
    outcomes.push(outcome);
    if (!outcome.ok) {
      return { matched: true, outcomes, error: `action_failed: ${outcome.key}: ${outcome.error}` };
    }
  }
  return { matched: true, outcomes };
}
