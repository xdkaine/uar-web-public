import { randomUUID } from 'node:crypto';

import { sendFacultyNotification, sendVPNPendingFacultyNotification } from '@/lib/email';
import { prisma } from '@/lib/prisma';

const FACULTY_DELIVERY_CLAIM_MS = 5 * 60 * 1000;

export type FacultyDeliveryResult =
  | { status: 'delivered'; request: NonNullable<Awaited<ReturnType<typeof prisma.accessRequest.findUnique>>> }
  | { status: 'already_delivered' | 'in_progress' | 'delivery_unknown' | 'conflict'; request: null };

export async function deliverFacultyNotification(input: {
  requestId: string;
  actor: string;
  recipients: string[];
  vpnModuleEnabled: boolean;
  expectedStatus: string;
}): Promise<FacultyDeliveryResult> {
  if (input.recipients.length === 0) {
    throw new Error('No faculty delivery recipient is configured');
  }

  const accessRequest = await prisma.accessRequest.findUnique({ where: { id: input.requestId } });
  if (!accessRequest || accessRequest.status !== input.expectedStatus || !accessRequest.isVerified) {
    return { status: 'conflict', request: null };
  }
  if (accessRequest.sentToFacultyAt || accessRequest.facultyNotificationState === 'delivered') {
    return { status: 'already_delivered', request: null };
  }
  if (accessRequest.facultyNotificationState === 'delivery_unknown') {
    return { status: 'delivery_unknown', request: null };
  }
  if (accessRequest.facultyNotificationState === 'sending') {
    if (accessRequest.facultyNotificationClaimedUntil && accessRequest.facultyNotificationClaimedUntil <= new Date()) {
      await prisma.accessRequest.updateMany({
        where: {
          id: input.requestId,
          facultyNotificationState: 'sending',
          facultyNotificationClaimId: accessRequest.facultyNotificationClaimId,
          facultyNotificationClaimedUntil: { lte: new Date() },
        },
        data: {
          facultyNotificationState: 'delivery_unknown',
          facultyNotificationClaimId: null,
          facultyNotificationClaimedUntil: null,
          facultyNotificationError: 'Faculty delivery claim expired; provider acceptance is unknown',
        },
      });
      return { status: 'delivery_unknown', request: null };
    }
    return { status: 'in_progress', request: null };
  }

  const claimId = randomUUID();
  const claimed = await prisma.accessRequest.updateMany({
    where: {
      id: input.requestId,
      version: accessRequest.version,
      status: input.expectedStatus,
      isVerified: true,
      sentToFacultyAt: null,
      OR: [
        { facultyNotificationState: null },
        { facultyNotificationState: 'failed' },
      ],
    },
    data: {
      facultyNotificationState: 'sending',
      facultyNotificationClaimId: claimId,
      facultyNotificationClaimedUntil: new Date(Date.now() + FACULTY_DELIVERY_CLAIM_MS),
      facultyNotificationError: null,
      version: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return { status: 'conflict', request: null };

  try {
    if (input.vpnModuleEnabled) {
      for (const recipient of input.recipients) {
        await sendVPNPendingFacultyNotification(
          recipient,
          accessRequest.vpnUsername || accessRequest.ldapUsername || 'N/A',
          accessRequest.name,
          accessRequest.email,
          accessRequest.isInternal ? 'Internal (Management/Limited)' : 'External',
          input.actor
        );
      }
    } else {
      await sendFacultyNotification(
        input.requestId,
        accessRequest.name,
        accessRequest.email,
        accessRequest.isInternal,
        accessRequest.needsDomainAccount,
        undefined,
        undefined,
        undefined,
        input.recipients
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Faculty delivery failed';
    await prisma.accessRequest.updateMany({
      where: { id: input.requestId, status: input.expectedStatus, facultyNotificationClaimId: claimId, facultyNotificationState: 'sending' },
      data: {
        facultyNotificationState: 'delivery_unknown',
        facultyNotificationClaimId: null,
        facultyNotificationClaimedUntil: null,
        facultyNotificationError: message.slice(0, 500),
      },
    }).catch(() => undefined);
    return { status: 'delivery_unknown', request: null };
  }

  let updatedRequest = null;
  try {
    updatedRequest = await prisma.$transaction(async (tx) => {
      const finalized = await tx.accessRequest.updateMany({
        where: {
          id: input.requestId,
          version: accessRequest.version + 1,
          status: input.expectedStatus,
          facultyNotificationClaimId: claimId,
          facultyNotificationState: 'sending',
        },
        data: {
          sentToFacultyAt: new Date(),
          sentToFacultyBy: input.actor,
          facultyNotificationState: 'delivered',
          facultyNotificationClaimId: null,
          facultyNotificationClaimedUntil: null,
          facultyNotificationError: null,
          version: { increment: 1 },
        },
      });
      if (finalized.count !== 1) return null;
      await tx.requestComment.create({
        data: {
          requestId: input.requestId,
          comment: `Faculty notification delivered by ${input.actor}.${input.vpnModuleEnabled ? ' Faculty has been notified to create or enable the VPN account.' : ''}`,
          author: input.actor,
          type: 'system',
        },
      });
      return tx.accessRequest.findUnique({ where: { id: input.requestId } });
    });
  } catch {
    updatedRequest = null;
  }

  if (!updatedRequest) {
    await prisma.accessRequest.updateMany({
      where: { id: input.requestId, status: input.expectedStatus, facultyNotificationClaimId: claimId, facultyNotificationState: 'sending' },
      data: {
        facultyNotificationState: 'delivery_unknown',
        facultyNotificationClaimId: null,
        facultyNotificationClaimedUntil: null,
        facultyNotificationError: 'SMTP accepted the message, but portal finalization failed',
      },
    }).catch(() => undefined);
    return { status: 'delivery_unknown', request: null };
  }

  return { status: 'delivered', request: updatedRequest };
}
