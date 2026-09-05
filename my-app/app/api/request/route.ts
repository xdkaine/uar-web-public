import { after, NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/prisma';
import { sendVerificationEmail } from '@/lib/email';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { parseJsonWithLimit, MAX_REQUEST_BODY_SIZE, validateStringLength, INPUT_LIMITS, extractBronconame, validateEmail, isJsonBodyError } from '@/lib/validation';
import { searchLDAPUser } from '@/lib/ldap';
import { appLogger } from '@/lib/logger';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { findReusableOffboardedRequest, reusableOffboardedUsername } from '@/lib/offboard-reenrollment';
import { notifyActiveAdministrators } from '@/lib/notifications';
import { hashAccessRequestVerificationToken } from '@/lib/access-request-verification';
import {
  acquireDirectoryOwnershipFence,
  directoryObjectIdentity,
  directoryObjectIdentityMatches,
  type DirectoryObjectIdentity,
} from '@/lib/directory-ownership-fence';

interface RequestBody {
  name?: string;
  email?: string;
  isInternal?: boolean;
  needsDomainAccount?: boolean;
  institution?: string;
  eventReason?: string;
  eventId?: string;
  eventIds?: string[];
  turnstileToken?: string;
}

type AccessRequestCreateResult =
  | {
      duplicate: true;
      existingRequestId?: string;
      activeApprovedRequestId?: string;
    }
  | {
      duplicate: false;
      accessRequest: { id: string };
    };

const ACTIVE_REQUEST_STATUSES = [
  'pending_verification',
  'verification_email_failed',
  'verification_email_sending',
  'pending_student_directors',
  'pending_faculty',
] as const;

function rateLimitedResponse(rateLimitResult: {
  limit: number;
  remaining: number;
  reset: number;
}) {
  return NextResponse.json(
    {
      error: 'Too many access requests. Please try again later.',
      retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000),
    },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': rateLimitResult.limit.toString(),
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
        'Retry-After': Math.ceil((rateLimitResult.reset - Date.now()) / 1000).toString(),
      },
    }
  );
}

function successfulAccessRequestResponse() {
  return NextResponse.json(
    {
      message: 'Request submitted successfully. Please check your email for verification.',
    },
    { status: 201 }
  );
}

function isPrismaSerializationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2034'
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonWithLimit<RequestBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const { name, email, isInternal, institution, eventReason, eventId, eventIds, turnstileToken } = body;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedInstitution = typeof institution === 'string' ? institution.trim() : '';
    const normalizedEventReason = typeof eventReason === 'string' ? eventReason.trim() : '';
    const normalizedEventId = typeof eventId === 'string' ? eventId.trim() : '';
    const normalizedEventIds = Array.isArray(eventIds)
      ? Array.from(new Set(eventIds.filter((id): id is string => typeof id === 'string').map(id => id.trim()).filter(Boolean)))
      : [];

    // Check if registrations are disabled
    const settings = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (settings) {
      if (isInternal && settings.internalRegistrationDisabled) {
        return NextResponse.json(
          { error: 'Internal registrations are currently disabled. Please contact an administrator.' },
          { status: 503 }
        );
      }
      if (!isInternal && settings.externalRegistrationDisabled) {
        return NextResponse.json(
          { error: 'External registrations are currently disabled. Please contact an administrator.' },
          { status: 503 }
        );
      }
    }

    // Apply independent IP and email limits to prevent spam and flooding.
    const clientIp = getRequiredClientIp(request);
    const ipRateLimitResult = await checkRateLimitAsync(clientIp, RateLimitPresets.requestSubmission);

    if (!ipRateLimitResult.success) {
      return rateLimitedResponse(ipRateLimitResult);
    }

    if (!turnstileToken) {
      return NextResponse.json(
        { error: 'Turnstile token is missing' },
        { status: 400 }
      );
    }

    const isTurnstileValid = await verifyTurnstileToken(turnstileToken);
    if (!isTurnstileValid) {
      return NextResponse.json(
        { error: 'Invalid Turnstile token' },
        { status: 400 }
      );
    }

    if (!normalizedName || !normalizedEmail || typeof isInternal !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (
      (institution !== undefined && typeof institution !== 'string') ||
      (eventReason !== undefined && typeof eventReason !== 'string') ||
      (eventId !== undefined && typeof eventId !== 'string') ||
      (eventIds !== undefined && !Array.isArray(eventIds))
    ) {
      return NextResponse.json(
        { error: 'Invalid input provided. Please check your request and try again.' },
        { status: 400 }
      );
    }

    // Validate string lengths
    const nameValidation = validateStringLength(normalizedName, 'Name', INPUT_LIMITS.NAME);
    if (!nameValidation.valid) {
      return NextResponse.json({ error: nameValidation.error }, { status: 400 });
    }

    const emailValidation = validateStringLength(normalizedEmail, 'Email', INPUT_LIMITS.EMAIL);
    if (!emailValidation.valid) {
      return NextResponse.json({ error: emailValidation.error }, { status: 400 });
    }

    if (!validateEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    if (normalizedInstitution) {
      const institutionValidation = validateStringLength(normalizedInstitution, 'Institution', INPUT_LIMITS.INSTITUTION);
      if (!institutionValidation.valid) {
        return NextResponse.json({ error: institutionValidation.error }, { status: 400 });
      }
    }

    if (normalizedEventReason) {
      const reasonValidation = validateStringLength(normalizedEventReason, 'Event Reason', INPUT_LIMITS.EVENT_REASON);
      if (!reasonValidation.valid) {
        return NextResponse.json({ error: reasonValidation.error }, { status: 400 });
      }
    }

    if (isInternal && !normalizedEmail.endsWith('@cpp.edu')) {
      return NextResponse.json(
        { error: 'Internal students must use @cpp.edu email' },
        { status: 400 }
      );
    }

    if (!isInternal) {
      if (!normalizedInstitution || (!normalizedEventReason && !normalizedEventId && normalizedEventIds.length === 0)) {
        return NextResponse.json(
          { error: 'External students must provide institution and event/reason' },
          { status: 400 }
        );
      }
      if (normalizedEmail.endsWith('@cpp.edu')) {
        return NextResponse.json(
          { error: 'CPP students should use the internal form' },
          { status: 400 }
        );
      }

      if (normalizedEventIds.length > 0) {
        const validEvents = await prisma.event.findMany({
          where: {
            id: { in: normalizedEventIds },
            isActive: true
          },
          select: { id: true, name: true }
        });

        if (validEvents.length !== normalizedEventIds.length) {
          const validIds = new Set(validEvents.map((event: { id: string }) => event.id));
          const invalidIds = normalizedEventIds.filter((id: string) => !validIds.has(id));
          return NextResponse.json(
            { error: `One or more selected events are invalid or inactive: ${invalidIds.join(', ')}` },
            { status: 400 }
          );
        }
      } else if (normalizedEventId) {

        const event = await prisma.event.findUnique({
          where: { id: normalizedEventId },
          select: { isActive: true, name: true }
        });

        if (!event) {
          return NextResponse.json(
            { error: 'Selected event not found' },
            { status: 400 }
          );
        }

        if (!event.isActive) {
          return NextResponse.json(
            { error: 'Selected event is no longer active' },
            { status: 400 }
          );
        }
      }
    }

    const emailRateLimitResult = await checkRateLimitAsync('access-request-email', {
      maxRequests: 2,
      windowMs: RateLimitPresets.requestSubmission.windowMs,
      identifier: normalizedEmail,
    });

    if (!emailRateLimitResult.success) {
      return rateLimitedResponse(emailRateLimitResult);
    }

    // Check if email is blocked
    const blockedEmail = await prisma.blockedEmail.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        isActive: true,
      },
    });

    if (blockedEmail) {
      return NextResponse.json(
        { error: 'This email address is not eligible to request access. Please contact support if you believe this is an error.' },
        { status: 403 }
      );
    }

    // Check for truly active requests only (exclude rejected and expired approved requests)
    // This allows users to re-request access after their previous request was rejected or expired
    const existingRequest = await prisma.accessRequest.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        status: {
          in: [...ACTIVE_REQUEST_STATUSES],
        },
      },
    });

    // Also check for approved requests that haven't expired yet
    const activeApprovedRequest = await prisma.accessRequest.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        status: 'approved',
        OR: [
          { accountExpiresAt: null }, // No expiration set
          { accountExpiresAt: { gt: new Date() } }, // Not yet expired
        ],
      },
    });

    if (existingRequest || activeApprovedRequest) {
      // SILENT SUCCESS: Return 201 Created to prevent user enumeration
      // We log this internally so admins can see the attempt but the user sees a success message
      appLogger.warn('Targeted user enumeration attempt or duplicate request silenced', {
        email: normalizedEmail,
        existingRequestId: existingRequest?.id,
        activeApprovedRequestId: activeApprovedRequest?.id,
        ip: clientIp,
      });

      return successfulAccessRequestResponse();
    }

    const verificationToken = nanoid(32);
    const verificationTokenHash = hashAccessRequestVerificationToken(verificationToken);
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Use the first eventId from eventIds array if provided, otherwise fall back to single eventId
    const primaryEventId = normalizedEventIds.length > 0 ? normalizedEventIds[0] : normalizedEventId;

    // For internal users, check if this is a grandfathered account
    // (existing AD account without email that needs to be linked)
    let isGrandfatheredAccount = false;
    let isOffboardedReenrollment = false;
    let offboardedReenrollmentRequestId: string | null = null;
    let detectedUsername: string | null = null;
    let bronconameForVpn: string | null = null;
    let detectedDirectoryIdentity: DirectoryObjectIdentity | null = null;

    if (isInternal) {
      // Extract bronconame from email (username before @cpp.edu)
      const bronconame = extractBronconame(normalizedEmail);

      if (bronconame) {
        bronconameForVpn = bronconame; // Store for VPN username

        try {
          // Check if this username already exists in Active Directory
          const existingAdUser = await searchLDAPUser(bronconame);

          if (existingAdUser) {
            detectedDirectoryIdentity = directoryObjectIdentity(existingAdUser);
            // Check if the AD account already has an email set
            const mailAttr = existingAdUser.attributes.find((attr: { type: string }) => attr.type === 'mail');
            const hasEmail = mailAttr && mailAttr.values && mailAttr.values.length > 0 && mailAttr.values[0];

            if (!hasEmail) {
              // This is a grandfathered account - exists in AD but has no email
              isGrandfatheredAccount = true;
              detectedUsername = bronconame;

              appLogger.info('Detected grandfathered account during internal request', {
                email: normalizedEmail,
                detectedUsername: bronconame,
                hasAdAccount: true,
                hasEmail: false,
              });
            } else {
              const reusableRequest = await findReusableOffboardedRequest({
                username: bronconame,
                email: normalizedEmail,
              });

              if (reusableRequest) {
                isOffboardedReenrollment = true;
                offboardedReenrollmentRequestId = reusableRequest.id;
                detectedUsername = reusableOffboardedUsername(reusableRequest, normalizedEmail) || bronconame;
                bronconameForVpn = reusableRequest.vpnUsername || reusableRequest.linkedVpnUsername || bronconame;

                appLogger.info('Detected campaign-offboarded account re-enrollment', {
                  email: normalizedEmail,
                  detectedUsername,
                  previousRequestId: reusableRequest.id,
                });
              } else {
                appLogger.warn('Internal request for email that matches existing AD account with email', {
                  email: normalizedEmail,
                  detectedUsername: bronconame,
                  existingEmail: mailAttr.values[0],
                });
              }
            }
          }
        } catch (ldapError) {
          // LDAP search failed - log but continue with normal flow
          appLogger.warn('LDAP search failed during grandfathered account detection', {
            email: normalizedEmail,
            bronconame,
            error: ldapError instanceof Error ? ldapError.message : 'Unknown error',
          });
        }
      }
    }

    let createResult: AccessRequestCreateResult | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        createResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          if (detectedUsername) {
            await acquireDirectoryOwnershipFence(tx, detectedUsername);
            const currentDirectoryUser = await searchLDAPUser(detectedUsername);
            if (
              !detectedDirectoryIdentity
              || !directoryObjectIdentityMatches(detectedDirectoryIdentity, currentDirectoryUser)
            ) {
              appLogger.warn('Existing directory identity changed while access request ownership was being reserved', {
                email: normalizedEmail,
                detectedUsername,
              });
              isGrandfatheredAccount = false;
              isOffboardedReenrollment = false;
              offboardedReenrollmentRequestId = null;
              detectedUsername = null;
              detectedDirectoryIdentity = null;
            }
          }

          const duplicatePendingRequest = await tx.accessRequest.findFirst({
            where: {
              email: { equals: normalizedEmail, mode: 'insensitive' },
              status: {
                in: [...ACTIVE_REQUEST_STATUSES],
              },
            },
            select: { id: true },
          });

          const duplicateApprovedRequest = await tx.accessRequest.findFirst({
            where: {
              email: { equals: normalizedEmail, mode: 'insensitive' },
              status: 'approved',
              OR: [
                { accountExpiresAt: null },
                { accountExpiresAt: { gt: new Date() } },
              ],
            },
            select: { id: true },
          });

          if (duplicatePendingRequest || duplicateApprovedRequest) {
            return {
              duplicate: true as const,
              existingRequestId: duplicatePendingRequest?.id,
              activeApprovedRequestId: duplicateApprovedRequest?.id,
            };
          }

          const createdRequest = await tx.accessRequest.create({
            data: {
              name: normalizedName,
              email: normalizedEmail,
              isInternal,
              needsDomainAccount: !(isGrandfatheredAccount || isOffboardedReenrollment), // Don't create a duplicate account if we can link/reactivate.
              institution: isInternal ? null : normalizedInstitution,
              eventReason: normalizedEventReason || null,
              eventId: primaryEventId || null,
              verificationToken: null,
              verificationTokenHash,
              verificationTokenExpiresAt,
              status: 'pending_verification',
              isGrandfatheredAccount, // Mark if this is a grandfathered account
              ldapUsername: detectedUsername, // Pre-fill the detected AD username
              vpnUsername: bronconameForVpn, // VPN username should be the email prefix (NAME part from NAME@cpp.edu)
              isManuallyAssigned: isOffboardedReenrollment,
              linkedAdUsername: isOffboardedReenrollment ? detectedUsername : null,
              linkedVpnUsername: isOffboardedReenrollment ? bronconameForVpn : null,
              manualAssignmentNotes: isOffboardedReenrollment
                ? `Detected re-enrollment from campaign-offboarded request ${offboardedReenrollmentRequestId}`
                : null,
            },
          });

          return {
            duplicate: false as const,
            accessRequest: createdRequest,
          };
        }, {
          isolationLevel: 'Serializable',
          timeout: 10000,
        });
        break;
      } catch (error) {
        if (attempt < 2 && isPrismaSerializationError(error)) {
          continue;
        }
        throw error;
      }
    }

    if (!createResult) {
      throw new Error('Failed to create access request');
    }

    if (createResult.duplicate) {
      appLogger.warn('Targeted user enumeration attempt or duplicate request silenced', {
        email: normalizedEmail,
        existingRequestId: createResult.existingRequestId,
        activeApprovedRequestId: createResult.activeApprovedRequestId,
        ip: clientIp,
      });

      return successfulAccessRequestResponse();
    }

    const accessRequest = createResult.accessRequest;

    notifyActiveAdministrators({
      dedupeKey: `access-request-created:${accessRequest.id}`,
      kind: 'access_request',
      title: 'New access request',
      message: `${normalizedName} submitted an access request.`,
      href: `/admin/requests/${accessRequest.id}`,
    }).catch((error) => {
      appLogger.error('Failed to create access-request in-app notifications', {
        requestId: accessRequest.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Add system comment if grandfathered account detected
    if (isGrandfatheredAccount && detectedUsername) {
      await prisma.requestComment.create({
        data: {
          requestId: accessRequest.id,
          comment: `🔍 Grandfathered Account Detected: Active Directory account "${detectedUsername}" already exists for this email but has no email address set. This request will link the email to the existing account instead of creating a new one.`,
          author: 'System',
          type: 'system',
        },
      });
    }

    if (isOffboardedReenrollment && detectedUsername) {
      await prisma.requestComment.create({
        data: {
          requestId: accessRequest.id,
          comment: `Campaign-offboarded account detected: "${detectedUsername}" exists for this email and can be reactivated after normal approval. This does not bypass the email block list.`,
          author: 'System',
          type: 'system',
        },
      });
    }

    // If multiple events were selected, add a comment noting all selected events
    if (normalizedEventIds.length > 0) {
      const selectedEvents = await prisma.event.findMany({
        where: { id: { in: normalizedEventIds } },
        select: { id: true, name: true, endDate: true }
      });

      const eventList = selectedEvents.map((e: { id: string; name: string; endDate: Date | null }) => {
        if (e.endDate) {
          const formattedDate = new Date(e.endDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });
          return `${e.name} (Expires: ${formattedDate})`;
        }
        return e.name;
      }).join(', ');

      await prisma.requestComment.create({
        data: {
          requestId: accessRequest.id,
          comment: `User selected event(s): ${eventList}`,
          author: 'System',
          type: 'system',
        },
      });
    }

    after(async () => {
      try {
        await sendVerificationEmail(normalizedEmail, normalizedName, verificationToken);
      } catch (emailError) {
        appLogger.error('Failed to send verification email after access request creation', {
          requestId: accessRequest.id,
          email: normalizedEmail,
          error: emailError instanceof Error ? emailError.message : 'Unknown error',
        });

        try {
          const stateResult = await prisma.accessRequest.updateMany({
            where: {
              id: accessRequest.id,
              status: 'pending_verification',
              isVerified: false,
              verificationTokenHash,
            },
            data: {
              status: 'verification_email_failed',
              provisioningState: 'verification_email_failed',
              provisioningError: 'Verification email delivery failed',
            },
          });
          if (stateResult.count !== 1) {
            appLogger.error('Verification email failure state was not claimed', {
              requestId: accessRequest.id,
            });
          }
        } catch (stateError) {
          appLogger.error('Failed to record verification email delivery failure', {
            requestId: accessRequest.id,
            email: normalizedEmail,
            error: stateError instanceof Error ? stateError.message : 'Unknown error',
          });
        }
      }
    });

    return successfulAccessRequestResponse();
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

    console.error('Error creating access request:', error);
    return NextResponse.json(
      { error: 'Failed to process request. Please try again.' },
      { status: 500 }
    );
  }
}
