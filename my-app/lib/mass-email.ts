import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getLDAPGroupMembers, listUsersInOU } from '@/lib/ldap';
import { appLogger } from '@/lib/logger';
import { renderMassEmailContent } from '@/lib/mass-email-content';
import { sendMassEmail } from '@/lib/email';
import { INPUT_LIMITS, sanitizeString, validateEmail } from '@/lib/validation';
import type { MassEmailCampaign, MassEmailRecipient, Prisma } from '@prisma/client';

const db = prisma;
const STALE_SEND_CLAIM_MS = 4 * 60 * 60 * 1000;

type MassEmailModelClient = Pick<typeof prisma, 'massEmailCampaign' | 'massEmailRecipient' | 'massEmailLog'>;
type MassEmailStatusCount = { status: string; _count: { status: number } };

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export type MassEmailSourceType = 'manual' | 'group' | 'all_domain';

export interface MassEmailSource {
  type: MassEmailSourceType;
  label: string;
  groupDn?: string;
}

export interface MassEmailGroupTarget {
  dn: string;
  name?: string;
}

export interface MassEmailTargetInput {
  selectedUsernames?: string[];
  selectedGroups?: MassEmailGroupTarget[];
  includeAllDomainUsers?: boolean;
}

export interface ResolvedMassEmailRecipient {
  email: string;
  displayName: string | null;
  adUsername: string | null;
  adDn: string | null;
  accountEnabled: boolean | null;
  sources: MassEmailSource[];
}

export interface SkippedMassEmailRecipient {
  email?: string;
  displayName?: string | null;
  adUsername?: string | null;
  adDn?: string | null;
  reason: string;
  sources: MassEmailSource[];
}

export interface CandidateMassEmailRecipient {
  email?: string;
  displayName?: string | null;
  adUsername?: string | null;
  accountEnabled?: boolean | null;
  reason?: string;
  sources: MassEmailSource[];
}

export interface MassEmailResolution {
  candidates: CandidateMassEmailRecipient[];
  recipients: ResolvedMassEmailRecipient[];
  skipped: SkippedMassEmailRecipient[];
  summary: {
    totalCandidates: number;
    eligibleRecipients: number;
    skippedRecipients: number;
    duplicateSourcesMerged: number;
  };
  targets: Required<MassEmailTargetInput>;
}

export interface CreateMassEmailInput {
  name?: string;
  subject: string;
  html: string;
  targets: MassEmailTargetInput;
}

