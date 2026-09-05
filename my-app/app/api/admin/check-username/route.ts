import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { searchLDAPUserForProvisioning } from '@/lib/ldap';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { checkRateLimitAsync, getClientIp } from '@/lib/ratelimit';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { findReusableOffboardedRequest } from '@/lib/offboard-reenrollment';
import { isJsonBodyError, parseAdminJson } from '@/lib/admin-json-parser';
import { actorHasPermission } from '@/lib/rbac/core';

type CheckUsernameBody = {
  username?: string;
  requestId?: string;
};

export async function POST(
  request: NextRequest
) {
  try {
    const { admin, response } = await checkReviewAccessWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'access_requests.provision')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseAdminJson<CheckUsernameBody>(request);
    const { username, requestId } = body;

    if (!username) {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 }
      );
    }

    // Add aggressive rate limiting for enumeration prevention: 20 requests per minute per username
    // Using username as identifier instead of just IP to allow checking both domain and VPN usernames
    const clientIp = getClientIp(request);
    const rateLimitResult = await checkRateLimitAsync(clientIp, {
      maxRequests: 20,
      windowMs: 60 * 1000, // 1 minute
      identifier: username.toLowerCase(), // Rate limit per username being checked
    });
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    // Add random delay to prevent timing attacks (100-300ms)
    await new Promise(resolve => 
      setTimeout(resolve, 100 + Math.random() * 200)
    );

    // Check if username exists in Active Directory (works for both LDAP and VPN accounts)
    // This checks the actual AD to see if the account already exists
    let available = true;
    let source = '';
    let existingRequestId = '';
    let reactivationRequestId = '';
    const currentRequest = requestId
      ? await prisma.accessRequest.findUnique({
          where: { id: requestId },
          select: { email: true },
        })
      : null;
    
    try {
      const ldapUser = await searchLDAPUserForProvisioning(username);
      
      if (ldapUser) {
        const reusableRequest = await findReusableOffboardedRequest({
          username,
          email: currentRequest?.email,
        });

        if (reusableRequest) {
          source = 'offboarded';
          reactivationRequestId = reusableRequest.id;
        } else {
          available = false;
          source = 'ldap';
        }
      }
    } catch (ldapError) {
      console.error('LDAP search error:', ldapError);
      return NextResponse.json(
        { error: 'Failed to verify directory username availability. Please try again.' },
        { status: 503 }
      );
    }

    // Check if username exists in database for active/pending requests
    // This checks both ldapUsername (domain account) and vpnUsername fields
    // to prevent conflicts across all account types
    // NOTE: We exclude reusable terminal requests so usernames can be reused after denial or campaign offboarding.
    if (available) {
      const whereClause: Prisma.AccessRequestWhereInput = {
        OR: [
          { ldapUsername: username },
          { vpnUsername: username }
        ],
        status: {
          notIn: ['rejected', 'offboarded']
        }
      };
      if (requestId) {
        whereClause.NOT = { id: requestId };
      }
      const existingRequest = await prisma.accessRequest.findFirst({
        where: whereClause,
      });

      if (existingRequest) {
        available = false;
        source = 'database';
        existingRequestId = existingRequest.id;
      }
    }

    // Log audit action
    await logAuditAction({
      action: AuditActions.CHECK_USERNAME,
      category: AuditCategories.USER,
      username: admin.username,
      details: {
        checkedUsername: username,
        available,
        source,
        existingRequestId: existingRequestId || undefined,
        reactivationRequestId: reactivationRequestId || undefined,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    if (available) {
      return NextResponse.json({ 
        available: true,
        message: source === 'offboarded'
          ? `Username "${username}" is available for reactivation from a campaign-offboarded account`
          : `Username "${username}" is available`,
        reactivationRequestId: reactivationRequestId || undefined,
        source: source || 'available',
      });
    } else {
      return NextResponse.json({ 
        available: false,
        message: source === 'ldap' 
          ? `Username "${username}" already exists in Active Directory`
          : `Username "${username}" is already in use in a pending request`,
        existingRequestId: existingRequestId || undefined,
        source
      });
    }
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Error checking username:', error);
    return NextResponse.json(
      { error: 'Failed to check username availability' },
      { status: 500 }
    );
  }
}
