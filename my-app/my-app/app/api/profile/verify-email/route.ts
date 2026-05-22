import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable } from '@/lib/ratelimit';
import { parseJsonWithLimit, MAX_REQUEST_BODY_SIZE, validateStringLength, INPUT_LIMITS, extractBronconame, isJsonBodyError } from '@/lib/validation';
import { sendProfileEmailVerification } from '@/lib/email';
import { searchLDAPUser } from '@/lib/ldap';
import { appLogger } from '@/lib/logger';

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

    // Check if there's already a pending verification for this user
    const pendingRequest = await prisma.accessRequest.findFirst({
      where: {
        ldapUsername: session.username,
        isVerified: false,
        isGrandfatheredAccount: true,
      },
    });

    // Generate verification token
    const verificationToken = nanoid(32);

    const displayNameAttr = userInfo.attributes.find(attr => attr.type === 'cn');
    const displayName = displayNameAttr?.values[0] || session.username;

    if (pendingRequest) {
      // Update existing pending request
      await prisma.accessRequest.update({
        where: { id: pendingRequest.id },
        data: {
          email: normalizedEmail,
          verificationToken,
          verificationAttempts: 0,
          updatedAt: new Date(),
        },
      });

      appLogger.info('Updated pending email verification request', {
        username: session.username,
        requestId: pendingRequest.id,
      });
    } else {
      // Create new access request for grandfathered account
      // Extract VPN username from email (the part before @cpp.edu)
      const vpnUsername = extractBronconame(normalizedEmail) || session.username;
      
      await prisma.accessRequest.create({
        data: {
          name: displayName,
          email: normalizedEmail,
          isInternal: true, // Assuming they have VPN access means they're internal
          needsDomainAccount: false, // They already have an account
          ldapUsername: session.username,
          vpnUsername: vpnUsername, // VPN username is the email prefix (emailname from emailname@cpp.edu)
          isVerified: false,
          verificationToken,
          status: 'pending_verification',
          isGrandfatheredAccount: true,
          // Pre-fill approval info since they already have access
          accountCreatedAt: new Date(), // Mark as already created
        },
      });

      appLogger.info('Created email verification request for grandfathered account', {
        username: session.username,
        email: normalizedEmail,
        vpnUsername,
      });
    }

    // Send verification email
    await sendProfileEmailVerification(normalizedEmail, displayName, verificationToken);

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
