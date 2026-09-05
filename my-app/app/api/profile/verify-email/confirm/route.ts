import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable } from '@/lib/ratelimit';
import { appLogger } from '@/lib/logger';
import { formatRequestDescription, searchLDAPUser, updateUserAttributes } from '@/lib/ldap';
import { extractBronconame } from '@/lib/validation';
import { getSessionFromCookies } from '@/lib/session';
import {
  claimProfileEmailToken,
  completeProfileEmailVerification,
  hashProfileEmailToken,
  markProfileEmailDirectoryApplied,
  markProfileEmailReconciliationRequired,
  releaseProfileEmailClaim,
  type ClaimedProfileEmailToken,
} from '@/lib/profile-email-verification';

function attributeValue(
  user: { attributes: Array<{ type: string; values: string[] }> } | null,
  name: string
): string | null {
  const attribute = user?.attributes.find((entry) => entry.type.toLowerCase() === name.toLowerCase());
  const value = attribute?.values?.[0]?.trim();
  return value || null;
}

function redirect(origin: string, state: string): NextResponse {
  return NextResponse.redirect(new URL(`/profile?verification=${state}`, origin));
}

/**
 * Confirm a profile-email link for a signed-in grandfathered account. The
 * bearer is hashed at rest, claimed before LDAP, read back after LDAP, and
 * finalized forward; this route never clears directory attributes as rollback.
 */
