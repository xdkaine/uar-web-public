import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable } from '@/lib/ratelimit';
import { appLogger } from '@/lib/logger';
import { updateUserAttribute, searchLDAPUser, formatRequestDescription } from '@/lib/ldap';
import { extractBronconame } from '@/lib/validation';
import { getSessionFromCookies } from '@/lib/session';

/**
 * GET /api/profile/verify-email/confirm?token=xxx
 * Confirm email verification for grandfathered account
 * Updates the access request, creates a record, and syncs email to AD
 */
export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting: 30 attempts per hour per IP to prevent token enumeration
    const clientIp = getRequiredClientIp(request);
    const rateLimitIpResult = await checkRateLimitAsync(clientIp, {
      maxRequests: 30,
      windowMs: 60 * 60 * 1000, // 1 hour
    });
    
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org';
    
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    // Add per-token rate limiting: 10 attempts per token per hour
    const rateLimitTokenResult = await checkRateLimitAsync('profile-email-verification-token', {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000, // 1 hour
      identifier: token || 'no-token',
    });
    
    if (!rateLimitIpResult.success || !rateLimitTokenResult.success) {
      return NextResponse.redirect(
        new URL('/profile?verification=error', origin)
      );
    }

    const verificationErrorUrl = new URL('/profile?verification=error', origin);

    const session = await getSessionFromCookies();
    if (!session) {
      const loginUrl = new URL('/login', origin);
      loginUrl.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    if (!token) {
      return NextResponse.redirect(verificationErrorUrl);
    }

    const accessRequest = await prisma.accessRequest.findUnique({
      where: {
        verificationToken: token,
      },
    });

    if (!accessRequest) {
      return NextResponse.redirect(verificationErrorUrl);
    }

    // Ensure the logged-in session matches the access request owner
    const normalizedSessionUser = session.username?.toLowerCase();
    const normalizedRequestUser = accessRequest.ldapUsername?.toLowerCase();

    if (!normalizedRequestUser || normalizedRequestUser !== normalizedSessionUser) {
      appLogger.warn('Email verification attempt with mismatched session user', {
        token,
        sessionUser: session.username,
        requestUser: accessRequest.ldapUsername,
      });
      return NextResponse.redirect(new URL('/profile?verification=unauthorized', origin));
    }

    // Check if too many verification attempts have been made
    if (accessRequest.verificationAttempts >= 5) {
      return NextResponse.redirect(verificationErrorUrl);
    }

    if (accessRequest.isVerified) {
      return NextResponse.redirect(new URL('/profile?verification=already_verified', origin));
    }

    // Check if this is a grandfathered account request
    if (!accessRequest.isGrandfatheredAccount) {
      return NextResponse.redirect(verificationErrorUrl);
    }

    const tokenAge = Date.now() - accessRequest.createdAt.getTime();
    const maxAge = 24 * 60 * 60 * 1000;

    if (tokenAge > maxAge) {
      // Increment attempt counter even for expired tokens
      await prisma.accessRequest.update({
        where: { id: accessRequest.id },
        data: { verificationAttempts: { increment: 1 } },
      }).catch(() => { /* ignore errors */ });
      return NextResponse.redirect(new URL('/profile?verification=expired', origin));
    }

    // Update email in Active Directory
    if (!accessRequest.ldapUsername) {
      appLogger.error('No LDAP username found for access request', {
        requestId: accessRequest.id,
        email: accessRequest.email,
      });
      return NextResponse.redirect(new URL('/profile?verification=error', origin));
    }

    try {
      appLogger.info('Updating AD email', {
        username: accessRequest.ldapUsername,
        email: accessRequest.email,
        requestId: accessRequest.id,
      });

      await updateUserAttribute(
        accessRequest.ldapUsername,
        'mail',
        accessRequest.email
      );

      appLogger.info('Successfully updated AD email', {
        username: accessRequest.ldapUsername,
        requestId: accessRequest.id,
      });

      // Also update description to include access request info
      const descriptionText = formatRequestDescription(accessRequest.id);
      
      appLogger.info('Updating AD description', {
        username: accessRequest.ldapUsername,
        requestId: accessRequest.id,
      });

      await updateUserAttribute(
        accessRequest.ldapUsername,
        'description',
        descriptionText
      );

      appLogger.info('Successfully updated AD description', {
        username: accessRequest.ldapUsername,
        requestId: accessRequest.id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      appLogger.error('Failed to update Active Directory', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        username: accessRequest.ldapUsername,
        email: accessRequest.email,
        requestId: accessRequest.id,
      });

      // AD update failed - redirect with error
      return NextResponse.redirect(new URL('/profile?verification=ad_error', origin));
    }

    // Successful verification - update access request status in a transaction
    // with rollback capability in case of any issues
    try {
      await prisma.$transaction(async (tx: any) => {
        // Update the access request
        await tx.accessRequest.update({
          where: {
            id: accessRequest.id,
          },
          data: {
            isVerified: true,
            verifiedAt: new Date(),
            verificationAttempts: { increment: 1 },
            status: 'approved', // They already have access, mark as approved
            approvedAt: new Date(),
            approvedBy: 'system_grandfathered',
          },
        });

        // Verify the update was successful by reading it back
        const verifiedRequest = await tx.accessRequest.findUnique({
          where: { id: accessRequest.id },
          select: { isVerified: true, status: true },
        });

        if (!verifiedRequest || !verifiedRequest.isVerified || verifiedRequest.status !== 'approved') {
          throw new Error('Verification update failed - record not properly updated');
        }

        // Create VPNAccount record for Limited Portal access
        // Check if VPN account already exists
        if (!accessRequest.ldapUsername) {
          throw new Error('No LDAP username found for access request');
        }

        // Extract VPN username from email (the part before @cpp.edu)
        const vpnUsername = extractBronconame(accessRequest.email) || accessRequest.ldapUsername;

        const existingVpnAccount = await tx.vPNAccount.findUnique({
          where: { username: vpnUsername },
        });

        if (!existingVpnAccount) {
          // Get user details from AD for display name
          const displayNameAttr = await searchLDAPUser(accessRequest.ldapUsername);
          const cnAttr = displayNameAttr?.attributes.find((attr: { type: string }) => attr.type === 'cn');
          const displayName = cnAttr?.values[0] || accessRequest.name;

          // Create VPN account for Limited portal
          const newVpnAccount = await tx.vPNAccount.create({
            data: {
              username: vpnUsername, // VPN username is the email prefix (emailname from emailname@cpp.edu)
              name: displayName,
              email: accessRequest.email,
              portalType: 'Limited',
              isInternal: true,
              status: 'active',
              password: '', // Empty - they use existing AD password
              createdBy: 'system_grandfathered',
              createdByFaculty: true, // Mark as faculty created to indicate no further approval needed
              facultyCreatedAt: new Date(),
              accessRequestId: accessRequest.id,
              adUsername: accessRequest.ldapUsername, // Link to AD account (different from VPN username for internal users)
            },
          });

          // Create initial status log
          await tx.vPNAccountStatusLog.create({
            data: {
              accountId: newVpnAccount.id,
              oldStatus: null,
              newStatus: 'active',
              changedBy: 'system_grandfathered',
              reason: 'Grandfathered account email verified via profile',
            },
          });

          appLogger.info('Created VPN account record for grandfathered account', {
            adUsername: accessRequest.ldapUsername,
            vpnUsername,
            email: accessRequest.email,
            requestId: accessRequest.id,
          });
        } else {
          appLogger.info('VPN account already exists for grandfathered account', {
            username: accessRequest.ldapUsername,
            email: accessRequest.email,
            requestId: accessRequest.id,
            existingAccountId: existingVpnAccount.id,
          });
        }

        appLogger.info('Email verification completed for grandfathered account', {
          username: accessRequest.ldapUsername,
          email: accessRequest.email,
          requestId: accessRequest.id,
        });
      });

      return NextResponse.redirect(new URL('/profile?verification=success', origin));
    } catch (transactionError) {
      // Transaction failed - attempt to rollback AD changes
      appLogger.error('Transaction failed during verification, attempting AD rollback', {
        error: transactionError instanceof Error ? transactionError.message : 'Unknown error',
        username: accessRequest.ldapUsername,
        requestId: accessRequest.id,
      });

      try {
        // Attempt to remove the email from AD to rollback
        await updateUserAttribute(
          accessRequest.ldapUsername,
          'mail',
          '' // Empty string to clear the attribute
        );

        // Also clear the description
        await updateUserAttribute(
          accessRequest.ldapUsername,
          'description',
          ''
        );

        appLogger.info('Successfully rolled back AD changes', {
          username: accessRequest.ldapUsername,
          requestId: accessRequest.id,
        });
      } catch (rollbackError) {
        appLogger.error('Failed to rollback AD changes', {
          error: rollbackError instanceof Error ? rollbackError.message : 'Unknown error',
          username: accessRequest.ldapUsername,
          requestId: accessRequest.id,
        });
      }

      // Return error to user
      return NextResponse.redirect(new URL('/profile?verification=error', origin));
    }
  } catch (error) {
    if (isRateLimitUnavailable(error)) {
      const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org';
      return NextResponse.redirect(new URL('/profile?verification=error', origin));
    }

    appLogger.error('Error confirming profile email verification', error);
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org';
    return NextResponse.redirect(new URL('/profile?verification=error', origin));
  }
}
