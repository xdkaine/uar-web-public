import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  searchLDAPUser,
  setLDAPUserPassword,
  setLDAPUserExpiration,
  renameLDAPUser,
} from '@/lib/ldap';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { actorCanActOnStage, actorHasPermission } from '@/lib/rbac/core';
import { findStageIndexByStatus, resolveWorkflowForRequest, workflowIntegrityConflict } from '@/lib/workflow/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { encryptPassword } from '@/lib/encryption';
import { validateUsername } from '@/lib/validation';
import { validatePasswordPolicy } from '@/lib/password-policy';

const ACCOUNT_UPDATE_LEASE_MS = 15 * 60 * 1000;

type UpdateAccountBody = {
  newLdapUsername?: string;
  newVpnUsername?: string | null;
  newPassword?: string;
  newExpirationDate?: string | null;
};

function normaliseUsername(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function directoryIdentity(
  user: { objectName: string; attributes: Array<{ type: string; values: string[] }> },
  expectedUsername: string
): { dn: string; objectGuid: string } {
  const attribute = (name: string) => user.attributes.find(
    (candidate) => candidate.type.toLowerCase() === name.toLowerCase()
  )?.values?.[0]?.trim() || '';
  if (attribute('sAMAccountName').toLowerCase() !== expectedUsername.toLowerCase()) {
    throw new Error(`Directory lookup for ${expectedUsername} resolved a different username`);
  }
  const objectGuid = attribute('objectGUID');
  if (!user.objectName || !objectGuid) {
    throw new Error(`Directory lookup for ${expectedUsername} did not return immutable identity evidence`);
  }
  return { dn: user.objectName, objectGuid };
}

function renamedDn(sourceDn: string, username: string): string {
  let escaped = false;
  for (let index = 0; index < sourceDn.length; index += 1) {
    const character = sourceDn[index];
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === ',') return `CN=${username.replace(/([,=+<>#;"\\])/g, '\\$1')}${sourceDn.slice(index)}`;
  }
  throw new Error('Verified LDAP DN has no parent component');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: requestId } = await params;
  const { admin, response } = await checkReviewAccessWithRateLimit(request);

  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'access_requests.provision')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json() as UpdateAccountBody;
    const newLdapUsername = normaliseUsername(body.newLdapUsername);
    const newVpnUsername = normaliseUsername(body.newVpnUsername);
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const newExpiration = body.newExpirationDate ? new Date(body.newExpirationDate) : null;

    if (!newLdapUsername || !newPassword) {
      return NextResponse.json(
        { error: 'A new directory username and password are required' },
        { status: 400 }
      );
    }
    if (!validateUsername(newLdapUsername) || (newVpnUsername && !validateUsername(newVpnUsername))) {
      return NextResponse.json(
        { error: 'Usernames must be 3-64 characters and contain only letters, numbers, dots, underscores, or hyphens' },
        { status: 400 }
      );
    }
    if (body.newExpirationDate && (!newExpiration || Number.isNaN(newExpiration.getTime()))) {
      return NextResponse.json({ error: 'Expiration date is invalid' }, { status: 400 });
    }

    const accessRequest = await prisma.accessRequest.findUnique({ where: { id: requestId } });
    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    const passwordValidation = validatePasswordPolicy(newPassword, {
      username: newLdapUsername,
      email: accessRequest.email,
      fullName: accessRequest.name,
    });
    const vpnPasswordValidation = newVpnUsername
      ? validatePasswordPolicy(newPassword, { username: newVpnUsername, email: accessRequest.email, fullName: accessRequest.name })
      : passwordValidation;
    if (!passwordValidation.isValid || !vpnPasswordValidation.isValid) {
      return NextResponse.json(
        { error: [...new Set([...passwordValidation.issues, ...vpnPasswordValidation.issues])].join('; ') },
        { status: 400 }
      );
    }
    if (accessRequest.status !== 'pending_student_directors') {
      return NextResponse.json(
        { error: 'Request is not in the correct stage for account updates' },
        { status: 400 }
      );
    }

    const workflow = await resolveWorkflowForRequest(accessRequest);
    const workflowConflict = workflowIntegrityConflict(workflow);
    if (workflowConflict) {
      return NextResponse.json({ error: workflowConflict, code: 'WORKFLOW_RECONCILIATION_REQUIRED' }, { status: 409 });
    }
    const stageIndex = findStageIndexByStatus(workflow.stages, accessRequest.status);
    const requiredRoleKey = stageIndex >= 0 ? workflow.stages[stageIndex].reviewerRoleKey : null;
    if (!requiredRoleKey || !actorCanActOnStage(admin, requiredRoleKey)) {
      return NextResponse.json(
        { error: 'You do not have the reviewer role required to update accounts at this stage.' },
        { status: 403 }
      );
    }

    if (!accessRequest.accountCreatedAt || !accessRequest.ldapUsername) {
      return NextResponse.json(
        { error: 'The authoritative directory account binding is incomplete; create or reconcile the account first.' },
        { status: 400 }
      );
    }

    if (accessRequest.accountUpdateState === 'reconciliation_required') {
      return NextResponse.json(
        { error: 'This account update requires operator reconciliation before another update can run.' },
        { status: 409 }
      );
    }
    if (accessRequest.accountUpdateState === 'in_progress') {
      const claimExpired = !accessRequest.accountUpdateClaimedUntil
        || accessRequest.accountUpdateClaimedUntil <= new Date();
      if (claimExpired) {
        await prisma.accessRequest.updateMany({
          where: {
            id: requestId,
            version: accessRequest.version,
            accountUpdateState: 'in_progress',
            accountUpdateClaimId: accessRequest.accountUpdateClaimId,
          },
          data: {
            accountUpdateState: 'reconciliation_required',
            accountUpdateError: 'Account update claim expired with an unknown directory outcome',
            accountUpdateClaimedUntil: null,
            version: { increment: 1 },
          },
        });
      }
      return NextResponse.json(
        { error: 'An account update is already in progress or requires reconciliation.' },
        { status: 409 }
      );
    }

    const oldLdapUsername = accessRequest.ldapUsername;
    const oldVpnUsername = accessRequest.vpnUsername;
    if (!accessRequest.isInternal) {
      if (!oldVpnUsername || !newVpnUsername || !newExpiration) {
        return NextResponse.json(
          { error: 'Authoritative VPN username, new VPN username, and expiration date are required for external users.' },
          { status: 400 }
        );
      }
      if ((oldVpnUsername === oldLdapUsername) !== (newVpnUsername === newLdapUsername)) {
        return NextResponse.json(
          { error: 'An account update cannot merge or split the authoritative LDAP and VPN identities.' },
          { status: 409 }
        );
      }
    }

    const assertUniquePortalOwner = async (username: string) => {
      const claims = await prisma.accessRequest.findMany({
        where: {
          OR: [
            { ldapUsername: { equals: username, mode: 'insensitive' } },
            { linkedAdUsername: { equals: username, mode: 'insensitive' } },
            { vpnUsername: { equals: username, mode: 'insensitive' } },
            { linkedVpnUsername: { equals: username, mode: 'insensitive' } },
          ],
          status: { notIn: ['rejected', 'offboarded'] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 2,
      });
      if (claims.length !== 1 || claims[0].id !== requestId) {
        throw new Error(`Portal ownership for directory username ${username} is ambiguous`);
      }
    };
    try {
      await assertUniquePortalOwner(oldLdapUsername);
      if (!accessRequest.isInternal && oldVpnUsername && oldVpnUsername !== oldLdapUsername) {
        await assertUniquePortalOwner(oldVpnUsername);
      }
    } catch {
      return NextResponse.json(
        { error: 'The portal does not have one unambiguous request owner for the source directory identity.' },
        { status: 409 }
      );
    }

    // Complete every read-only directory preflight before acquiring the claim.
    // A missing source or occupied destination must result in zero mutations.
    const authoritativeLdapUser = await searchLDAPUser(oldLdapUsername);
    if (!authoritativeLdapUser) {
      return NextResponse.json(
        { error: `Authoritative directory account "${oldLdapUsername}" was not found in Active Directory.` },
        { status: 404 }
      );
    }
    let authoritativeLdapIdentity: { dn: string; objectGuid: string };
    try {
      authoritativeLdapIdentity = directoryIdentity(authoritativeLdapUser, oldLdapUsername);
    } catch {
      return NextResponse.json(
        { error: 'The authoritative LDAP object does not have verifiable immutable identity evidence.' },
        { status: 409 }
      );
    }
    if (newLdapUsername !== oldLdapUsername && await searchLDAPUser(newLdapUsername)) {
      return NextResponse.json(
        { error: `LDAP destination "${newLdapUsername}" already exists.` },
        { status: 409 }
      );
    }

    let authoritativeVpnUser: Awaited<ReturnType<typeof searchLDAPUser>> = null;
    if (!accessRequest.isInternal && oldVpnUsername && oldVpnUsername !== oldLdapUsername) {
      authoritativeVpnUser = await searchLDAPUser(oldVpnUsername);
      if (!authoritativeVpnUser) {
        return NextResponse.json(
          { error: `Authoritative VPN account "${oldVpnUsername}" was not found.` },
          { status: 404 }
        );
      }
      try {
        directoryIdentity(authoritativeVpnUser, oldVpnUsername);
      } catch {
        return NextResponse.json(
          { error: 'The authoritative VPN object does not have verifiable immutable identity evidence.' },
          { status: 409 }
        );
      }
      if (newVpnUsername !== oldVpnUsername && await searchLDAPUser(newVpnUsername)) {
        return NextResponse.json(
          { error: `VPN destination "${newVpnUsername}" already exists.` },
          { status: 409 }
        );
      }
    }

    // Encryption is also completed before ownership is claimed so a local
    // configuration failure cannot strand an operation.
    const encryptedPassword = encryptPassword(newPassword);
    const claimId = randomUUID();
    const claimedUntil = new Date(Date.now() + ACCOUNT_UPDATE_LEASE_MS);
    const claim = await prisma.accessRequest.updateMany({
      where: {
        id: requestId,
        status: 'pending_student_directors',
        version: accessRequest.version,
        OR: [
          { accountUpdateState: null },
          { accountUpdateState: { in: ['failed', 'succeeded'] } },
        ],
      },
      data: {
        accountUpdateState: 'in_progress',
        accountUpdateClaimId: claimId,
        accountUpdateClaimedUntil: claimedUntil,
        accountUpdateTargetLdapUsername: newLdapUsername,
        accountUpdateTargetVpnUsername: accessRequest.isInternal ? null : newVpnUsername,
        accountUpdateOutcome: {
          phase: 'claimed',
          oldLdapUsername,
          oldVpnUsername,
          newLdapUsername,
          newVpnUsername: accessRequest.isInternal ? null : newVpnUsername,
          attemptedSteps: [],
        },
        accountUpdateError: null,
        version: { increment: 1 },
      },
    });
    if (claim.count !== 1) {
      return NextResponse.json(
        { error: 'Another operator changed or claimed this request. No directory changes were attempted.' },
        { status: 409 }
      );
    }

    const attemptedSteps: string[] = [];
    const completedSteps: string[] = [];
    try {
      const claimedLdapUser = await searchLDAPUser(oldLdapUsername);
      if (!claimedLdapUser) throw new Error('LDAP identity disappeared after the update claim');
      const claimedLdapIdentity = directoryIdentity(claimedLdapUser, oldLdapUsername);
      if (
        claimedLdapIdentity.dn.toLowerCase() !== authoritativeLdapIdentity.dn.toLowerCase()
        || claimedLdapIdentity.objectGuid !== authoritativeLdapIdentity.objectGuid
      ) {
        throw new Error('LDAP identity changed after the update claim');
      }

      let ldapDn = claimedLdapIdentity.dn;
      if (oldLdapUsername !== newLdapUsername) {
        attemptedSteps.push('rename_ldap');
        await renameLDAPUser(oldLdapUsername, newLdapUsername, ldapDn);
        ldapDn = renamedDn(ldapDn, newLdapUsername);
        completedSteps.push('rename_ldap');
      }

      attemptedSteps.push('set_ldap_password');
      await setLDAPUserPassword(newLdapUsername, newPassword, ldapDn);
      completedSteps.push('set_ldap_password');

      if (!accessRequest.isInternal && newExpiration) {
        attemptedSteps.push('set_ldap_expiration');
        await setLDAPUserExpiration(newLdapUsername, newExpiration, ldapDn);
        completedSteps.push('set_ldap_expiration');
      }

      if (!accessRequest.isInternal && oldVpnUsername && oldVpnUsername !== oldLdapUsername) {
        const claimedVpnUser = await searchLDAPUser(oldVpnUsername);
        if (!claimedVpnUser) throw new Error('VPN directory identity disappeared after the update claim');
        const expectedVpnIdentity = directoryIdentity(authoritativeVpnUser!, oldVpnUsername);
        const claimedVpnIdentity = directoryIdentity(claimedVpnUser, oldVpnUsername);
        if (
          claimedVpnIdentity.dn.toLowerCase() !== expectedVpnIdentity.dn.toLowerCase()
          || claimedVpnIdentity.objectGuid !== expectedVpnIdentity.objectGuid
        ) {
          throw new Error('VPN directory identity changed after the update claim');
        }
        let vpnDn = claimedVpnIdentity.dn;
        if (oldVpnUsername !== newVpnUsername) {
          attemptedSteps.push('rename_vpn');
          await renameLDAPUser(oldVpnUsername, newVpnUsername, vpnDn);
          vpnDn = renamedDn(vpnDn, newVpnUsername);
          completedSteps.push('rename_vpn');
        }

        attemptedSteps.push('set_vpn_password');
        await setLDAPUserPassword(newVpnUsername, newPassword, vpnDn);
        completedSteps.push('set_vpn_password');

        if (newExpiration) {
          attemptedSteps.push('set_vpn_expiration');
          await setLDAPUserExpiration(newVpnUsername, newExpiration, vpnDn);
          completedSteps.push('set_vpn_expiration');
        }
      }

      const finalized = await prisma.accessRequest.updateMany({
        where: {
          id: requestId,
          status: 'pending_student_directors',
          version: accessRequest.version + 1,
          accountUpdateState: 'in_progress',
          accountUpdateClaimId: claimId,
        },
        data: {
          ldapUsername: newLdapUsername,
          vpnUsername: accessRequest.isInternal ? accessRequest.vpnUsername : newVpnUsername,
          accountPassword: encryptedPassword,
          accountExpiresAt: accessRequest.isInternal ? accessRequest.accountExpiresAt : newExpiration,
          accountUpdateState: 'succeeded',
          accountUpdateClaimId: null,
          accountUpdateClaimedUntil: null,
          accountUpdateTargetLdapUsername: null,
          accountUpdateTargetVpnUsername: null,
          accountUpdateOutcome: {
            phase: 'completed',
            oldLdapUsername,
            oldVpnUsername,
            newLdapUsername,
            newVpnUsername: accessRequest.isInternal ? null : newVpnUsername,
            attemptedSteps,
            completedSteps,
          },
          accountUpdateError: null,
          version: { increment: 1 },
        },
      });
      if (finalized.count !== 1) {
        throw new Error('Database finalization lost ownership after directory changes');
      }
    } catch (operationError) {
      const errorMessage = operationError instanceof Error ? operationError.message : 'Account update failed';
      await prisma.accessRequest.updateMany({
        where: {
          id: requestId,
          accountUpdateState: 'in_progress',
          accountUpdateClaimId: claimId,
        },
        data: {
          accountUpdateState: 'reconciliation_required',
          accountUpdateClaimedUntil: null,
          accountUpdateOutcome: {
            phase: 'reconciliation_required',
            oldLdapUsername,
            oldVpnUsername,
            newLdapUsername,
            newVpnUsername: accessRequest.isInternal ? null : newVpnUsername,
            attemptedSteps,
            completedSteps,
          },
          accountUpdateError: errorMessage,
          version: { increment: 1 },
        },
      }).catch(() => undefined);

      await logAuditAction({
        action: AuditActions.UPDATE_ACCOUNT,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: requestId,
        targetType: 'AccessRequest',
        success: false,
        errorMessage,
        details: { outcome: 'reconciliation_required', attemptedSteps, completedSteps },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json(
        {
          error: 'The directory outcome may be partial. Automatic retry is blocked until an operator reconciles the account.',
          code: 'ACCOUNT_UPDATE_RECONCILIATION_REQUIRED',
        },
        { status: 202 }
      );
    }

    await prisma.requestComment.create({
      data: {
        requestId,
        comment: `Directory account update completed by ${admin.username}. Claim ${claimId} finalized with steps: ${completedSteps.join(', ')}.`,
        author: admin.username,
        type: 'system',
      },
    }).catch(() => undefined);

    await logAuditAction({
      action: AuditActions.UPDATE_ACCOUNT,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: requestId,
      targetType: 'AccessRequest',
      details: { outcome: 'succeeded', oldLdapUsername, newLdapUsername, completedSteps },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      success: true,
      message: 'Account and stored credentials updated successfully.',
    });
  } catch (error) {
    await logAuditAction({
      action: AuditActions.UPDATE_ACCOUNT,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: requestId,
      targetType: 'AccessRequest',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    }).catch(() => undefined);

    return NextResponse.json({ error: 'Failed to update account' }, { status: 500 });
  }
}