export function massEmailResolutionDigest(resolution: MassEmailResolution): string {
  const snapshot = {
    targets: resolution.targets,
    recipients: resolution.recipients.map((recipient) => ({
      email: recipient.email,
      adUsername: recipient.adUsername,
      accountEnabled: recipient.accountEnabled,
    })),
    skipped: resolution.skipped.map((recipient) => ({
      email: recipient.email || null,
      adUsername: recipient.adUsername || null,
      reason: recipient.reason,
    })),
  };
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function massEmailPreviewDigest(
  resolution: MassEmailResolution,
  subject: string,
  html: string
): string {
  const content = previewMassEmailContent(subject, html);
  return createHash('sha256').update(JSON.stringify({
    audience: massEmailResolutionDigest(resolution),
    subject: content.subject,
    html: content.html,
    text: content.text,
  })).digest('hex');
}

export type UpdateMassEmailDraftInput = CreateMassEmailInput;

function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

function normalizeUsername(username: string | null | undefined): string {
  return (username || '').trim().toLowerCase();
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
}

function normalizeTargets(targets: MassEmailTargetInput | undefined): Required<MassEmailTargetInput> {
  const selectedGroups = Array.isArray(targets?.selectedGroups)
    ? targets.selectedGroups
        .map((group) => ({ dn: String(group?.dn || '').trim(), name: group?.name ? String(group.name).trim() : undefined }))
        .filter((group) => group.dn)
    : [];

  return {
    selectedUsernames: uniqueStrings(targets?.selectedUsernames),
    selectedGroups,
    includeAllDomainUsers: Boolean(targets?.includeAllDomainUsers),
  };
}

function hasAnyTarget(targets: Required<MassEmailTargetInput>): boolean {
  return targets.includeAllDomainUsers || targets.selectedUsernames.length > 0 || targets.selectedGroups.length > 0;
}

function toCandidateSnapshot(candidate: ResolvedMassEmailRecipient | SkippedMassEmailRecipient): CandidateMassEmailRecipient {
  return {
    email: candidate.email,
    displayName: candidate.displayName || null,
    adUsername: candidate.adUsername || null,
    accountEnabled: 'accountEnabled' in candidate ? candidate.accountEnabled : null,
    reason: 'reason' in candidate ? candidate.reason : undefined,
    sources: candidate.sources,
  };
}

function uniqueSources(sources: MassEmailSource[]): MassEmailSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.type}:${source.groupDn || source.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateCampaignContent(input: CreateMassEmailInput): { name: string | null; subject: string; html: string; text: string } {
  const subject = sanitizeString(input.subject || '', INPUT_LIMITS.SUBJECT);
  if (!subject) {
    throw new Error('Subject is required');
  }

  if (!input.html || !input.html.trim()) {
    throw new Error('HTML body is required');
  }

  const content = renderMassEmailContent(input.html);
  return {
    name: input.name ? sanitizeString(input.name, INPUT_LIMITS.SUBJECT) || null : null,
    subject,
    html: content.html,
    text: content.text,
  };
}

export function dedupeMassEmailRecipients(candidates: Array<ResolvedMassEmailRecipient | SkippedMassEmailRecipient>) {
  const recipients = new Map<string, ResolvedMassEmailRecipient>();
  const skipped: SkippedMassEmailRecipient[] = [];
  let duplicateSourcesMerged = 0;

  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.email);
    if (!email || !validateEmail(email)) {
      const reason = !email && 'reason' in candidate && candidate.reason
        ? candidate.reason
        : 'missing_or_invalid_email';
      skipped.push({ ...candidate, reason });
      continue;
    }

    if ('accountEnabled' in candidate && candidate.accountEnabled === false) {
      skipped.push({ ...candidate, email, reason: 'disabled_ad_account' });
      continue;
    }

    const existing = recipients.get(email);
    if (existing) {
      const sourceCountBefore = existing.sources.length;
      existing.sources = uniqueSources([...existing.sources, ...candidate.sources]);
      duplicateSourcesMerged += existing.sources.length - sourceCountBefore;
      if (!existing.adUsername && 'adUsername' in candidate) existing.adUsername = candidate.adUsername || null;
      if (!existing.displayName && 'displayName' in candidate) existing.displayName = candidate.displayName || null;
      if (!existing.adDn && 'adDn' in candidate) existing.adDn = candidate.adDn || null;
      continue;
    }

    recipients.set(email, {
      email,
      displayName: 'displayName' in candidate ? candidate.displayName || null : null,
      adUsername: 'adUsername' in candidate ? candidate.adUsername || null : null,
      adDn: 'adDn' in candidate ? candidate.adDn || null : null,
      accountEnabled: 'accountEnabled' in candidate ? candidate.accountEnabled : null,
      sources: uniqueSources(candidate.sources),
    });
  }

  return {
    recipients: Array.from(recipients.values()).sort((left, right) => left.email.localeCompare(right.email)),
    skipped,
    duplicateSourcesMerged,
  };
}