export async function GET(request: NextRequest) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org';
  let activeClaim: ClaimedProfileEmailToken | null = null;
  let directoryWriteAttempted = false;
  let directoryStateConfirmed = false;

  try {
    const clientIp = getRequiredClientIp(request);
    const ipLimit = await checkRateLimitAsync(clientIp, {
      maxRequests: 30,
      windowMs: 60 * 60 * 1000,
    });

    const token = request.nextUrl.searchParams.get('token')?.trim() ?? '';
    const tokenIdentifier = token ? hashProfileEmailToken(token).slice(0, 24) : 'missing';
    const tokenLimit = await checkRateLimitAsync('profile-email-verification-token', {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
      identifier: tokenIdentifier,
    });
    if (!ipLimit.success || !tokenLimit.success || !token) return redirect(origin, 'error');

    const session = await getSessionFromCookies();
    if (!session) {
      const loginUrl = new URL('/login', origin);
      loginUrl.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    const claimed = await claimProfileEmailToken({
      rawToken: token,
      sessionUsername: session.username,
    });
    if (!claimed.ok) {
      const state = claimed.reason === 'expired'
        ? 'expired'
        : claimed.reason === 'already_verified'
          ? 'already_verified'
          : claimed.reason === 'unauthorized'
            ? 'unauthorized'
            : claimed.reason === 'reconciliation_required'
              ? 'reconciliation_required'
              : claimed.reason === 'in_progress'
                ? 'in_progress'
                : 'error';
      return redirect(origin, state);
    }
    activeClaim = claimed.claim;

    const accessRequest = activeClaim.accessRequest;
    const ldapUsername = accessRequest.ldapUsername;
    if (!ldapUsername) {
      await markProfileEmailReconciliationRequired({
        tokenId: activeClaim.tokenId,
        claimId: activeClaim.claimId,
        error: 'Access request no longer has a directory username',
      });
      return redirect(origin, 'reconciliation_required');
    }

    const desiredEmail = activeClaim.desiredEmail.toLowerCase();
    const desiredDescription = formatRequestDescription(accessRequest.id);
    let beforeUser = await searchLDAPUser(ldapUsername);
    if (!beforeUser) {
      await releaseProfileEmailClaim({
        tokenId: activeClaim.tokenId,
        claimId: activeClaim.claimId,
        error: 'Directory account was not found',
      });
      return redirect(origin, 'ad_error');
    }

    const observedMail = attributeValue(beforeUser, 'mail');
    const observedDescription = attributeValue(beforeUser, 'description');
    if (observedMail && observedMail.toLowerCase() !== desiredEmail) {
      await markProfileEmailReconciliationRequired({
        tokenId: activeClaim.tokenId,
        claimId: activeClaim.claimId,
        error: 'Directory mail contains a different non-empty value',
        observedMail,
        observedDescription,
      });
      return redirect(origin, 'conflict');
    }

    const changes: Record<string, string> = {};
    if (observedMail?.toLowerCase() !== desiredEmail) changes.mail = desiredEmail;
    // Preserve administrator-maintained descriptions. Email verification does
    // not own unrelated directory metadata.
    if (!observedDescription) changes.description = desiredDescription;

    if (Object.keys(changes).length > 0) {
      try {
        directoryWriteAttempted = true;
        await updateUserAttributes(ldapUsername, changes);
      } catch (directoryError) {
        // LDAP timeouts can be ambiguous. Read back before deciding whether a
        // retry is safe; never compensate by clearing attributes.
        try {
          const readback = await searchLDAPUser(ldapUsername);
          const readbackMail = attributeValue(readback, 'mail');
          if (readbackMail?.toLowerCase() !== desiredEmail) {
            await releaseProfileEmailClaim({
              tokenId: activeClaim.tokenId,
              claimId: activeClaim.claimId,
              error: directoryError instanceof Error ? directoryError.message : 'Directory update failed',
            });
            return redirect(origin, 'ad_error');
          }
          beforeUser = readback;
        } catch (readbackError) {
          await markProfileEmailReconciliationRequired({
            tokenId: activeClaim.tokenId,
            claimId: activeClaim.claimId,
            error: readbackError instanceof Error ? readbackError.message : 'Directory outcome is unknown',
            observedMail,
            observedDescription,
          });
          return redirect(origin, 'reconciliation_required');
        }
      }
    }

    const verifiedUser = await searchLDAPUser(ldapUsername);
    const verifiedMail = attributeValue(verifiedUser, 'mail');
    const verifiedDescription = attributeValue(verifiedUser, 'description');
    if (verifiedMail?.toLowerCase() !== desiredEmail) {
      await markProfileEmailReconciliationRequired({
        tokenId: activeClaim.tokenId,
        claimId: activeClaim.claimId,
        error: 'Directory readback did not confirm the requested mail value',
        observedMail: verifiedMail,
        observedDescription: verifiedDescription,
      });
      return redirect(origin, 'reconciliation_required');
    }
    directoryStateConfirmed = true;

    const directoryRecorded = await markProfileEmailDirectoryApplied({
      tokenId: activeClaim.tokenId,
      claimId: activeClaim.claimId,
      observedMail: verifiedMail,
      observedDescription: verifiedDescription,
    });
    if (!directoryRecorded) return redirect(origin, 'in_progress');

    const displayName = attributeValue(verifiedUser ?? beforeUser, 'cn') || accessRequest.name;
    const vpnUsername = extractBronconame(desiredEmail) || accessRequest.vpnUsername || ldapUsername;
    const completed = await completeProfileEmailVerification({
      tokenId: activeClaim.tokenId,
      claimId: activeClaim.claimId,
      accessRequestId: accessRequest.id,
      expectedRequestVersion: accessRequest.version,
      desiredEmail,
      vpnUsername,
      displayName,
      ldapUsername,
    });
    if (!completed) {
      await markProfileEmailReconciliationRequired({
        tokenId: activeClaim.tokenId,
        claimId: activeClaim.claimId,
        error: 'Access request changed after the directory update',
        observedMail: verifiedMail,
        observedDescription: verifiedDescription,
      });
      return redirect(origin, 'reconciliation_required');
    }

    appLogger.info('Profile email verification completed', {
      requestId: accessRequest.id,
      username: ldapUsername,
      tokenRecordId: activeClaim.tokenId,
    });
    return redirect(origin, 'success');
  } catch (error) {
    if (isRateLimitUnavailable(error)) return redirect(origin, 'error');
    appLogger.error('Error confirming profile email verification', {
      requestId: activeClaim?.accessRequest.id,
      tokenRecordId: activeClaim?.tokenId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    if (!activeClaim) return redirect(origin, 'error');
    if (directoryWriteAttempted || directoryStateConfirmed) {
      await markProfileEmailReconciliationRequired({
        tokenId: activeClaim.tokenId,
        claimId: activeClaim.claimId,
        error: error instanceof Error ? error.message : 'Directory or portal finalization outcome is unknown',
      }).catch(() => undefined);
      return redirect(origin, 'reconciliation_required');
    }
    await releaseProfileEmailClaim({
      tokenId: activeClaim.tokenId,
      claimId: activeClaim.claimId,
      error: error instanceof Error ? error.message : 'Directory lookup failed before any update',
    }).catch(() => undefined);
    return redirect(origin, 'ad_error');
  }
}
