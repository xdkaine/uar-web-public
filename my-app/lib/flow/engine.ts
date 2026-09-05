import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { appLogger } from '@/lib/logger';
import { validateTicketRichText } from '@/lib/ticket-content';
import { validateGraph, type FlowEdge, type FlowNode } from './graph';
import { FLOW_NODE_CATALOG, type ConditionComparison } from './catalog';
import { createLifecycleGroupAction, createLifecycleGroupActions } from '@/lib/lifecycle-group-action';
import { validateWorkflowEmailRecipients } from './publication-guard';

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Visual workflow execution engine (ADR-0013). Walks a validated graph from
 * its trigger along condition-routed edges, executing curated action nodes.
 * Idempotency: unique (graphId, eventKey). Delays persist as FlowTimer rows;
 * the tick worker resumes waiting runs late, never twice.
 */

export type FlowNodeStatus = 'succeeded' | 'skipped' | 'failed' | 'waiting';

export interface FlowNodeOutcome {
  nodeId: string;
  type: string;
  status: FlowNodeStatus;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface FlowContext extends Record<string, unknown> {
  ticketId?: string;
  ticketSubject?: string;
  creatorUsername?: string;
  username?: string;
  category?: string;
  severity?: string;
  status?: string;
  newStatus?: string;
  oldStatus?: string;
  target?: string;
  error?: string;
  joinGroupDn?: string;
  requestedForGroupDn?: string;
  /** True when the creator filed the ticket for themselves (no group). */
  requestedForSelf?: boolean;
  /** True when the join-request group is configured for automatic adds. */
  joinAutoApprove?: boolean;
  /** True when a ticket reply was authored by staff. */
  isStaff?: boolean;
  /** Lifecycle action event fields (trigger_lifecycle_action_*). */
  actionType?: string;
  /** Lifecycle ids are Prisma cuid strings. */
  actionId?: string;
  batchId?: string | null;
  /** Attachment security event fields (trigger_attachment_malware_detected). */
  attachmentId?: string;
  filename?: string;
  uploadedBy?: string;
  /** Approved monitored-endpoint event fields. */
  targetId?: string;
  checkKey?: string;
  host?: string;
  protocol?: string;
  latencyMs?: number;
  statusCode?: number;
}

interface RunState {
  runId: string;
  graphId: string;
  graphName: string;
  nodes: Map<string, FlowNode>;
  outgoing: Map<string, FlowEdge[]>;
  outcomes: FlowNodeOutcome[];
  artifactsCreated: number;
  context: FlowContext;
}

/** Substitute {{tokens}} from the event context; unknown tokens stay visible. */
export function renderTokens(value: string, context: FlowContext): string {
  return value.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const resolved = (context as Record<string, unknown>)[name];
    return resolved === undefined || resolved === null ? match : String(resolved);
  });
}

function digest(context: FlowContext): string {
  try {
    return createHash('sha256').update(JSON.stringify(context)).digest('hex').slice(0, 32);
  } catch {
    return 'unserializable';
  }
}

async function recordArtifact(runId: string, nodeId: string, kind: string, refId: string): Promise<void> {
  await prisma.flowArtifact.create({ data: { runId, nodeId, kind, refId } });
}

/**
 * Mirror the manual ticket routes' notification contract: replies notify the
 * creator like a staff response and status changes announce the transition.
 * Fire-and-forget — a relay outage must never fail the workflow run.
 */
function notifyTicketCreator(params: {
  ticketId: string;
  kind: 'reply' | 'status';
  responseMessage?: string;
  oldStatus?: string;
  newStatus?: string;
}): void {
  void (async () => {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: params.ticketId },
      select: { subject: true, username: true, relatedRequestId: true },
    });
    if (!ticket) return;

    let userEmail: string | null = null;
    let userName: string | null = null;
    if (ticket.relatedRequestId) {
      const accessRequest = await prisma.accessRequest.findUnique({
        where: { id: ticket.relatedRequestId },
        select: { email: true, name: true },
      });
      userEmail = accessRequest?.email || null;
      userName = accessRequest?.name || null;
    } else {
      const accessRequest = await prisma.accessRequest.findFirst({
        where: {
          OR: [
            { ldapUsername: ticket.username },
            { vpnUsername: ticket.username },
            { linkedAdUsername: ticket.username },
            { linkedVpnUsername: ticket.username },
          ],
        },
        select: { email: true, name: true },
        orderBy: { createdAt: 'desc' },
      });
      userEmail = accessRequest?.email || null;
      userName = accessRequest?.name || null;
    }
    if (!userEmail) return;

    const { sendTicketResponseToUser, sendTicketStatusChangeToUser } = await import('@/lib/email');
    if (params.kind === 'reply') {
      await sendTicketResponseToUser({
        ticketId: params.ticketId,
        subject: ticket.subject,
        userEmail,
        userName: userName || undefined,
        responseMessage: params.responseMessage ?? '',
        staffUsername: 'automation',
      });
    } else {
      await sendTicketStatusChangeToUser({
        ticketId: params.ticketId,
        subject: ticket.subject,
        userEmail,
        userName: userName || undefined,
        oldStatus: params.oldStatus ?? '',
        newStatus: params.newStatus ?? '',
        changedBy: 'automation',
      });
    }
  })().catch((error) => {
    appLogger.error('Workflow ticket notification failed', { error, ...params });
  });
}

