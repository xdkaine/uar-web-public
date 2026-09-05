import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { requireModuleEnabled } from '@/lib/modules/guards';

import { getIpAddress, logAuditAction } from '@/lib/audit-log';
import { searchLDAPUser } from '@/lib/ldap';
import { INPUT_LIMITS, isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit, validateStringLength } from '@/lib/validation';

interface MatchRequestBody {
  recordId?: unknown;
  adUsername?: unknown;
  matchNotes?: unknown;
}

interface MatchStatusBody {
  recordId?: unknown;
  matchStatus?: unknown;
  matchNotes?: unknown;
}

function getAttribute(
  user: { attributes: Array<{ type: string; values: string[] }> },
  attributeName: string
): string | null {
  const attribute = user.attributes.find((attr) => attr.type.toLowerCase() === attributeName.toLowerCase());
  return attribute?.values?.[0] || null;
}

function normalizeNotes(value: unknown): { notes?: string | null; error?: string } {
  if (value === undefined || value === null) {
    return { notes: null };
  }

  if (typeof value !== 'string') {
    return { error: 'Match notes must be text' };
  }

  const notes = value.trim();
  const validation = validateStringLength(notes, 'Match notes', INPUT_LIMITS.COMMENT);
  if (!validation.valid) {
    return { error: validation.error };
  }

  return { notes: notes || null };
}

async function refreshMatchedCount(importId: string, tx: Prisma.TransactionClient) {
  const matchedRecords = await tx.vPNImportRecord.count({
    where: {
      importId,
      matchStatus: 'matched',
    },
  });

  await tx.vPNImport.update({
    where: { id: importId },
    data: { matchedRecords },
  });

  return matchedRecords;
}

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'vpn.manage')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const vpnModuleGuard = await requireModuleEnabled('vpn.management');
    if (vpnModuleGuard) return vpnModuleGuard;
    const body = await parseJsonWithLimit<MatchRequestBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const recordId = typeof body.recordId === 'string' ? body.recordId.trim() : '';
    const adUsername = typeof body.adUsername === 'string' ? body.adUsername.trim() : '';
    const notesResult = normalizeNotes(body.matchNotes);

    if (!recordId || !adUsername) {
      return NextResponse.json({ error: 'Record ID and AD username are required' }, { status: 400 });
    }

    if (notesResult.error) {
      return NextResponse.json({ error: notesResult.error }, { status: 400 });
    }

    const adUser = await searchLDAPUser(adUsername);
    if (!adUser) {
      return NextResponse.json({ error: 'AD account not found' }, { status: 404 });
    }

    const normalizedAdUsername = getAttribute(adUser, 'sAMAccountName') || adUsername;
    const adDisplayName = getAttribute(adUser, 'displayName') || getAttribute(adUser, 'cn');
    const adEmail = getAttribute(adUser, 'mail');
    const adDepartment = getAttribute(adUser, 'department');

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const importRecord = await tx.vPNImportRecord.findUnique({
        where: { id: recordId },
        include: { import: true },
      });

      if (!importRecord) {
        throw new Error('IMPORT_RECORD_NOT_FOUND');
      }

      if (importRecord.vpnAccountCreated) {
        throw new Error('IMPORT_RECORD_ALREADY_PROCESSED');
      }

      const updatedRecord = await tx.vPNImportRecord.update({
        where: { id: recordId },
        data: {
          matchStatus: 'matched',
          adUsername: normalizedAdUsername,
          adDisplayName,
          adEmail,
          adDepartment,
          matchedBy: admin.username,
          matchedAt: new Date(),
          matchNotes: notesResult.notes ?? null,
        },
      });

      const matchedRecords = await refreshMatchedCount(importRecord.importId, tx);

      return {
        importId: importRecord.importId,
        vpnUsername: importRecord.vpnUsername,
        matchedRecords,
        record: updatedRecord,
      };
    }, {
      isolationLevel: 'Serializable',
      timeout: 10000,
    });

    await logAuditAction({
      category: 'vpn',
      action: 'import_record_matched',
      username: admin.username,
      targetType: 'VPNImportRecord',
      targetId: recordId,
      details: {
        importId: result.importId,
        vpnUsername: result.vpnUsername,
        adUsername: normalizedAdUsername,
      },
      ipAddress: getIpAddress(request) || 'unknown',
      success: true,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    if (error instanceof Error && error.message === 'IMPORT_RECORD_NOT_FOUND') {
      return NextResponse.json({ error: 'Import record not found' }, { status: 404 });
    }

    if (error instanceof Error && error.message === 'IMPORT_RECORD_ALREADY_PROCESSED') {
      return NextResponse.json({ error: 'Import record has already been processed' }, { status: 409 });
    }

    console.error('VPN import match error:', error);
    return NextResponse.json({ error: 'Failed to match VPN import record' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'vpn.manage')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const vpnModuleGuard = await requireModuleEnabled('vpn.management');
    if (vpnModuleGuard) return vpnModuleGuard;
    const body = await parseJsonWithLimit<MatchStatusBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const recordId = typeof body.recordId === 'string' ? body.recordId.trim() : '';
    const matchStatus = typeof body.matchStatus === 'string' ? body.matchStatus.trim() : '';
    const notesResult = normalizeNotes(body.matchNotes);

    if (!recordId) {
      return NextResponse.json({ error: 'Record ID is required' }, { status: 400 });
    }

    if (!['unmatched', 'no_match', 'conflict'].includes(matchStatus)) {
      return NextResponse.json({ error: 'Invalid match status' }, { status: 400 });
    }

    if (notesResult.error) {
      return NextResponse.json({ error: notesResult.error }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const importRecord = await tx.vPNImportRecord.findUnique({
        where: { id: recordId },
      });

      if (!importRecord) {
        throw new Error('IMPORT_RECORD_NOT_FOUND');
      }

      if (importRecord.vpnAccountCreated) {
        throw new Error('IMPORT_RECORD_ALREADY_PROCESSED');
      }

      const updatedRecord = await tx.vPNImportRecord.update({
        where: { id: recordId },
        data: {
          matchStatus,
          adUsername: null,
          adDisplayName: null,
          adEmail: null,
          adDepartment: null,
          matchedBy: matchStatus === 'unmatched' ? null : admin.username,
          matchedAt: matchStatus === 'unmatched' ? null : new Date(),
          matchNotes: notesResult.notes ?? null,
        },
      });

      const matchedRecords = await refreshMatchedCount(importRecord.importId, tx);

      return {
        importId: importRecord.importId,
        vpnUsername: importRecord.vpnUsername,
        matchedRecords,
        record: updatedRecord,
      };
    }, {
      isolationLevel: 'Serializable',
      timeout: 10000,
    });

    await logAuditAction({
      category: 'vpn',
      action: 'import_record_match_status_updated',
      username: admin.username,
      targetType: 'VPNImportRecord',
      targetId: recordId,
      details: {
        importId: result.importId,
        vpnUsername: result.vpnUsername,
        matchStatus,
      },
      ipAddress: getIpAddress(request) || 'unknown',
      success: true,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    if (error instanceof Error && error.message === 'IMPORT_RECORD_NOT_FOUND') {
      return NextResponse.json({ error: 'Import record not found' }, { status: 404 });
    }

    if (error instanceof Error && error.message === 'IMPORT_RECORD_ALREADY_PROCESSED') {
      return NextResponse.json({ error: 'Import record has already been processed' }, { status: 409 });
    }

    console.error('VPN import match status update error:', error);
    return NextResponse.json({ error: 'Failed to update VPN import match status' }, { status: 500 });
  }
}
