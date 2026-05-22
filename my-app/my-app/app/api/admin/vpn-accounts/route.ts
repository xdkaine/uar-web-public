import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { encryptPassword } from '@/lib/encryption';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

// Pagination limits to prevent DoS with large datasets
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

function sanitizeAccount<T extends { password?: string | null }>(
  account: T
): Omit<T, 'password'> {
  const { password: _password, ...rest } = account;
  return rest;
}

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const portalType = searchParams.get('portalType');
    const status = searchParams.get('status');
    
    // Parse pagination parameters
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const requestedLimit = parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_SIZE), 10);
    const limit = Math.min(Math.max(1, requestedLimit), MAX_PAGE_SIZE);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    
    if (portalType && portalType !== 'all') {
      where.portalType = portalType;
    }
    
    if (status && status !== 'all') {
      where.status = status;
    }

    // Get total count for pagination metadata
    const total = await prisma.vPNAccount.count({ where });

    const accounts = await prisma.vPNAccount.findMany({
      where,
      orderBy: [
        { createdAt: 'desc' }
      ],
      skip,
      take: limit,
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.VIEW_VPN_ACCOUNTS_LIST,
      category: AuditCategories.VPN,
      username: admin.username,
      details: {
        totalAccounts: total,
        returnedCount: accounts.length,
        portalTypeFilter: portalType || 'all',
        statusFilter: status || 'all',
        page,
        limit,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      accounts: accounts.map(sanitizeAccount),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching VPN accounts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch VPN accounts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return (
        response ||
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      );
    }

    const body = await request.json();
    const {
      username,
      name,
      email,
      portalType,
      password,
      expiresAt,
      notes,
      createdBy,
    } = body;

    // Validation
    if (!username || !name || !email || !portalType || !password) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const existing = await prisma.vPNAccount.findUnique({
      where: { username },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Username already exists' },
        { status: 400 }
      );
    }

    const isInternal = portalType === 'Management' || portalType === 'Limited';

    const encryptedPassword = encryptPassword(password);

    const account = await prisma.vPNAccount.create({
      data: {
        username,
        name,
        email,
        portalType,
        isInternal,
        status: 'pending_faculty',
        password: encryptedPassword,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        notes,
        createdBy,
        createdByFaculty: false,
      },
    });

    // Create initial status log
    await prisma.vPNAccountStatusLog.create({
      data: {
        accountId: account.id,
        oldStatus: null,
        newStatus: 'pending_faculty',
        changedBy: createdBy,
        reason: 'Account created',
      },
    });

    // Send email notifications
    try {
      const { sendVPNPendingFacultyNotification, sendStudentDirectorNotification } = await import('@/lib/email');
      const { getEmailConfig } = await import('@/lib/email-config');
      
      // Get faculty email from database or environment
      const emailConfig = await getEmailConfig();
      const facultyEmail = emailConfig.facultyEmail;
      
      if (facultyEmail) {
        await sendVPNPendingFacultyNotification(
          facultyEmail,
          username,
          name,
          email,
          portalType,
          createdBy
        );
      }

      // Notify student directors
      await sendStudentDirectorNotification(
        'New VPN Account Pending Faculty Approval',
        `A new VPN account has been created and is awaiting faculty approval.`,
        {
          'Username': username,
          'Name': name,
          'Email': email,
          'Portal Type': portalType,
          'Created By': createdBy,
        }
      );
    } catch (emailError) {
      console.error('Failed to send email notifications:', emailError);
      // Don't fail the request if email fails
    }

    // Log audit action
    await logAuditAction({
      action: AuditActions.CREATE_VPN_ACCOUNT,
      category: AuditCategories.VPN,
      username: admin.username,
      targetId: account.id,
      targetType: 'VPNAccount',
      details: {
        vpnUsername: username,
        name,
        email,
        portalType,
        isInternal,
        createdBy,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(sanitizeAccount(account), { status: 201 });
  } catch (error) {
    console.error('Error creating VPN account:', error);
    
    // Log failed creation attempt
    const { admin: adminRetry } = await checkAdminAuthWithRateLimit(request);
    if (adminRetry) {
      await logAuditAction({
        action: AuditActions.CREATE_VPN_ACCOUNT,
        category: AuditCategories.VPN,
        username: adminRetry.username,
        targetType: 'VPNAccount',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to create VPN account' },
      { status: 500 }
    );
  }
}