async function executeAction(
  state: RunState,
  node: FlowNode
): Promise<{ status: FlowNodeStatus; detail?: Record<string, unknown>; error?: string }> {
  const config = node.config as Record<string, never> & Record<string, unknown>;
  const context = state.context;
  const render = (value: unknown): string => renderTokens(String(value ?? ''), context);

  switch (node.type) {
    case 'action_send_email': {
      const renderedRecipients = render(config.to);
      const recipientErrors = validateWorkflowEmailRecipients(renderedRecipients);
      if (recipientErrors.length > 0) {
        return { status: 'failed', error: recipientErrors.join('; ') };
      }
      const recipients = renderedRecipients
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(entry));
      if (recipients.length === 0) {
        return { status: 'failed', error: 'No valid recipient addresses' };
      }
      const existingAttempt = await prisma.flowActionAttempt.findUnique({
        where: { runId_nodeId: { runId: state.runId, nodeId: node.id } },
      });
      let claimId: string = randomUUID();
      if (existingAttempt?.status === 'delivered') {
        return {
          status: 'succeeded',
          detail: { messageId: existingAttempt.messageId, to: recipients, alreadyDelivered: true },
        };
      }
      if (existingAttempt) {
        if (existingAttempt.status === 'resume_claimed') {
          if (!existingAttempt.claimId) {
            return { status: 'failed', error: 'Email recovery claim is incomplete' };
          }
          claimId = existingAttempt.claimId;
          const started = await prisma.flowActionAttempt.updateMany({
            where: { id: existingAttempt.id, status: 'resume_claimed', claimId },
            data: { status: 'sending' },
          });
          if (started.count !== 1) return { status: 'failed', error: 'Email recovery ownership was lost' };
        } else if (existingAttempt.status === 'retry_authorized') {
          const reclaimed = await prisma.flowActionAttempt.updateMany({
            where: { id: existingAttempt.id, status: 'retry_authorized', claimId: null },
            data: {
              status: 'sending',
              claimId,
              claimedAt: new Date(),
              claimedUntil: new Date(Date.now() + 10 * 60 * 1000),
              attempts: { increment: 1 },
              lastError: null,
            },
          });
          if (reclaimed.count !== 1) {
            return { status: 'failed', error: 'Email retry authorization was claimed concurrently' };
          }
        } else {
        if (
          existingAttempt.status === 'sending'
          && existingAttempt.claimedUntil
          && existingAttempt.claimedUntil <= new Date()
        ) {
          await prisma.flowActionAttempt.updateMany({
            where: { id: existingAttempt.id, status: 'sending', claimId: existingAttempt.claimId },
            data: {
              status: 'delivery_unknown',
              claimId: null,
              claimedUntil: null,
              lastError: 'Email claim expired after provider delivery may have started',
            },
          });
        }
        return {
          status: 'failed',
          error: 'Email delivery is already claimed or requires operator reconciliation',
        };
        }
      } else try {
        await prisma.flowActionAttempt.create({
          data: {
            runId: state.runId,
            nodeId: node.id,
            kind: 'email',
            status: 'sending',
            claimId,
            claimedAt: new Date(),
            claimedUntil: new Date(Date.now() + 10 * 60 * 1000),
            attempts: 1,
            outcome: asJson({
              deliveryInput: {
                to: recipients,
                subject: render(config.subject),
                body: render(config.body),
              },
            }),
          },
        });
      } catch (error) {
        if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
          return { status: 'failed', error: 'Email delivery was claimed concurrently' };
        }
        throw error;
      }
      const { sendAutomationEmail } = await import('@/lib/automation/email-sender');
      try {
        const info = await sendAutomationEmail({
          to: recipients,
          subject: render(config.subject),
          body: render(config.body),
        });
        const finalized = await prisma.flowActionAttempt.updateMany({
          where: { runId: state.runId, nodeId: node.id, status: 'sending', claimId },
          data: {
            status: 'delivered',
            claimId: null,
            claimedUntil: null,
            messageId: info.messageId || null,
            lastError: null,
          },
        });
        if (finalized.count !== 1) {
          return { status: 'failed', error: 'Email was accepted but finalization ownership was lost' };
        }
        return { status: 'succeeded', detail: { messageId: info.messageId, to: recipients } };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown email delivery failure';
        await prisma.flowActionAttempt.updateMany({
          where: { runId: state.runId, nodeId: node.id, status: 'sending', claimId },
          data: {
            status: 'delivery_unknown',
            claimId: null,
            claimedUntil: null,
            lastError: message,
          },
        }).catch(() => undefined);
        return { status: 'failed', error: 'Email delivery outcome is unknown and requires reconciliation' };
      }
    }

    case 'action_create_service_alert': {
      const dedupeKey = render(config.dedupeKey);
      if (!dedupeKey) return { status: 'failed', error: 'dedupeKey is required' };
      const severity = render(config.severity) || 'warning';
      const now = new Date();
      const existing = await prisma.serviceAlert.findUnique({
        where: { dedupeKey },
        select: { id: true },
      });
      let created = false;
      if (!existing) {
        await prisma.serviceAlert.create({
          data: {
            dedupeKey,
            category: 'general',
            severity,
            title: render(config.title),
            message: render(config.message),
            source: `flow:${state.graphName}`,
            status: 'active',
            firstSeenAt: now,
            lastSeenAt: now,
          },
        });
        created = true;
      } else {
        await prisma.serviceAlert.update({
          where: { dedupeKey },
          data: {
            status: 'active',
            severity,
            title: render(config.title),
            message: render(config.message),
            lastSeenAt: now,
            resolvedAt: null,
            dismissedBy: null,
            dismissedAt: null,
            occurrenceCount: { increment: 1 },
          },
        });
      }
      // Track by dedupe key so resolution can find and cascade this alert's siblings.
      await recordArtifact(state.runId, node.id, 'service_alert', dedupeKey);
      state.artifactsCreated += 1;
      return { status: 'succeeded', detail: { created, dedupeKey } };
    }

    case 'action_resolve_service_alerts': {
      const dedupeKey = render(config.dedupeKey);
      const where = {
        status: 'active' as const,
        ...(dedupeKey ? { dedupeKey } : {}),
      };
      const active = await prisma.serviceAlert.findMany({ where, select: { id: true, dedupeKey: true } });
      if (active.length > 0) {
        await prisma.serviceAlert.updateMany({
          where: { id: { in: active.map((alert) => alert.id) } },
          data: { status: 'resolved', resolvedAt: new Date() },
        });
      }
      // Cascade cleanup (ADR-0013): banners raised by THIS RUN alongside the
      // resolved alerts are cleared too. Ticket responses and lifecycle
      // actions are deliberately never auto-undone.
      const keys = new Set(active.map((alert) => alert.dedupeKey));
      const relatedArtifacts = await prisma.flowArtifact.findMany({
        where: { refId: { in: [...keys] }, kind: 'service_alert', clearedAt: null },
        select: { runId: true },
      });
      const runIds = Array.from(new Set(relatedArtifacts.map((artifact) => artifact.runId)));
      let clearedBanners = 0;
      if (runIds.length > 0) {
        const bannerArtifacts = await prisma.flowArtifact.findMany({
          where: { runId: { in: runIds }, kind: 'notification_banner', clearedAt: null },
          select: { id: true, refId: true },
        });
        const bannerIds = bannerArtifacts.map((artifact) => artifact.refId);
        if (bannerIds.length > 0) {
          const updated = await prisma.notificationBanner.updateMany({
            where: { id: { in: bannerIds }, isActive: true },
            data: { isActive: false },
          });
          clearedBanners = updated.count;
        }
        await prisma.flowArtifact.updateMany({
          where: { runId: { in: runIds }, kind: { in: ['notification_banner', 'service_alert'] }, clearedAt: null },
          data: { clearedAt: new Date() },
        });
      }
      return { status: 'succeeded', detail: { resolved: active.length, clearedBanners } };
    }

    case 'action_create_notification_banner': {
      const minutesRaw = Number(config.expiresMinutes);
      const expiresAt =
        Number.isFinite(minutesRaw) && minutesRaw > 0
          ? new Date(Date.now() + minutesRaw * 60_000)
          : null;
      const banner = await prisma.notificationBanner.create({
        data: {
          message: render(config.message),
          type: render(config.type) || 'info',
          priority: 10,
          isActive: true,
          dismissible: true,
          endDate: expiresAt,
          createdBy: `flow:${state.graphName}`,
        },
      });
      await recordArtifact(state.runId, node.id, 'notification_banner', banner.id);
      state.artifactsCreated += 1;
      return { status: 'succeeded', detail: { bannerId: banner.id, expiresAt: expiresAt?.toISOString() ?? null } };
    }

    case 'action_clear_notification_banner': {
      const dedupeKey = render(config.dedupeKey).trim();
      const createdByGraph = config.createdByGraph === true || String(config.createdByGraph) === 'true';
      if (!dedupeKey && !createdByGraph) {
        return { status: 'failed', error: 'Provide a banner reference or enable "clear banners this graph created"' };
      }
      // Reuse the exact linkage create writes: FlowArtifact rows of kind
      // notification_banner whose refId is the banner id. Matching by
      // reference resolves the recorded artifact; matching by graph resolves
      // every banner artifact any run of this graph created.
      const artifactWhere = createdByGraph
        ? { kind: 'notification_banner' as const, clearedAt: null, run: { graphId: state.graphId } }
        : { kind: 'notification_banner' as const, clearedAt: null, refId: dedupeKey };
      const artifacts = await prisma.flowArtifact.findMany({
        where: artifactWhere,
        select: { id: true, refId: true },
      });
      if (artifacts.length === 0) {
        // Idempotent by design: nothing matching simply means nothing to do.
        return { status: 'succeeded', detail: { clearedBanners: 0, matchedArtifacts: 0 } };
      }
      const bannerIds = artifacts.map((artifact) => artifact.refId);
      const updated = await prisma.notificationBanner.updateMany({
        where: { id: { in: bannerIds }, isActive: true },
        data: { isActive: false },
      });
      await prisma.flowArtifact.updateMany({
        where: { id: { in: artifacts.map((artifact) => artifact.id) } },
        data: { clearedAt: new Date() },
      });
      return { status: 'succeeded', detail: { clearedBanners: updated.count, matchedArtifacts: artifacts.length } };
    }

    case 'action_add_ticket_response': {
      const ticketId = context.ticketId;
      if (typeof ticketId !== 'string' || !ticketId) {
        return { status: 'failed', error: 'This workflow needs a ticket trigger to reply' };
      }
      const created = await prisma.ticketResponse.create({
        data: {
          ticketId,
          message: render(config.message),
          author: 'automation',
          isStaff: true,
        },
      });
      await recordArtifact(state.runId, node.id, 'ticket_response', created.id);
      notifyTicketCreator({ ticketId, kind: 'reply', responseMessage: render(config.message) });
      return { status: 'succeeded', detail: { responseId: created.id } };
    }

    case 'action_close_ticket': {
      const ticketId = context.ticketId;
      if (typeof ticketId !== 'string' || !ticketId) {
        return { status: 'failed', error: 'This workflow needs a ticket trigger to close it' };
      }
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        select: { id: true, status: true },
      });
      if (!ticket) return { status: 'failed', error: `Ticket ${ticketId} not found` };
      if (ticket.status === 'closed') {
        return { status: 'succeeded', detail: { alreadyClosed: true } };
      }
      const now = new Date();
      await prisma.$transaction([
        prisma.supportTicket.update({
          where: { id: ticket.id },
          data: { status: 'closed', closedAt: now, closedBy: 'automation', updatedAt: now },
        }),
        prisma.ticketStatusLog.create({
          data: { ticketId: ticket.id, oldStatus: ticket.status, newStatus: 'closed', changedBy: 'automation', isStaff: true },
        }),
      ]);
      notifyTicketCreator({ ticketId: ticket.id, kind: 'status', oldStatus: ticket.status, newStatus: 'closed' });
      return { status: 'succeeded', detail: { closed: true } };
    }

    case 'action_update_ticket': {
      const ticketId = context.ticketId;
      if (typeof ticketId !== 'string' || !ticketId) {
        return { status: 'failed', error: 'This workflow needs a ticket trigger to update it' };
      }
      const nextStatus = render(config.status);
      if (!['open', 'in_progress', 'closed'].includes(nextStatus)) {
        return { status: 'failed', error: `Unsupported status "${nextStatus}"` };
      }
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        select: { id: true, status: true, closedAt: true },
      });
      if (!ticket) return { status: 'failed', error: `Ticket ${ticketId} not found` };
      if (ticket.status === nextStatus) {
        return { status: 'succeeded', detail: { unchanged: true } };
      }
      const now = new Date();
      await prisma.$transaction([
        prisma.supportTicket.update({
          where: { id: ticket.id },
          data: {
            status: nextStatus,
            updatedAt: now,
            ...(nextStatus === 'closed' ? { closedAt: now, closedBy: 'automation' } : {}),
          },
        }),
        prisma.ticketStatusLog.create({
          data: {
            ticketId: ticket.id,
            oldStatus: ticket.status,
            newStatus: nextStatus,
            changedBy: 'automation',
            isStaff: true,
          },
        }),
      ]);
      notifyTicketCreator({ ticketId: ticket.id, kind: 'status', oldStatus: ticket.status, newStatus: nextStatus });
      return { status: 'succeeded', detail: { from: ticket.status, to: nextStatus } };
    }

    case 'action_create_internal_ticket': {
      const subject = render(config.subject).trim();
      if (!subject) return { status: 'failed', error: 'Subject is required' };
      if (subject.length > 200) {
        return { status: 'failed', error: 'Subject must not exceed 200 characters' };
      }
      const body = validateTicketRichText(render(config.body), 'Description');
      if (!body.valid) return { status: 'failed', error: body.error };
      const category = render(config.category);
      const severity = render(config.severity);
      if (!['SECURITY', 'SYSTEM', 'OTHER'].includes(category)) {
        return { status: 'failed', error: `Unsupported category "${category}"` };
      }
      if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
        return { status: 'failed', error: `Unsupported severity "${severity}"` };
      }
      const created = await prisma.$transaction(async (tx) => {
        const ticket = await tx.supportTicket.create({
          data: {
            subject,
            body: body.sanitized,
            category,
            severity,
            status: 'open',
            username: 'automation',
            internalOnly: true,
          },
          select: { id: true },
        });
        await tx.flowArtifact.create({
          data: { runId: state.runId, nodeId: node.id, kind: 'support_ticket', refId: ticket.id },
        });
        return ticket;
      });
      state.artifactsCreated += 1;
      return { status: 'succeeded', detail: { ticketId: created.id } };
    }

    case 'action_enqueue_group_add': {
      const configuredGroups: unknown[] = Array.isArray(config.groupDns)
        ? config.groupDns
        : typeof config.groupDn === 'string'
          ? [config.groupDn]
          : [];
      const renderedGroups = configuredGroups
        .flatMap((value) => typeof value === 'string' ? [value] : [])
        .map((value) => render(value).trim())
        .filter(Boolean)
        .filter((value, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);
      const username = context.creatorUsername ?? context.username;
      const ticketId = context.ticketId;
      if (typeof username !== 'string' || !username) {
        return { status: 'failed', error: 'No user resolved from the event context' };
      }
      if (renderedGroups.length === 0 || renderedGroups.length > 10) {
        return { status: 'failed', error: 'Choose between 1 and 10 directory groups' };
      }
      const groups = await prisma.allowedTicketSubjectGroup.findMany({
        where: { dn: { in: renderedGroups } },
        select: {
          dn: true,
          name: true,
          canJoinViaTicket: true,
          autoApproveJoin: true,
          isActive: true,
        },
      });
      const byDn = new Map(groups.map((group) => [group.dn.toLowerCase(), group]));
      const invalid = renderedGroups.find((dn) => {
        const group = byDn.get(dn.toLowerCase());
        return !group || !group.isActive || !group.canJoinViaTicket;
      });
      if (invalid) return { status: 'failed', error: `"${invalid}" is not an approved active join group` };
      const manual = groups.find((group) => !group.autoApproveJoin);
      if (manual) {
        return {
          status: 'failed',
          error: `"${manual.name}" is not configured for automatic adds; enable auto-approve in Support & Routing first`,
        };
      }
      const createdActions = await createLifecycleGroupActions(renderedGroups.map((requestedDn) => {
        const group = byDn.get(requestedDn.toLowerCase())!;
        return {
          actionType: 'add_group_member',
          username,
          groupDn: group.dn,
          groupName: group.name,
          idempotencyKey: `flow:${state.runId}:${node.id}:add:${group.dn.toLowerCase()}`,
          reason: `Workflow "${state.graphName}" queued membership add for ${group.name}`,
          requestedBy: `flow:${state.graphName}`,
          relatedTicketId: typeof ticketId === 'string' ? ticketId : null,
          canRestore: false,
          flowArtifact: { runId: state.runId, nodeId: node.id },
        } as const;
      }));
      const actionIds = createdActions.map(({ action }) => action.id);
      return { status: 'succeeded', detail: { actionIds, queuedCount: actionIds.length } };
    }

    case 'action_enqueue_group_remove': {
      // Mirrors action_enqueue_group_add gate-for-gate; only the queued
      // action type and wording differ. The lifecycle processor currently
      // has no processing case for this type, so the queue owner must wire
      // 'remove_from_group' before published graphs can complete removals.
      const groupDn = render(config.groupDn);
      const username = context.creatorUsername ?? context.username;
      const ticketId = context.ticketId;
      if (typeof username !== 'string' || !username) {
        return { status: 'failed', error: 'No user resolved from the event context' };
      }
      const group = await prisma.allowedTicketSubjectGroup.findUnique({
        where: { dn: groupDn },
        select: {
          dn: true,
          name: true,
          canJoinViaTicket: true,
          autoApproveJoin: true,
          isActive: true,
        },
      });
      if (!group || !group.isActive || !group.canJoinViaTicket) {
        return { status: 'failed', error: 'Target group is not an approved allowlist entry' };
      }
      if (!group.autoApproveJoin) {
        return {
          status: 'failed',
          error: `"${group.name}" is not configured for automatic adds; enable auto-approve in Support & Routing first`,
        };
      }
      const { action: created, replayed } = await createLifecycleGroupAction({
        actionType: 'remove_from_group',
        username,
        groupDn: group.dn,
        groupName: group.name,
        idempotencyKey: `flow:${state.runId}:${node.id}:remove:${group.dn.toLowerCase()}`,
        reason: `Workflow "${state.graphName}" queued membership removal from ${group.name}`,
        requestedBy: `flow:${state.graphName}`,
        relatedTicketId: typeof ticketId === 'string' ? ticketId : null,
        canRestore: false,
        flowArtifact: { runId: state.runId, nodeId: node.id },
      });
      return { status: 'succeeded', detail: { actionId: created.id, alreadyQueued: replayed } };
    }

    default:
      return { status: 'failed', error: `Unknown action node "${node.type}"` };
  }
}

