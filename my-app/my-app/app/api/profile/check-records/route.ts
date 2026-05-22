import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { appLogger } from '@/lib/logger';

interface CheckResult {
  hasAccessRequest: boolean;
  hasVpnAccount: boolean;
  needsVerification: boolean;
  hasEmail: boolean;
  accessRequestDetails?: {
    id: string;
    email: string;
    status: string;
    isVerified: boolean;
    createdAt: string;
  };
  vpnAccountDetails?: {
    id: string;
    username: string;
    email: string | null;
    status: string;
    createdAt: string;
  };
}

/**
 * GET /api/profile/check-records
 * Check if the logged-in user has any records in AccessRequest or VPNAccount tables
 * This determines if they need to verify their email or if records already exist
 */
export async function GET() {
  try {
    // Check if user is authenticated
    const session = await getSessionFromCookies();

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const username = session.username;

    // Check for AccessRequest records tied to their AD username
    const accessRequest = await prisma.accessRequest.findFirst({
      where: {
        OR: [
          { ldapUsername: username },
          { vpnUsername: username },
          { linkedAdUsername: username },
          { linkedVpnUsername: username },
        ],
      },
      orderBy: {
        createdAt: 'desc', // Get the most recent one
      },
      select: {
        id: true,
        email: true,
        status: true,
        isVerified: true,
        createdAt: true,
        ldapUsername: true,
        vpnUsername: true,
      },
    });

    // Check for VPNAccount records tied to their username
    const vpnAccount = await prisma.vPNAccount.findFirst({
      where: {
        username: username,
      },
      orderBy: {
        createdAt: 'desc', // Get the most recent one
      },
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        createdAt: true,
      },
    });

    // Determine if they need verification based on records found
    const hasAccessRequest = !!accessRequest;
    const hasVpnAccount = !!vpnAccount;

    // Check for email in either record type
    const accessRequestHasEmail = !!(accessRequest?.email && accessRequest.email.trim() !== '');
    const vpnAccountHasEmail = !!(vpnAccount?.email && vpnAccount.email.trim() !== '');
    const hasEmail = accessRequestHasEmail || vpnAccountHasEmail;

    // User needs verification if:
    // 1. They have no records at all (completely new), OR
    // 2. They have only an AccessRequest that is unverified, OR
    // 3. They have only an AccessRequest with no email (even if verified), OR
    // 4. They have only a VPN account with no email, OR
    // 5. They have both records but neither has an email AND the request is not approved
    const needsVerification =
      (!hasAccessRequest && !hasVpnAccount) || // No records at all
      (hasAccessRequest && !hasVpnAccount && (!accessRequest.isVerified || !accessRequestHasEmail)) || // Only AccessRequest, unverified or no email
      (!hasAccessRequest && hasVpnAccount && !vpnAccountHasEmail) || // Only VPN account with no email
      (hasAccessRequest && hasVpnAccount && !hasEmail && accessRequest.status !== 'approved'); // Both exist but neither has email (unless approved grandfathered account)

    const result: CheckResult = {
      hasAccessRequest,
      hasVpnAccount,
      needsVerification,
      hasEmail,
    };

    // Include details if records exist
    if (accessRequest) {
      result.accessRequestDetails = {
        id: accessRequest.id,
        email: accessRequest.email,
        status: accessRequest.status,
        isVerified: accessRequest.isVerified,
        createdAt: accessRequest.createdAt.toISOString(),
      };
    }

    if (vpnAccount) {
      result.vpnAccountDetails = {
        id: vpnAccount.id,
        username: vpnAccount.username,
        email: vpnAccount.email,
        status: vpnAccount.status,
        createdAt: vpnAccount.createdAt.toISOString(),
      };
    }

    appLogger.info('Profile records check completed', {
      username,
      hasAccessRequest,
      hasVpnAccount,
      needsVerification,
      hasEmail,
    });

    return NextResponse.json(result);
  } catch (error) {
    appLogger.error('Error checking profile records', error);
    return NextResponse.json(
      { error: 'Failed to check records' },
      { status: 500 }
    );
  }
}
