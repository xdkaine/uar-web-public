import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable } from '@/lib/ratelimit';
import { parseJsonWithLimit, MAX_REQUEST_BODY_SIZE, validateStringLength, INPUT_LIMITS, extractBronconame, isJsonBodyError } from '@/lib/validation';
import { sendProfileEmailVerification } from '@/lib/email';
import { searchLDAPUser } from '@/lib/ldap';
import { appLogger } from '@/lib/logger';
import {
  activateDeliveredProfileEmailToken,
  createIssuingProfileEmailToken,
  markProfileEmailDeliveryFailed,
} from '@/lib/profile-email-verification';
import type { Prisma } from '@prisma/client';
import {
  acquireDirectoryOwnershipFence,
  directoryObjectIdentity,
  directoryObjectIdentityMatches,
} from '@/lib/directory-ownership-fence';

interface RequestBody {
  email?: string;
}

/**
 * POST /api/profile/verify-email
 * Request email verification for a logged-in user without an email
 * Sends a magic link to the provided email address
 */
export async function POST(request: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await getSessionFromCookies();
    
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Apply rate limiting: 10 requests per hour per user to prevent spam
    const clientIp = getRequiredClientIp(request);
    const rateLimitResult = await checkRateLimitAsync(clientIp, {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000, // 1 hour
      identifier: `profile-email-${session.username}`,
    });
    
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { 
          error: 'Too many verification requests. Please try again later.',
          retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000),
        },
        { 
          status: 429,
          headers: {
            'Retry-After': Math.ceil((rateLimitResult.reset - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    const body = await parseJsonWithLimit<RequestBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const rawEmail = body.email?.trim() ?? '';

    if (!rawEmail) {
      return NextResponse.json(
        { error: 'Email address is required' },
        { status: 400 }
      );
    }

    // Validate email length
    const emailValidation = validateStringLength(rawEmail, 'Email', INPUT_LIMITS.EMAIL);
    if (!emailValidation.valid) {
      return NextResponse.json({ error: emailValidation.error }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const normalizedEmail = rawEmail.toLowerCase();

    if (!normalizedEmail.endsWith('@cpp.edu')) {
      return NextResponse.json(
        { error: 'Only @cpp.edu email addresses are supported for verification' },
        { status: 400 }
      );
    }

    // Check if user already has an email in AD
    const userInfo = await searchLDAPUser(session.username);
    if (!userInfo) {
      return NextResponse.json(
        { error: 'User not found in directory' },
        { status: 404 }
      );
    }
    const verifiedDirectoryIdentity = directoryObjectIdentity(userInfo);
    if (!verifiedDirectoryIdentity) {
      return NextResponse.json(
        { error: 'Your directory account has no immutable identity evidence and cannot be linked safely.' },
        { status: 409 }
      );
    }

    const mailAttr = userInfo.attributes.find(attr => attr.type === 'mail');
    if (mailAttr && mailAttr.values && mailAttr.values.length > 0 && mailAttr.values[0]) {
      return NextResponse.json(
        { error: 'Your account already has an email address assigned' },
        { status: 400 }
      );
    }

    // Check if there are any existing verified records for this user
    const existingVerifiedRequest = await prisma.accessRequest.findFirst({
      where: {
        OR: [
          { ldapUsername: session.username },
          { vpnUsername: session.username },
          { linkedAdUsername: session.username },
          { linkedVpnUsername: session.username },
        ],
        isVerified: true,
      },
    });

    if (existingVerifiedRequest) {
      return NextResponse.json(
        { error: 'You already have a verified access request in our system. No further action is needed.' },
        { status: 400 }
      );
    }

    // Check if there are any VPN accounts for this user
    const existingVpnAccount = await prisma.vPNAccount.findFirst({
      where: {
        username: session.username,
      },
    });

    if (existingVpnAccount && existingVpnAccount.email) {
      return NextResponse.json(
        { error: 'You already have a VPN account with an email address in our system. No further action is needed.' },
        { status: 400 }
      );
    }

    // Check if email is already in use by another access request
    const existingRequest = await prisma.accessRequest.findFirst({
      where: {
        email: normalizedEmail,
        isVerified: true,
      },
    });

    if (existingRequest) {
      return NextResponse.json(
        { error: 'This email address is already registered with another account' },
        { status: 400 }
      );
    }

    // Check for blocked email
    const blockedEmail = await prisma.blockedEmail.findFirst({
      where: {
        email: normalizedEmail,
        isActive: true,
      },
    });

    if (blockedEmail) {
      appLogger.warn('Blocked email attempted for profile sync', {
        username: session.username,
        email: normalizedEmail,
        reason: blockedEmail.reason,
      });
      return NextResponse.json(
        { error: 'This email address cannot be used. Please contact support.' },
        { status: 400 }
      );
    }

    // Generate verification token
    const verificationToken = nanoid(32);

    const displayNameAttr = userInfo.attributes.find(attr => attr.type === 'cn');
    const displayName = displayNameAttr?.values[0] || session.username;

    const ownership = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await acquireDirectoryOwnershipFence(tx, session.username);
      const currentDirectoryUser = await searchLDAPUser(session.username);
      if (!directoryObjectIdentityMatches(verifiedDirectoryIdentity, currentDirectoryUser)) {
        throw new Error('Directory identity changed while profile ownership was being reserved');
      }
      const pendingRequest = await tx.accessRequest.findFirst({
        where: {
          ldapUsername: session.username,
          isVerified: false,
          isGrandfatheredAccount: true,
        },
      });
      if (pendingRequest) return { request: pendingRequest, created: false };

      const vpnUsername = extractBronconame(normalizedEmail) || session.username;
      const createdRequest = await tx.accessRequest.create({
        data: {
          name: displayName,
          email: normalizedEmail,
          isInternal: true,
          needsDomainAccount: false,
          ldapUsername: session.username,
          vpnUsername,
          isVerified: false,
          verificationToken: null,
          verificationTokenExpiresAt: null,
          status: 'pending_verification',
          isGrandfatheredAccount: true,
          accountCreatedAt: new Date(),
        },
      });
      return { request: createdRequest, created: true };
    });
    const pendingRequest = ownership.created ? null : ownership.request;
    const accessRequestId = ownership.request.id;
    const expectedRequestVersion = ownership.request.version;
    const createdNewRequest = ownership.created;
    if (createdNewRequest) {
      appLogger.info('Created email verification request for grandfathered account', {
        username: session.username,
        email: normalizedEmail,
        vpnUsername: extractBronconame(normalizedEmail) || session.username,
      });
    }

    if (pendingRequest) {
      const activeConfirmation = await prisma.profileEmailVerificationToken.findFirst({
        where: {
          accessRequestId: pendingRequest.id,
          OR: [
            { status: { in: ['directory_applied', 'reconciliation_required'] } },
            { status: 'claimed', claimedUntil: { gt: new Date() } },
          ],
        },
        select: { status: true },
      });
      if (activeConfirmation) {
        return NextResponse.json(
          {
            error: activeConfirmation.status === 'reconciliation_required'
              ? 'This verification needs support reconciliation before another link can be issued.'
              : 'A verification is already being finalized. Wait a moment and try the existing link again.',
          },
          { status: 409 }
        );
      }
    }

    const issuedToken = await createIssuingProfileEmailToken({
      accessRequestId,
      rawToken: verificationToken,
      desiredEmail: normalizedEmail,
    });

    try {
      await sendProfileEmailVerification(normalizedEmail, displayName, verificationToken);
    } catch (error) {
      await markProfileEmailDeliveryFailed(
        issuedToken.id,
        error instanceof Error ? error.message : 'Verification email delivery failed'
      ).catch(() => undefined);
      if (createdNewRequest) {
        await prisma.accessRequest.updateMany({
          where: { id: accessRequestId, isVerified: false },
          data: {
            status: 'verification_email_failed',
            provisioningState: 'verification_email_failed',
            provisioningError: 'Profile verification email delivery failed',
          },
        }).catch(() => undefined);
      }
      throw error;
    }

    try {
      await activateDeliveredProfileEmailToken({
        tokenId: issuedToken.id,
        accessRequestId,
        desiredEmail: normalizedEmail,
        expectedRequestVersion,
      });
    } catch (error) {
      await markProfileEmailDeliveryFailed(
        issuedToken.id,
        error instanceof Error ? error.message : 'Verification token activation failed'
      ).catch(() => undefined);
      appLogger.error('Profile verification email delivered but activation state failed', {
        requestId: accessRequestId,
        tokenRecordId: issuedToken.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return NextResponse.json(
        {
          message: 'Verification email was delivered, but the link is not active yet. Request a new link before using it.',
        },
        { status: 202 }
      );
    }

    return NextResponse.json({
      message: 'Verification email sent. Please check your inbox and click the verification link.',
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: 'This service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    appLogger.error('Error requesting profile email verification', error);
    return NextResponse.json(
      { error: 'Failed to send verification email' },
      { status: 500 }
    );
  }
}