async function executeActionDurably(
  state: RunState,
  node: FlowNode
): Promise<{ status: FlowNodeStatus; detail?: Record<string, unknown>; error?: string }> {
  if (node.type === 'action_send_email') return executeAction(state, node);

  const current = await prisma.flowActionAttempt.findUnique({
    where: { runId_nodeId: { runId: state.runId, nodeId: node.id } },
  });
  if (current?.status === 'delivered') {
    return { status: 'succeeded', detail: { ...(current.outcome as Record<string, unknown> || {}), alreadyCompleted: true } };
  }
  if (current?.status === 'processing') {
    if (current.claimedUntil && current.claimedUntil <= new Date()) {
      await prisma.flowActionAttempt.updateMany({
        where: { id: current.id, status: 'processing', claimId: current.claimId },
        data: {
          status: 'reconciliation_required',
          claimId: null,
          claimedUntil: null,
          lastError: 'Action claim expired after an external mutation may have started',
        },
      });
    }
    return { status: 'failed', error: 'Workflow action is already claimed or requires reconciliation' };
  }
  if (current && !['retry_authorized', 'resume_claimed'].includes(current.status)) {
    return { status: 'failed', error: current.lastError || `Workflow action is ${current.status}` };
  }

  let claimId: string = randomUUID();
  if (current) {
    if (current.status === 'resume_claimed' && current.claimId) claimId = current.claimId;
    const claimed = await prisma.flowActionAttempt.updateMany({
      where: current.status === 'resume_claimed'
        ? { id: current.id, status: 'resume_claimed', claimId }
        : { id: current.id, status: 'retry_authorized', claimId: null },
      data: {
        status: 'processing',
        claimId,
        claimedAt: new Date(),
        claimedUntil: new Date(Date.now() + 10 * 60 * 1000),
        ...(current.status === 'retry_authorized' ? { attempts: { increment: 1 } } : {}),
        lastError: null,
      },
    });
    if (claimed.count !== 1) return { status: 'failed', error: 'Workflow action retry was claimed concurrently' };
  } else {
    try {
      await prisma.flowActionAttempt.create({
        data: {
          runId: state.runId,
          nodeId: node.id,
          kind: node.type,
          status: 'processing',
          claimId,
          claimedAt: new Date(),
          claimedUntil: new Date(Date.now() + 10 * 60 * 1000),
          attempts: 1,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
        return { status: 'failed', error: 'Workflow action was claimed concurrently' };
      }
      throw error;
    }
  }

  try {
    const result = await executeAction(state, node);
    const finalized = await prisma.flowActionAttempt.updateMany({
      where: { runId: state.runId, nodeId: node.id, status: 'processing', claimId },
      data: {
        status: result.status === 'failed' ? 'failed' : 'delivered',
        claimId: null,
        claimedUntil: null,
        lastError: result.error || null,
        outcome: result.detail ? asJson(result.detail) : undefined,
      },
    });
    if (finalized.count !== 1) {
      return { status: 'failed', error: 'Workflow action finalization ownership was lost' };
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown workflow action failure';
    await prisma.flowActionAttempt.updateMany({
      where: { runId: state.runId, nodeId: node.id, status: 'processing', claimId },
      data: {
        status: 'reconciliation_required',
        claimId: null,
        claimedUntil: null,
        lastError: message,
      },
    }).catch(() => undefined);
    return { status: 'failed', error: 'Workflow action outcome is unknown and requires reconciliation' };
  }
}

/**
 * Case-insensitive comparison per ADR-0013 condition groups: equals is an
 * exact (case-insensitive) match, contains a case-insensitive substring,
 * and "in" case-insensitive membership in the configured value list.
 */
function compareValues(actual: unknown, comparison: ConditionComparison): boolean {
  if (actual === undefined || actual === null) return false;
  const text = String(actual).toLowerCase();
  if (comparison.op === 'in') {
    const list = Array.isArray(comparison.value) ? comparison.value : [String(comparison.value)];
    return list.some((entry) => String(entry).toLowerCase() === text);
  }
  if (comparison.op === 'contains') {
    return typeof comparison.value === 'string' && text.includes(comparison.value.toLowerCase());
  }
  return typeof comparison.value === 'string' && text === comparison.value.toLowerCase();
}

async function evaluateCondition(
  state: RunState,
  node: FlowNode
): Promise<{ passed: boolean; outcome: FlowNodeOutcome }> {
  const rawGroups = node.config.groups;
  if (Array.isArray(rawGroups) && rawGroups.length > 0) {
    // AND across groups; within a group ALL/ANY per its match setting.
    let passed = true;
    const groupDetails = rawGroups.map((rawGroup) => {
      const group = rawGroup as { match?: string; comparisons?: unknown };
      const comparisons = Array.isArray(group.comparisons)
        ? (group.comparisons as ConditionComparison[])
        : [];
      const results = comparisons.map((comparison) => ({
        field: comparison.field,
        op: comparison.op,
        value: comparison.value,
        matched: compareValues((state.context as Record<string, unknown>)[comparison.field], comparison),
      }));
      const groupPassed =
        group.match === 'any'
          ? results.some((result) => result.matched)
          : results.every((result) => result.matched);
      passed = passed && groupPassed;
      return { match: group.match ?? 'all', passed: groupPassed, results };
    });
    return {
      passed,
      outcome: {
        nodeId: node.id,
        type: node.type,
        status: passed ? 'succeeded' : 'skipped',
        detail: { mode: 'groups', groups: groupDetails },
      },
    };
  }

  // Legacy single-field comparison (case-sensitive, unchanged for stored graphs).
  const field = String(node.config.field ?? '');
  const expected = String(node.config.equals ?? '');
  const actual = (state.context as Record<string, unknown>)[field];
  const legacyPassed = actual !== undefined && actual !== null && String(actual) === expected;
  return {
    passed: legacyPassed,
    outcome: {
      nodeId: node.id,
      type: node.type,
      status: legacyPassed ? 'succeeded' : 'skipped',
      detail: { field, expected, actual: actual === undefined ? null : String(actual) },
    },
  };
}

async function walkBranch(
  state: RunState,
  startNodeId: string | undefined,
  startHandle: string | undefined,
  depthGuard: number,
  options: { /** True when resuming from a persisted Wait node: it must NOT re-execute. */ skipStartNode?: boolean } = {}
): Promise<{ waited: boolean; failed: boolean }> {
  if (depthGuard > 200) {
    return { waited: false, failed: false }; // cycle guard; graphs are pre-validated acyclic
  }

  let currentNodeId = startNodeId;
  let currentHandle = startHandle;
  let skipExecution = options.skipStartNode === true;

  while (currentNodeId) {
    const node = state.nodes.get(currentNodeId);
    if (!node) break;

    const definition = FLOW_NODE_CATALOG[node.type];
    if (!definition) {
      state.outcomes.push({ nodeId: node.id, type: node.type, status: 'failed', error: 'Unknown node type' });
      return { waited: false, failed: true };
    }

    if (!skipExecution) {
      if (definition.category === 'trigger' || definition.category === 'source') {
        // Trigger itself performs no work; continue along its single edge.
      } else if (node.type === 'logic_condition') {
        const evaluation = await evaluateCondition(state, node);
        state.outcomes.push(evaluation.outcome);
        if (!evaluation.passed) return { waited: false, failed: false };
        currentHandle = 'true';
      } else if (node.type === 'logic_delay') {
        const minutes = Math.min(1440, Math.max(1, Number(node.config.minutes) || 1));
        const dueAt = new Date(Date.now() + minutes * 60_000);
        const timerId = `flow-timer-${createHash('sha256').update(`${state.runId}:${node.id}`).digest('hex')}`;
        await prisma.flowTimer.createMany({
          data: [{
            id: timerId,
            runId: state.runId,
            nodeId: node.id,
            dueAt,
            payload: asJson(state.context),
          }],
          skipDuplicates: true,
        });
        const durableTimer = await prisma.flowTimer.findUnique({ where: { id: timerId } });
        const durableDueAt = durableTimer?.dueAt ?? dueAt;
        state.outcomes.push({
          nodeId: node.id,
          type: node.type,
          status: 'waiting',
          detail: { dueAt: durableDueAt.toISOString(), minutes },
        });
        return { waited: true, failed: false };
      } else {
        const result = await executeActionDurably(state, node);
        state.outcomes.push({
          nodeId: node.id,
          type: node.type,
          status: result.status,
          detail: result.detail,
          error: result.error,
        });
        if (result.status === 'failed') {
          return { waited: false, failed: true };
        }
        currentHandle = 'out';
      }
    }
    skipExecution = false;

    // Advance along the matching edge(s).
    const edges = (state.outgoing.get(currentNodeId) ?? []).filter(
      (edge) => !edge.sourceHandle || !currentHandle || edge.sourceHandle === currentHandle || edge.sourceHandle === 'out'
    );
    if (edges.length === 0) break;
    if (edges.length === 1) {
      const only = edges[0];
      currentNodeId = only?.target;
      currentHandle = only?.sourceHandle ?? undefined;
      continue;
    }
    // Parallel fan-out: walk each branch sequentially (actions are queued
    // operations; ordering between branches is intentionally unspecified).
    let anyWaited = false;
    let anyFailed = false;
    for (const branch of edges.slice(1)) {
      const result = await walkBranch(state, branch?.target, branch?.sourceHandle ?? undefined, depthGuard + 1);
      anyWaited = anyWaited || result.waited;
      anyFailed = anyFailed || result.failed;
    }
    const first = edges[0];
    const primary = await walkBranch(state, first?.target, first?.sourceHandle ?? undefined, depthGuard + 1);
    return {
      waited: anyWaited || primary.waited,
      failed: anyFailed && !primary.waited ? true : primary.failed,
    };
  }

  return { waited: false, failed: false };
}

export async function emitFlowEvent(
  triggerKey: string,
  eventKey: string,
  context: FlowContext,
  options: { throwOnInfrastructureFailure?: boolean } = {}
): Promise<number> {
  const graphs = await prisma.workflowGraph.findMany({
    where: { enabled: true, status: 'published', triggerKey },
    select: { id: true, name: true, nodes: true, edges: true },
  });

  let started = 0;
  let infrastructureFailures = 0;
  for (const graph of graphs) {
    try {
      const validation = validateGraph(graph.nodes, graph.edges);
      if (!validation.ok) {
        appLogger.warn('[Flow] Graph failed runtime validation; skipping', {
          graphId: graph.id,
          errors: validation.errors,
        });
        continue;
      }

      let runId: string;
      try {
        const run = await prisma.flowRun.create({
          data: {
            graphId: graph.id,
            eventKey,
            triggerKey,
            contextDigest: digest(context),
            context: asJson(context),
          },
          select: { id: true },
        });
        runId = run.id;
      } catch (createError) {
        if (
          createError &&
          typeof createError === 'object' &&
          (createError as { code?: string }).code === 'P2002'
        ) {
          const existing = await prisma.flowRun.findUnique({
            where: { graphId_eventKey: { graphId: graph.id, eventKey } },
            select: { status: true },
          });
          if (existing?.status === 'succeeded' || existing?.status === 'waiting') {
            continue; // completed or durably parked delivery is safe to acknowledge
          }
          throw new Error(
            `Workflow delivery already exists in non-acknowledgeable state: ${existing?.status ?? 'missing'}`
          );
        }
        throw createError;
      }

      started += 1;
      await executeRun(graph.id, runId, graph.name, graph.nodes as unknown[], graph.edges as unknown[], context);
    } catch (error) {
      infrastructureFailures += 1;
      appLogger.error('[Flow] Graph emission failed', error instanceof Error ? error : undefined, {
        graphId: graph.id,
        triggerKey,
      });
    }
  }
  if (options.throwOnInfrastructureFailure && infrastructureFailures > 0) {
    throw new Error(`${infrastructureFailures} workflow graph delivery attempt(s) failed`);
  }
  return started;
}

export interface LifecycleActionEventInput {
  actionType: string;
  username: string;
  status: 'completed' | 'failed';
  /** Stable action identity (cuid) for dedupe across processor retries. */
  actionId?: string;
  batchId?: string | null;
  error?: string | null;
}

/**
 * Emit lifecycle-action flow events (ADR-0013 headroom). One entry point for
 * both trigger keys: completed actions fan out to graphs on
 * 'lifecycle_action_completed', failed ones to
 * 'lifecycle_action_failed'. The action id anchors the dedupe key so a
 * retried completion cannot start a second run; batch-only or ad-hoc
 * emissions fall back to batch identity, then to wall-clock identity.
 * The lifecycle processor should call this after it finalizes an action.
 */
export async function emitLifecycleActionEvent(input: LifecycleActionEventInput): Promise<number> {
  const failed = input.status === 'failed';
  const triggerKey = failed ? 'lifecycle_action_failed' : 'lifecycle_action_completed';
  const identity =
    input.actionId !== undefined
      ? `action:${input.actionId}`
      : input.batchId !== undefined && input.batchId !== null
        ? `batch:${input.batchId}`
        : `adhoc:${Date.now()}`;
  const eventKey = `lifecycle_action:${input.actionType}:${input.username}:${triggerKey}:${identity}`;
  return emitFlowEvent(triggerKey, eventKey, {
    actionType: input.actionType,
    username: input.username,
    status: input.status,
    ...(input.actionId !== undefined ? { actionId: input.actionId } : {}),
    ...(input.batchId !== undefined && input.batchId !== null ? { batchId: input.batchId } : {}),
    ...(failed ? { error: input.error ?? 'unknown error' } : {}),
  });
}

async function executeRun(
  graphId: string,
  runId: string,
  graphName: string,
  rawNodes: unknown[],
  rawEdges: unknown[],
  context: FlowContext,
  sourceNodeId?: string,
  sourceHandle?: string
): Promise<void> {
  const nodes = new Map<string, FlowNode>();
  for (const raw of rawNodes) {
    const node = raw as FlowNode;
    nodes.set(node.id, node);
  }
  const outgoing = new Map<string, FlowEdge[]>();
  for (const raw of rawEdges) {
    const edge = raw as FlowEdge;
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }

  const state: RunState = {
    runId,
    graphId,
    graphName,
    nodes,
    outgoing,
    outcomes: [],
    artifactsCreated: 0,
    context,
  };

  const triggerNode = sourceNodeId
    ? nodes.get(sourceNodeId)
    : [...nodes.values()].find((node) => {
        const category = FLOW_NODE_CATALOG[node.type]?.category;
        return category === 'trigger' || category === 'source';
      });

  const result = await walkBranch(state, triggerNode?.id, sourceHandle, 0);

  const hasFailure = result.failed || state.outcomes.some((outcome) => outcome.status === 'failed');
  await prisma.flowRun.update({
    where: { id: runId },
    data: {
      status: result.waited ? 'waiting' : hasFailure ? 'failed' : 'succeeded',
      nodeOutcomes: asJson(state.outcomes),
      finishedAt: result.waited ? null : new Date(),
      error: hasFailure
        ? (state.outcomes.find((outcome) => outcome.status === 'failed')?.error ?? 'branch failure')
        : null,
    },
  });
}

/**
 * Start one graph from one catalog-controlled source output. Unlike the
 * generic event bus this cannot broadcast a monitor transition to unrelated
 * workflows: the durable check is already pinned to its graph and node.
 */
export async function startFlowRunFromSource(
  graphId: string,
  sourceNodeId: string,
  sourceHandle: string,
  eventKey: string,
  context: FlowContext,
  options: { acceptedWhileActive?: boolean } = {}
): Promise<boolean> {
  const graph = await prisma.workflowGraph.findFirst({
    where: {
      id: graphId,
      status: 'published',
      ...(options.acceptedWhileActive ? {} : { enabled: true }),
    },
    select: { id: true, name: true, nodes: true, edges: true, triggerKey: true },
  });
  if (!graph) return false;
  const validation = validateGraph(graph.nodes, graph.edges);
  if (!validation.ok) throw new Error(`Workflow failed runtime validation: ${validation.errors.join('; ')}`);
  const source = (graph.nodes as unknown as FlowNode[]).find((node) => node.id === sourceNodeId);
  const definition = source ? FLOW_NODE_CATALOG[source.type] : undefined;
  if (!source || definition?.category !== 'source' || !definition.handles?.some((handle) => handle.id === sourceHandle)) {
    throw new Error('Monitor transition references an invalid workflow source output');
  }
  let runId: string;
  try {
    const run = await prisma.flowRun.create({
      data: {
        graphId: graph.id,
        eventKey,
        triggerKey: graph.triggerKey,
        sourceNodeId,
        sourceHandle,
        contextDigest: digest(context),
        context: asJson(context),
      },
      select: { id: true },
    });
    runId = run.id;
  } catch (error) {
    // The outbox may retry after a worker executed the run but failed before
    // marking the event processed. The unique event key proves acceptance.
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') return true;
    throw error;
  }
  await executeRun(
    graph.id,
    runId,
    graph.name,
    graph.nodes as unknown[],
    graph.edges as unknown[],
    context,
    sourceNodeId,
    sourceHandle
  );
  return true;
}

export async function resumeAuthorizedFlowActionAttempt(attemptId: string): Promise<boolean> {
  const current = await prisma.flowActionAttempt.findUnique({
    where: { id: attemptId },
    include: {
      run: {
        include: {
          graph: { select: { id: true, name: true, nodes: true, edges: true } },
        },
      },
    },
  });
  if (!current || current.status !== 'retry_authorized') return false;
  if (!current.run.context) {
    await prisma.flowActionAttempt.updateMany({
      where: { id: attemptId, status: 'retry_authorized' },
      data: {
        status: 'reconciliation_required',
        lastError: 'This historical run has no persisted context and cannot be resumed safely',
      },
    });
    return false;
  }

  const claimId = randomUUID();
  const claimed = await prisma.flowActionAttempt.updateMany({
    where: { id: attemptId, status: 'retry_authorized', claimId: null },
    data: {
      status: 'resume_claimed',
      claimId,
      claimedAt: new Date(),
      claimedUntil: new Date(Date.now() + 10 * 60 * 1000),
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return false;

  try {
    await executeRun(
      current.run.graph.id,
      current.run.id,
      current.run.graph.name,
      current.run.graph.nodes as unknown[],
      current.run.graph.edges as unknown[],
      current.run.context as FlowContext,
      current.nodeId,
      'out'
    );
    const finalized = await prisma.flowActionAttempt.findUnique({
      where: { id: attemptId },
      select: { status: true },
    });
    return finalized?.status === 'delivered';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workflow email recovery failed';
    await prisma.flowActionAttempt.updateMany({
      where: { id: attemptId, status: 'resume_claimed', claimId },
      data: {
        status: 'delivery_unknown',
        claimId: null,
        claimedUntil: null,
        lastError: message,
      },
    }).catch(() => undefined);
    return false;
  }
}

/** Resume runs parked on timers that are due. Returns processed count. */
export async function runFlowTick(): Promise<{ processed: number }> {
  const now = new Date();
  const staleActions = await prisma.flowActionAttempt.findMany({
    where: {
      status: { in: ['sending', 'resume_claimed', 'processing'] },
      claimedUntil: { lte: now },
    },
    take: 100,
    select: { id: true, runId: true, status: true, claimId: true },
  });
  for (const stale of staleActions) {
    const emailLike = stale.status === 'sending' || stale.status === 'resume_claimed';
    const reconciled = await prisma.flowActionAttempt.updateMany({
      where: { id: stale.id, status: stale.status, claimId: stale.claimId },
      data: {
        status: emailLike ? 'delivery_unknown' : 'reconciliation_required',
        claimId: null,
        claimedUntil: null,
        lastError: emailLike
          ? 'Email recovery claim expired after provider delivery may have started'
          : 'Action claim expired after an external mutation may have started',
      },
    });
    if (reconciled.count === 1) {
      await prisma.flowRun.updateMany({
        where: { id: stale.runId },
        data: { status: 'reconciliation_required', error: 'A workflow action has an unknown external outcome' },
      });
    }
  }

  const authorizedActionRetries = await prisma.flowActionAttempt.findMany({
    where: { status: 'retry_authorized' },
    orderBy: { updatedAt: 'asc' },
    take: 25,
    select: { id: true },
  });
  let processed = 0;
  for (const attempt of authorizedActionRetries) {
    if (await resumeAuthorizedFlowActionAttempt(attempt.id)) processed += 1;
  }

  const staleTimers = await prisma.flowTimer.findMany({
    where: { status: 'processing', claimedUntil: { lte: now } },
    take: 100,
    select: { id: true, runId: true, claimId: true },
  });
  for (const stale of staleTimers) {
    const reconciled = await prisma.flowTimer.updateMany({
      where: { id: stale.id, status: 'processing', claimId: stale.claimId },
      data: {
        status: 'reconciliation_required',
        claimId: null,
        claimedUntil: null,
        lastError: 'Timer claim expired after execution may have started; operator evidence is required before retry',
      },
    });
    if (reconciled.count === 1) {
      await prisma.flowRun.updateMany({
        where: { id: stale.runId, status: 'waiting' },
        data: {
          status: 'reconciliation_required',
          error: 'A workflow timer has an unknown execution outcome',
        },
      });
    }
  }

  const due = await prisma.flowTimer.findMany({
    where: {
      status: 'pending',
      dueAt: { lte: new Date() },
      // The run is pinned to this immutable graph row. Disabling a workflow or
      // publishing a successor stops new emissions but must not rewrite or
      // strand work that already reached a persisted timer.
      run: { status: 'waiting' },
    },
    orderBy: { dueAt: 'asc' },
    take: 25,
    select: { id: true, runId: true, nodeId: true, payload: true },
  });

  for (const timer of due) {
    const claimId = randomUUID();
    const claimed = await prisma.flowTimer.updateMany({
      where: { id: timer.id, status: 'pending', dueAt: { lte: new Date() } },
      data: {
        status: 'processing',
        claimId,
        claimedAt: new Date(),
        claimedUntil: new Date(Date.now() + 10 * 60 * 1000),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (claimed.count !== 1) continue;

    try {
      const run = await prisma.flowRun.findUnique({
        where: { id: timer.runId },
        include: { graph: { select: { id: true, name: true, nodes: true, edges: true, enabled: true, status: true } } },
      });
      if (!run) {
        // Orphaned timer: the run no longer exists, so no execution can resume.
        await prisma.flowTimer.deleteMany({
          where: { id: timer.id, status: 'processing', claimId },
        }).catch(() => undefined);
        continue;
      }
      if (run.status !== 'waiting') {
        // The run left the waiting state; a due timer for it can never
        // legitimately fire, so drop it instead of re-fetching every tick.
        await prisma.flowTimer.deleteMany({
          where: { id: timer.id, status: 'processing', claimId },
        }).catch(() => undefined);
        continue;
      }

      processed += 1;
      const context = (timer.payload ?? {}) as FlowContext;
      const state: RunState = {
        runId: run.id,
        graphId: run.graph.id,
        graphName: run.graph.name,
        nodes: new Map((run.graph.nodes as unknown[]).map((raw) => [(raw as FlowNode).id, raw as FlowNode])),
        outgoing: new Map<string, FlowEdge[]>(),
        outcomes: [],
        artifactsCreated: 0,
        context,
      };
      for (const raw of run.graph.edges as unknown[]) {
        const edge = raw as FlowEdge;
        const list = state.outgoing.get(edge.source) ?? [];
        list.push(edge);
        state.outgoing.set(edge.source, list);
      }

      const previousOutcomes = ((run.nodeOutcomes ?? []) as unknown as FlowNodeOutcome[]) ?? [];
      state.outcomes.push(...previousOutcomes);

      // Resume PAST the Wait node - re-running it would re-arm the timer forever.
      const result = await walkBranch(state, timer.nodeId, 'out', 0, { skipStartNode: true });
      const hasFailure =
        result.failed || state.outcomes.some((outcome) => outcome.status === 'failed');

      await prisma.flowRun.update({
        where: { id: run.id },
        data: {
          status: result.waited ? 'waiting' : hasFailure ? 'failed' : 'succeeded',
          nodeOutcomes: asJson(state.outcomes),
          finishedAt: result.waited ? null : new Date(),
          error: hasFailure
            ? (state.outcomes.find((outcome) => outcome.status === 'failed')?.error ?? 'branch failure')
            : null,
        },
      });

      // Delete only after a successful resume so a crash mid-processing can
      // never strand a waiting run with its wake-up gone.
      const deleted = await prisma.flowTimer.deleteMany({
        where: { id: timer.id, status: 'processing', claimId },
      });
      if (deleted.count !== 1) {
        throw new Error('Workflow timer ownership was lost during finalization');
      }
    } catch (error) {
      appLogger.error('[Flow] Tick processing failed for timer', error instanceof Error ? error : undefined, {
        timerId: timer.id,
      });
      const message = error instanceof Error ? error.message : 'Unknown timer processing failure';
      await prisma.flowTimer.updateMany({
        where: { id: timer.id, status: 'processing', claimId },
        data: {
          status: 'reconciliation_required',
          claimId: null,
          claimedUntil: null,
          lastError: message,
        },
      }).catch(() => undefined);
      await prisma.flowRun.updateMany({
        where: { id: timer.runId, status: 'waiting' },
        data: { status: 'reconciliation_required', error: message },
      }).catch(() => undefined);
    }
  }

  // Scheduled triggers fire when their per-graph interval has elapsed since
  // the previous scheduled run - late ticks catch up instead of losing the
  // firing entirely. Minute-bucket event keys keep redelivery idempotent.
  const schedules = await prisma.workflowGraph.findMany({
    where: { enabled: true, status: 'published', triggerKey: 'schedule' },
    select: { id: true, name: true, nodes: true },
  });
  for (const graph of schedules) {
    const nodes = (graph.nodes as unknown[]) as FlowNode[];
    const scheduleNode = nodes.find((node) => node.type === 'trigger_schedule');
    if (!scheduleNode) continue;
    const everyMinutes = Math.max(5, Number(scheduleNode.config.everyMinutes) || 5);
    const last = await prisma.flowRun.findFirst({
      where: { graphId: graph.id, triggerKey: 'schedule' },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    if (last && Date.now() - last.startedAt.getTime() < everyMinutes * 60_000) continue;
    const topic = String(scheduleNode.config.topic || graph.name);
    const bucket = Math.floor(Date.now() / 60_000);
    try {
      await emitFlowEvent('schedule', `${topic}:${bucket}`, {});
      processed += 1;
    } catch (error) {
      appLogger.warn('[Flow] scheduled emission failed', { graphId: graph.id, error: String(error) });
    }
  }

  return { processed };
}