export async function resolveMassEmailRecipients(targetInput: MassEmailTargetInput): Promise<MassEmailResolution> {
  const targets = normalizeTargets(targetInput);
  if (!hasAnyTarget(targets)) {
    throw new Error('At least one recipient target is required');
  }

  const candidates: Array<ResolvedMassEmailRecipient | SkippedMassEmailRecipient> = [];
  let allUsers: Awaited<ReturnType<typeof listUsersInOU>> | null = null;

  async function getAllUsers() {
    if (!allUsers) {
      allUsers = await listUsersInOU();
    }
    return allUsers;
  }

  if (targets.includeAllDomainUsers) {
    const users = await getAllUsers();
    for (const user of users) {
      candidates.push({
        email: user.email,
        displayName: user.displayName || user.username,
        adUsername: user.username,
        adDn: user.dn,
        accountEnabled: user.accountEnabled,
        sources: [{ type: 'all_domain', label: 'All configured AD users' }],
      });
    }
  }

  if (targets.selectedUsernames.length > 0) {
    const users = await getAllUsers();
    const usersByUsername = new Map(users.map((user) => [normalizeUsername(user.username), user]));
    const usersByEmail = new Map<string, (typeof users)[number]>();
    for (const user of users) {
      const email = normalizeEmail(user.email);
      if (email) usersByEmail.set(email, user);
    }

    for (const identifier of targets.selectedUsernames) {
      const email = normalizeEmail(identifier);
      const user = usersByUsername.get(normalizeUsername(identifier)) || usersByEmail.get(email);
      const source = { type: 'manual' as const, label: validateEmail(email) && !usersByUsername.has(normalizeUsername(identifier)) ? 'Manual email' : 'Selected user' };
      if (!user) {
        if (validateEmail(email)) {
          candidates.push({
            email,
            displayName: email,
            adUsername: null,
            adDn: null,
            accountEnabled: null,
            sources: [source],
          });
          continue;
        }

        candidates.push({ adUsername: identifier, reason: 'user_not_found', sources: [source] });
        continue;
      }
      candidates.push({
        email: user.email,
        displayName: user.displayName || user.username,
        adUsername: user.username,
        adDn: user.dn,
        accountEnabled: user.accountEnabled,
        sources: [source],
      });
    }
  }

  for (const group of targets.selectedGroups) {
    const source = { type: 'group' as const, label: group.name || group.dn, groupDn: group.dn };
    const members = await getLDAPGroupMembers(group.dn);
    for (const member of members) {
      candidates.push({
        email: member.email,
        displayName: member.displayName || member.username,
        adUsername: member.username,
        adDn: member.dn,
        accountEnabled: member.accountEnabled,
        sources: [source],
      });
    }
  }

  const deduped = dedupeMassEmailRecipients(candidates);
  return {
    candidates: candidates.map(toCandidateSnapshot),
    recipients: deduped.recipients,
    skipped: deduped.skipped,
    summary: {
      totalCandidates: candidates.length,
      eligibleRecipients: deduped.recipients.length,
      skippedRecipients: deduped.skipped.length,
      duplicateSourcesMerged: deduped.duplicateSourcesMerged,
    },
    targets,
  };
}

async function createMassEmailLog(client: MassEmailModelClient, input: {
  campaignId: string;
  recipientId?: string | null;
  level?: string;
  eventType: string;
  actor?: string | null;
  message: string;
  details?: Record<string, unknown>;
}) {
  return client.massEmailLog.create({
    data: {
      campaignId: input.campaignId,
      recipientId: input.recipientId || null,
      level: input.level || 'info',
      eventType: input.eventType,
      actor: input.actor || null,
      message: input.message,
      details: input.details ? toInputJson(input.details) : undefined,
    },
  });
}

