import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { hashPassword } from '@/lib/auth/password-hash';
import { canonicalizeBreakGlassUsername } from '@/lib/auth/local-username';
import { validatePasswordStrength } from '@/lib/password';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories } from '@/lib/audit-log';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'break_glass.manage')) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    const accounts = await prisma.localAccount.findMany({
      select: {
        id: true,
        username: true,
        purpose: true,
        isActive: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        lastUsedAt: true,
        lastUsedIp: true,
      },
      orderBy: { username: 'asc' },
    });

    return NextResponse.json({ accounts });
  } catch (error) {
    console.error('Error listing local accounts:', error);
    return NextResponse.json({ error: 'Failed to list local accounts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'break_glass.manage')) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    let body: { username?: unknown; password?: unknown };
    try {
      body = await parseJsonWithLimit<{ username?: unknown; password?: unknown }>(
        request,
        MAX_REQUEST_BODY_SIZE.SMALL
      );
    } catch (parseError) {
      if (isJsonBodyError(parseError)) {
        return NextResponse.json({ error: parseError.message }, { status: parseError.statusCode });
      }
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const usernameInput = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    // Canonical identity: break-glass usernames are namespaced under the
    // reserved @local suffix (no AD collision is possible) and stored and
    // matched in lowercase end-to-end.
    const username = canonicalizeBreakGlassUsername(usernameInput);

    if (!username) {
      return NextResponse.json(
        { error: 'username must be of the form name@local (3-64 characters before @local: letters, digits, dot, dash, underscore)' },
        { status: 400 }
      );
    }

    if (!password) {
      return NextResponse.json({ error: 'password is required' }, { status: 400 });
    }

    const strength = validatePasswordStrength(password);
    if (!strength.isValid) {
      return NextResponse.json(
        { error: 'Password does not meet policy', issues: strength.issues },
        { status: 400 }
      );
    }

    const existing = await prisma.localAccount.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: 'A local account already exists for that username' }, { status: 409 });
    }

    const created = await prisma.localAccount.create({
      data: {
        username,
        passwordHash: await hashPassword(password),
        purpose: 'break_glass',
        isActive: true,
        createdBy: admin.username,
      },
    });

    await logAuditAction({
      action: 'create_local_account',
      category: AuditCategories.SETTINGS,
      username: admin.username,
      actorType: 'admin',
      eventKind: 'security',
      targetId: created.id,
      targetType: 'LocalAccount',
      details: { accountUsername: username, purpose: 'break_glass' },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(
      {
        account: {
          id: created.id,
          username: created.username,
          purpose: created.purpose,
          isActive: created.isActive,
          createdBy: created.createdBy,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          lastUsedAt: created.lastUsedAt,
          lastUsedIp: created.lastUsedIp,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'A local account already exists for that username' },
        { status: 409 }
      );
    }
    console.error('Error creating local account:', error);
    return NextResponse.json({ error: 'Failed to create local account' }, { status: 500 });
  }
}
