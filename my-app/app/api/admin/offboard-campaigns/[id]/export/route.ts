import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { prisma } from '@/lib/prisma';
import { generateCsvContent } from '@/lib/csv-security';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { getAccountVerificationMap, normalizeOffboardIdentifier } from '@/lib/offboard-campaign';

const EXPORT_LIMIT = 5_000;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'offboard.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const type = request.nextUrl.searchParams.get('type') === 'logs' ? 'logs' : 'recipients';
    const campaign = await prisma.offboardCampaign.findUnique({ where: { id } });
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    let csv = '';
    if (type === 'logs') {
      const total = await prisma.offboardCampaignLog.count({ where: { campaignId: id } });
      if (total > EXPORT_LIMIT) {
        return NextResponse.json(
          { error: 'Export filter is too broad', code: 'EXPORT_FILTER_TOO_BROAD', total },
          { status: 422, headers: NO_STORE_HEADERS }
        );
      }
      const logs = await prisma.offboardCampaignLog.findMany({
        where: { campaignId: id },
        orderBy: { createdAt: 'asc' },
        take: EXPORT_LIMIT,
      });
      csv = generateCsvContent(
        ['createdAt', 'level', 'eventType', 'actor', 'recipientId', 'message', 'details'],
        logs.map((log) => [
          log.createdAt.toISOString(),
          log.level,
          log.eventType,
          log.actor,
          log.recipientId,
          log.message,
          log.details ? JSON.stringify(log.details) : '',
        ])
      );
    } else {
      const total = await prisma.offboardCampaignRecipient.count({ where: { campaignId: id } });
      if (total > EXPORT_LIMIT) {
        return NextResponse.json(
          { error: 'Export filter is too broad', code: 'EXPORT_FILTER_TOO_BROAD', total },
          { status: 422, headers: NO_STORE_HEADERS }
        );
      }
      const recipients = await prisma.offboardCampaignRecipient.findMany({
        where: { campaignId: id },
        orderBy: [{ waveNumber: 'asc' }, { adUsername: 'asc' }],
        take: EXPORT_LIMIT,
      });
      const verificationMap = await getAccountVerificationMap(recipients.map((recipient) => recipient.adUsername));
      csv = generateCsvContent(
        [
          'adUsername',
          'email',
          'displayName',
          'linkedVpnUsername',
          'lastVerifiedAt',
          'lastVerifiedSource',
          'originalRegistrationAt',
          'waveNumber',
          'status',
          'skipReason',
          'initialEmailSentAt',
          'deadlineAt',
          'reminder3SentAt',
          'reminder6SentAt',
          'verifiedAt',
          'enforcedAt',
          'adLifecycleActionId',
          'vpnLifecycleActionId',
          'rollbackStatus',
          'lastError',
        ],
        recipients.map((recipient) => {
          const verification = verificationMap.get(normalizeOffboardIdentifier(recipient.adUsername));
          const lastVerifiedAt = recipient.verifiedAt || verification?.lastVerifiedAt || null;
          const lastVerifiedSource = recipient.verifiedAt ? 'current_campaign' : verification?.lastVerifiedSource || 'none';

          return [
            recipient.adUsername,
            recipient.email,
            recipient.displayName,
            recipient.linkedVpnUsername,
            lastVerifiedAt?.toISOString() || '',
            lastVerifiedSource,
            verification?.originalRegistrationAt?.toISOString() || '',
            recipient.waveNumber,
            recipient.status,
            recipient.skipReason,
            recipient.initialEmailSentAt?.toISOString() || '',
            recipient.deadlineAt?.toISOString() || '',
            recipient.reminder3SentAt?.toISOString() || '',
            recipient.reminder6SentAt?.toISOString() || '',
            recipient.verifiedAt?.toISOString() || '',
            recipient.enforcedAt?.toISOString() || '',
            recipient.adLifecycleActionId,
            recipient.vpnLifecycleActionId,
            recipient.rollbackStatus,
            recipient.lastError,
          ];
        })
      );
    }

    await logAuditAction({
      action: AuditActions.EXPORT_OFFBOARD_CAMPAIGN,
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: id,
      targetType: 'OffboardCampaign',
      details: { type },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="offboard-${campaign.id}-${type}.csv"`,
        ...NO_STORE_HEADERS,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export campaign data' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