async function createCampaign(
  input: CreateMassEmailInput,
  actor: string,
  options: { activate?: boolean; quickSend?: boolean; resolution?: MassEmailResolution } = {}
) {
  const content = validateCampaignContent(input);
  const resolution = options.resolution ?? await resolveMassEmailRecipients(input.targets);
  if (resolution.recipients.length === 0) {
    throw new Error('No eligible recipients were resolved');
  }

  const now = new Date();
  const status = options.activate ? 'active' : 'draft';
  const recipientStatus = options.activate ? 'pending_send' : 'ready';

  const campaignId = await db.$transaction(async (tx) => {
    const campaign = await tx.massEmailCampaign.create({
      data: {
        name: content.name,
        subject: content.subject,
        html: content.html,
        text: content.text,
        createdBy: actor,
        status,
        quickSend: Boolean(options.quickSend),
        dryRunAt: now,
        activatedAt: options.activate ? now : null,
        activatedBy: options.activate ? actor : null,
        totalRecipients: resolution.summary.totalCandidates,
        eligibleRecipients: resolution.summary.eligibleRecipients,
        skippedRecipients: resolution.summary.skippedRecipients,
        targetSnapshot: toInputJson({
          targets: resolution.targets,
          skipped: resolution.skipped,
          summary: resolution.summary,
          previewDigest: massEmailPreviewDigest(resolution, content.subject, content.html),
          resolvedAt: now.toISOString(),
        }),
      },
    });

    await tx.massEmailRecipient.createMany({
      data: resolution.recipients.map((recipient) => ({
        campaignId: campaign.id,
        email: recipient.email,
        displayName: recipient.displayName,
        adUsername: recipient.adUsername,
        adDn: recipient.adDn,
        accountEnabled: recipient.accountEnabled,
        status: recipientStatus,
        sources: toInputJson(recipient.sources),
      })),
    });

    await createMassEmailLog(tx, {
      campaignId: campaign.id,
      eventType: options.activate ? 'campaign_activated' : 'draft_created',
      actor,
      message: options.activate
        ? `Mass email campaign activated with ${resolution.summary.eligibleRecipients} recipients`
        : `Mass email draft created with ${resolution.summary.eligibleRecipients} recipients`,
      details: resolution.summary,
    });

    return campaign.id;
  });

  const campaign = await getMassEmailCampaign(campaignId);
  if (!campaign) throw new Error('Mass email campaign could not be loaded after creation');
  return campaign;
}

export function previewMassEmailContent(subject: string, rawHtml: string) {
  const safeSubject = sanitizeString(subject || '', INPUT_LIMITS.SUBJECT);
  return { subject: safeSubject, ...renderMassEmailContent(rawHtml || '') };
}

export async function createMassEmailDraft(input: CreateMassEmailInput, actor: string) {
  return createCampaign(input, actor, { activate: false, quickSend: false });
}

export async function quickSendMassEmail(
  input: CreateMassEmailInput,
  actor: string,
  expectedPreviewDigest: string
) {
  const resolution = await resolveMassEmailRecipients(input.targets);
  if (
    !/^[a-f0-9]{64}$/.test(expectedPreviewDigest)
    || massEmailPreviewDigest(resolution, input.subject, input.html) !== expectedPreviewDigest
  ) {
    throw new Error('MASS_EMAIL_PREVIEW_STALE');
  }
  const campaign = await createCampaign(input, actor, { activate: true, quickSend: true, resolution });
  const results = await processMassEmailCampaigns({ campaignId: campaign.id, actor, limit: 25 });
  return { campaign: await getMassEmailCampaign(campaign.id), results };
}

export async function updateMassEmailDraft(campaignId: string, input: UpdateMassEmailDraftInput, actor: string) {
  const existing = await db.massEmailCampaign.findUnique({ where: { id: campaignId } });
  if (!existing) throw new Error('Mass email campaign not found');
  if (existing.status !== 'draft') throw new Error('Only draft mass email campaigns can be edited');

  const content = validateCampaignContent(input);
  const resolution = await resolveMassEmailRecipients(input.targets);
  if (resolution.recipients.length === 0) {
    throw new Error('No eligible recipients were resolved');
  }

  const changedFields: string[] = [];
  if (existing.subject !== content.subject) changedFields.push('subject');
  if (existing.html !== content.html) changedFields.push('message');
  if (
    existing.totalRecipients !== resolution.summary.totalCandidates
    || existing.eligibleRecipients !== resolution.summary.eligibleRecipients
    || existing.skippedRecipients !== resolution.summary.skippedRecipients
  ) {
    changedFields.push('audience');
  }

  const now = new Date();
  await db.$transaction(async (tx) => {
    const claimedDraft = await tx.massEmailCampaign.updateMany({
      where: { id: campaignId, status: 'draft', updatedAt: existing.updatedAt },
      data: {
        name: content.name,
        subject: content.subject,
        html: content.html,
        text: content.text,
        dryRunAt: now,
        totalRecipients: resolution.summary.totalCandidates,
        eligibleRecipients: resolution.summary.eligibleRecipients,
        skippedRecipients: resolution.summary.skippedRecipients,
        sentCount: 0,
        failedCount: 0,
        targetSnapshot: toInputJson({
          targets: resolution.targets,
          skipped: resolution.skipped,
          summary: resolution.summary,
          previewDigest: massEmailPreviewDigest(resolution, content.subject, content.html),
          resolvedAt: now.toISOString(),
        }),
      },
    });
    if (claimedDraft.count !== 1) throw new Error('Mass email draft changed concurrently; reload before saving');

    await tx.massEmailRecipient.deleteMany({ where: { campaignId } });
    await tx.massEmailRecipient.createMany({
      data: resolution.recipients.map((recipient) => ({
        campaignId,
        email: recipient.email,
        displayName: recipient.displayName,
        adUsername: recipient.adUsername,
        adDn: recipient.adDn,
        accountEnabled: recipient.accountEnabled,
        status: 'ready',
        sources: toInputJson(recipient.sources),
      })),
    });

    await createMassEmailLog(tx, {
      campaignId,
      eventType: 'draft_updated',
      actor,
      message: `Mass email draft updated${changedFields.length > 0 ? `: ${changedFields.join(', ')}` : ''}`,
      details: {
        changedFields,
        ...resolution.summary,
      },
    });
  });

  const campaign = await getMassEmailCampaign(campaignId);
  if (!campaign) throw new Error('Mass email campaign could not be loaded after update');
  return campaign;
}

export async function getMassEmailCampaign(campaignId: string, client: MassEmailModelClient = db) {
  const campaign = await client.massEmailCampaign.findUnique({
    where: { id: campaignId },
    include: {
      recipients: {
        orderBy: [{ status: 'asc' }, { email: 'asc' }],
        take: 250,
      },
      logs: {
        orderBy: { createdAt: 'desc' },
        take: 100,
      },
    },
  });

  if (!campaign) return null;

  const statusCounts = await client.massEmailRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { status: true },
  });

  return {
    ...campaign,
    statusCounts: (statusCounts as MassEmailStatusCount[]).reduce((acc: Record<string, number>, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {}),
  };
}

export async function listMassEmailCampaigns(selectedCampaignId?: string | null) {
  const campaigns = await db.massEmailCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true,
      name: true,
      subject: true,
      status: true,
      quickSend: true,
      createdAt: true,
      createdBy: true,
      activatedAt: true,
      completedAt: true,
      cancelledAt: true,
      totalRecipients: true,
      eligibleRecipients: true,
      skippedRecipients: true,
      sentCount: true,
      failedCount: true,
    },
  });

  const selectedId = selectedCampaignId || campaigns[0]?.id || null;
  const selectedCampaign = selectedId ? await getMassEmailCampaign(selectedId) : null;
  return { campaigns, selectedCampaign };
}

export async function activateMassEmailCampaign(campaignId: string, actor: string) {
  await db.massEmailCampaign.updateMany({
    where: {
      id: campaignId,
      status: 'activating',
      activationClaimedUntil: { lte: new Date() },
    },
    data: {
      status: 'draft',
      activationClaimId: null,
      activationClaimedUntil: null,
    },
  });
  const campaign = await db.massEmailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error('Mass email campaign not found');
  if (campaign.status !== 'draft') throw new Error('Only draft mass email campaigns can be activated');
  if (campaign.eligibleRecipients <= 0) throw new Error('Campaign has no eligible recipients');

  const claimId = randomUUID();
  const claimed = await db.massEmailCampaign.updateMany({
    where: { id: campaignId, status: 'draft', updatedAt: campaign.updatedAt },
    data: {
      status: 'activating',
      activationClaimId: claimId,
      activationClaimedUntil: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  if (claimed.count !== 1) throw new Error('Mass email campaign changed or activation is already in progress');

  try {
    const snapshot = campaign.targetSnapshot as {
      targets?: MassEmailTargetInput;
      previewDigest?: string;
    } | null;
    if (!snapshot?.targets || !snapshot.previewDigest) {
      throw new Error('MASS_EMAIL_PREVIEW_STALE');
    }
    const currentResolution = await resolveMassEmailRecipients(snapshot.targets);
    const currentDigest = massEmailPreviewDigest(currentResolution, campaign.subject, campaign.html);
    if (currentDigest !== snapshot.previewDigest) {
      throw new Error('MASS_EMAIL_PREVIEW_STALE');
    }

    await db.$transaction(async (tx) => {
      const finalized = await tx.massEmailCampaign.updateMany({
        where: { id: campaignId, status: 'activating', activationClaimId: claimId },
        data: {
          status: 'active',
          activatedAt: new Date(),
          activatedBy: actor,
          activationClaimId: null,
          activationClaimedUntil: null,
        },
      });
      if (finalized.count !== 1) throw new Error('Mass email activation ownership was lost');
      await tx.massEmailRecipient.updateMany({
        where: { campaignId, status: 'ready' },
        data: { status: 'pending_send' },
      });
      await createMassEmailLog(tx, {
        campaignId,
        eventType: 'campaign_activated',
        actor,
        message: 'Mass email campaign activated',
      });
    });
  } catch (error) {
    await db.massEmailCampaign.updateMany({
      where: { id: campaignId, status: 'activating', activationClaimId: claimId },
      data: {
        status: 'draft',
        activationClaimId: null,
        activationClaimedUntil: null,
      },
    }).catch(() => undefined);
    throw error;
  }

  return getMassEmailCampaign(campaignId);
}

export async function cancelMassEmailCampaign(campaignId: string, actor: string) {
  const campaign = await db.massEmailCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error('Mass email campaign not found');
  if (campaign.status === 'completed' || campaign.status === 'cancelled') {
    throw new Error('Campaign is already closed');
  }

  await db.$transaction(async (tx) => {
    await tx.massEmailCampaign.update({
      where: { id: campaignId },
      data: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor },
    });
    await tx.massEmailRecipient.updateMany({
      where: { campaignId, status: { in: ['ready', 'pending_send'] } },
      data: { status: 'cancelled' },
    });
    await createMassEmailLog(tx, {
      campaignId,
      eventType: 'campaign_cancelled',
      actor,
      message: 'Mass email campaign cancelled',
    });
  });

  return getMassEmailCampaign(campaignId);
}

async function markStaleMassEmailClaims() {
  const now = new Date();
  const staleRecipients = await db.massEmailRecipient.findMany({
    where: { status: 'sending', emailClaimedUntil: { lte: now } },
    take: 100,
  });

  for (const recipient of staleRecipients) {
    await db.$transaction(async (tx) => {
      const updated = await tx.massEmailRecipient.updateMany({
        where: {
          id: recipient.id,
          status: 'sending',
          emailClaimId: recipient.emailClaimId,
          emailClaimedUntil: { lte: now },
        },
        data: {
          status: 'delivery_unknown',
          emailClaimId: null,
          emailClaimedUntil: null,
          deliveryFailureCounted: true,
          failedAt: new Date(),
          lastError: 'Send claim became stale; provider acceptance is unknown and must be reconciled',
        },
      });
      if (updated.count === 1) {
        await tx.massEmailCampaign.update({
          where: { id: recipient.campaignId },
          data: { failedCount: { increment: 1 } },
        });
        await createMassEmailLog(tx, {
          campaignId: recipient.campaignId,
          recipientId: recipient.id,
          level: 'error',
          eventType: 'send_claim_stale',
          actor: 'system',
          message: `Mass email delivery outcome is unknown for ${recipient.email}`,
        });
      }
    });
  }
}

async function sendRecipient(campaign: MassEmailCampaign, recipient: MassEmailRecipient, actor: string): Promise<boolean> {
  const claimId = randomUUID();
  const claimed = await db.massEmailRecipient.updateMany({
    where: { id: recipient.id, status: 'pending_send' },
    data: {
      status: 'sending',
      emailClaimId: claimId,
      emailClaimedAt: new Date(),
      emailClaimedUntil: new Date(Date.now() + STALE_SEND_CLAIM_MS),
      deliveryAttempts: { increment: 1 },
      deliveryFailureCounted: false,
      lastError: null,
    },
  });
  if (claimed.count !== 1) return false;

  try {
    const info = await sendMassEmail({
      to: recipient.email,
      subject: campaign.subject,
      html: campaign.html,
      text: campaign.text,
    });

    await db.$transaction(async (tx) => {
      const finalized = await tx.massEmailRecipient.updateMany({
        where: { id: recipient.id, status: 'sending', emailClaimId: claimId },
        data: {
          status: 'sent',
          emailClaimId: null,
          emailClaimedUntil: null,
          sentAt: new Date(),
          messageId: info.messageId || null,
          deliveryFailureCounted: false,
          lastError: null,
        },
      });
      if (finalized.count !== 1) return;
      await tx.massEmailCampaign.update({
        where: { id: campaign.id },
        data: { sentCount: { increment: 1 } },
      });
      await createMassEmailLog(tx, {
        campaignId: campaign.id,
        recipientId: recipient.id,
        eventType: 'email_sent',
        actor,
        message: `Mass email sent to ${recipient.email}`,
        details: { messageId: info.messageId },
      });
    });
    const current = await db.massEmailRecipient.findUnique({
      where: { id: recipient.id },
      select: { status: true },
    });
    return current?.status === 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown send failure';
    await db.$transaction(async (tx) => {
      const finalized = await tx.massEmailRecipient.updateMany({
        where: { id: recipient.id, status: 'sending', emailClaimId: claimId },
        data: {
          status: 'delivery_unknown',
          emailClaimId: null,
          emailClaimedUntil: null,
          deliveryFailureCounted: true,
          failedAt: new Date(),
          lastError: `Mail transport did not confirm a safe retry outcome: ${message}`,
        },
      });
      if (finalized.count !== 1) return;
      await tx.massEmailCampaign.update({
        where: { id: campaign.id },
        data: { failedCount: { increment: 1 } },
      });
      await createMassEmailLog(tx, {
        campaignId: campaign.id,
        recipientId: recipient.id,
        level: 'error',
        eventType: 'email_delivery_unknown',
        actor,
        message: `Mass email delivery outcome is unknown for ${recipient.email}`,
        details: { error: message },
      });
    });
    return false;
  }
}

async function completeCampaignIfFinished(campaignId: string, actor: string) {
  const [pending, sending, unknown, campaign] = await Promise.all([
    db.massEmailRecipient.count({ where: { campaignId, status: 'pending_send' } }),
    db.massEmailRecipient.count({ where: { campaignId, status: 'sending' } }),
    db.massEmailRecipient.count({ where: { campaignId, status: 'delivery_unknown' } }),
    db.massEmailCampaign.findUnique({ where: { id: campaignId } }),
  ]);

  if (
    !campaign
    || !['active', 'reconciliation_required'].includes(campaign.status)
    || pending > 0
    || sending > 0
  ) return;

  if (unknown > 0) {
    await db.$transaction(async (tx) => {
      await tx.massEmailCampaign.update({
        where: { id: campaignId },
        data: { status: 'reconciliation_required', completedAt: null },
      });
      await createMassEmailLog(tx, {
        campaignId,
        eventType: 'campaign_reconciliation_required',
        actor,
        level: 'error',
        message: `${unknown} recipient delivery outcome(s) require operator reconciliation`,
        details: { deliveryUnknownCount: unknown },
      });
    });
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.massEmailCampaign.update({
      where: { id: campaignId },
      data: { status: 'completed', completedAt: new Date() },
    });
    await createMassEmailLog(tx, {
      campaignId,
      eventType: 'campaign_completed',
      actor,
      message: 'Mass email campaign completed',
      details: { sentCount: campaign.sentCount, failedCount: campaign.failedCount },
    });
  });
}

export async function processMassEmailCampaigns(options: { campaignId?: string; actor?: string; limit?: number } = {}) {
  const actor = options.actor || 'system';
  const limit = Math.max(1, Math.min(options.limit || 50, 250));
  await markStaleMassEmailClaims();

  const campaigns = await db.massEmailCampaign.findMany({
    where: {
      status: 'active',
      ...(options.campaignId ? { id: options.campaignId } : {}),
    },
    orderBy: { activatedAt: 'asc' },
  });

  const summaries = [];
  for (const campaign of campaigns) {
    const summary = { campaignId: campaign.id, sent: 0, failed: 0 };
    while (summary.sent + summary.failed < limit) {
      const recipients = await db.massEmailRecipient.findMany({
        where: { campaignId: campaign.id, status: 'pending_send' },
        orderBy: { email: 'asc' },
        take: Math.max(1, limit - summary.sent - summary.failed),
      });

      if (recipients.length === 0) break;
      for (const recipient of recipients) {
        const sent = await sendRecipient(campaign, recipient, actor);
        if (sent) summary.sent += 1;
        else summary.failed += 1;
      }
    }

    await completeCampaignIfFinished(campaign.id, actor);
    summaries.push(summary);
  }

  return summaries;
}

export async function reconcileMassEmailRecipient(
  campaignId: string,
  recipientId: string,
  actor: string,
  resolution: 'delivered' | 'not_delivered',
  evidence: string
) {
  const normalizedEvidence = evidence.trim();
  if (normalizedEvidence.length < 10) {
    throw new Error('Reconciliation evidence must contain at least 10 characters');
  }

  const reconciled = await db.$transaction(async (tx) => {
    const recipient = await tx.massEmailRecipient.findUnique({
      where: { id: recipientId },
      select: { id: true, campaignId: true, email: true, status: true, deliveryFailureCounted: true },
    });
    if (!recipient || recipient.campaignId !== campaignId) {
      throw new Error('Mass email recipient not found');
    }
    if (recipient.status !== 'delivery_unknown') {
      throw new Error('Only delivery_unknown recipients can be reconciled');
    }

    const nextStatus = resolution === 'delivered' ? 'sent' : 'pending_send';
    const updated = await tx.massEmailRecipient.updateMany({
      where: { id: recipientId, campaignId, status: 'delivery_unknown' },
      data: {
        status: nextStatus,
        sentAt: resolution === 'delivered' ? new Date() : null,
        failedAt: null,
        emailClaimId: null,
        emailClaimedUntil: null,
        deliveryFailureCounted: false,
        lastError: resolution === 'delivered'
          ? null
          : `Operator confirmed non-delivery: ${normalizedEvidence}`,
      },
    });
    if (updated.count !== 1) throw new Error('Recipient reconciliation conflict');

    await tx.massEmailCampaign.update({
      where: { id: campaignId },
      data: {
        status: resolution === 'delivered' ? 'reconciliation_required' : 'active',
        ...(recipient.deliveryFailureCounted ? { failedCount: { decrement: 1 } } : {}),
        ...(resolution === 'delivered' ? { sentCount: { increment: 1 } } : {}),
      },
    });
    await createMassEmailLog(tx, {
      campaignId,
      recipientId,
      eventType: resolution === 'delivered'
        ? 'delivery_reconciled_delivered'
        : 'delivery_reconciled_not_delivered',
      actor,
      message: resolution === 'delivered'
        ? `Operator confirmed delivery to ${recipient.email}`
        : `Operator confirmed non-delivery to ${recipient.email}; one explicit retry is queued`,
      details: { resolution, evidence: normalizedEvidence },
    });

    return nextStatus;
  });

  if (reconciled === 'sent') {
    const unknown = await db.massEmailRecipient.count({
      where: { campaignId, status: 'delivery_unknown' },
    });
    if (unknown === 0) {
      await completeCampaignIfFinished(campaignId, actor);
    }
  }

  return getMassEmailCampaign(campaignId);
}

export async function sendMassEmailTest(input: { to: string; subject: string; html: string }, actor: string) {
  const to = normalizeEmail(input.to);
  if (!validateEmail(to)) throw new Error('A valid test email address is required');
  const subject = sanitizeString(input.subject || '', INPUT_LIMITS.SUBJECT);
  if (!subject) throw new Error('Subject is required');
  const content = renderMassEmailContent(input.html || '');
  const info = await sendMassEmail({ to, subject, html: content.html, text: content.text });
  appLogger.info('Mass email test sent', { actor, to, messageId: info.messageId });
  return { messageId: info.messageId || null, accepted: info.accepted || [] };
}
