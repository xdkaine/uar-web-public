import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { 
  searchLDAPUser, 
  setLDAPUserPassword, 
  setLDAPUserExpiration,
  renameLDAPUser 
} from '@/lib/ldap';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const body = await request.json();
    const { 
      oldLdapUsername: providedOldLdapUsername, 
      oldVpnUsername: providedOldVpnUsername,
      newLdapUsername,
      newVpnUsername,
      newPassword,
      newExpirationDate 
    } = body;

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (accessRequest.status !== 'pending_student_directors') {
      return NextResponse.json(
        { error: 'Request is not in the correct stage for account updates' },
        { status: 400 }
      );
    }

    const currentVersion = accessRequest.version;

    if (!accessRequest.accountCreatedAt) {
      return NextResponse.json(
        { error: 'Account has not been created yet. Use create-account endpoint instead.' },
        { status: 400 }
      );
    }

    if (!accessRequest.ldapUsername) {
      return NextResponse.json(
        { error: 'LDAP username must be set before updating account' },
        { status: 400 }
      );
    }

    if (!accessRequest.isInternal) {
      if (!accessRequest.vpnUsername) {
        return NextResponse.json(
          { error: 'VPN username required for external users' },
          { status: 400 }
        );
      }
      if (!accessRequest.accountExpiresAt) {
        return NextResponse.json(
          { error: 'Expiration date required for external users' },
          { status: 400 }
        );
      }
    }

    // The client passes the current AD usernames so we can rename the right directory entries after stale page edits.
    const oldLdapUsername = providedOldLdapUsername || accessRequest.ldapUsername!;
    const oldVpnUsername = providedOldVpnUsername || accessRequest.vpnUsername;

    if (!newLdapUsername || !newPassword) {
      return NextResponse.json(
        { error: 'New LDAP username and password are required' },
        { status: 400 }
      );
    }

    const existingUser = await searchLDAPUser(oldLdapUsername);
    if (!existingUser) {
      return NextResponse.json(
        { error: `LDAP account "${oldLdapUsername}" not found in Active Directory. The account may have been deleted.` },
        { status: 404 }
      );
    }

    const changesMade: string[] = [];

    try {
      if (oldLdapUsername !== newLdapUsername) {
        await renameLDAPUser(oldLdapUsername, newLdapUsername);
        changesMade.push(`AD username: ${oldLdapUsername} → ${newLdapUsername}`);
      }

      await setLDAPUserPassword(
        newLdapUsername,
        newPassword
      );
      changesMade.push('Password updated');

      if (!accessRequest.isInternal && newExpirationDate) {
        await setLDAPUserExpiration(
          newLdapUsername,
          new Date(newExpirationDate)
        );
        changesMade.push(`Account disable date: ${new Date(newExpirationDate).toLocaleString()}`);
      }

      if (!accessRequest.isInternal && newVpnUsername && newVpnUsername !== newLdapUsername) {
        if (oldVpnUsername && oldVpnUsername !== newVpnUsername) {
          const existingOldVpnUser = await searchLDAPUser(oldVpnUsername);
          if (existingOldVpnUser) {
            await renameLDAPUser(oldVpnUsername, newVpnUsername);
            changesMade.push(`VPN username: ${oldVpnUsername} → ${newVpnUsername}`);
          }
        }

        const existingVpnUser = await searchLDAPUser(newVpnUsername);
        if (existingVpnUser) {
          await setLDAPUserPassword(
            newVpnUsername,
            newPassword
          );

          if (newExpirationDate) {
            await setLDAPUserExpiration(
              newVpnUsername,
              new Date(newExpirationDate)
            );
          }
        }
      }

      // LDAP writes have already happened, so a stale version must surface as a conflict instead of being overwritten.
      const verifyResult = await prisma.accessRequest.updateMany({
        where: { 
          id: resolvedParams.id,
          status: 'pending_student_directors',
          version: currentVersion
        },
        data: {
          updatedAt: new Date(),
          version: { increment: 1 }
        },
      });

      if (verifyResult.count === 0) {
        const current = await prisma.accessRequest.findUnique({
          where: { id: resolvedParams.id },
          select: { status: true, version: true }
        });

        if (current?.status !== 'pending_student_directors') {
          console.warn(`Status changed during update for request ${resolvedParams.id}. Expected pending_student_directors but is now ${current?.status}`);
          return NextResponse.json({ 
            error: `Request status changed during update. Current status: ${current?.status}. The LDAP changes have been applied but not recorded in the database. Please verify the Active Directory state.` 
          }, { status: 409 });
        } else if (current?.version !== currentVersion) {
          console.warn(`Concurrent modification detected for request ${resolvedParams.id}. Expected version ${currentVersion} but is now ${current?.version}`);
          return NextResponse.json({ 
            error: `Another administrator modified this request during your update. The LDAP changes have been applied but not recorded in the database. Please refresh and verify the state.` 
          }, { status: 409 });
        } else {
          console.error(`Request ${resolvedParams.id} not found after LDAP update`);
          return NextResponse.json({ 
            error: `Request not found. The LDAP changes have been applied but the request record is missing.` 
          }, { status: 404 });
        }
      }

      await prisma.requestComment.create({
        data: {
          requestId: resolvedParams.id,
          comment: `LDAP account updated by ${admin.username}. Changes applied to Active Directory:\n${changesMade.join('\n')}`,
          author: admin.username,
          type: 'system',
        },
      });

      await logAuditAction({
        action: AuditActions.UPDATE_ACCOUNT,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        details: { 
          changes: changesMade,
          oldUsername: oldLdapUsername,
          newUsername: newLdapUsername
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json({ 
        success: true, 
        message: 'Account updated successfully in Active Directory',
      });
    } catch (ldapError) {
      console.error('LDAP account update error:', ldapError);

      await logAuditAction({
        action: AuditActions.UPDATE_ACCOUNT,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        success: false,
        errorMessage: ldapError instanceof Error ? ldapError.message : 'LDAP update failed',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

      const errorMessage = ldapError instanceof Error 
        ? ldapError.message 
        : 'Failed to update account in Active Directory';
      
      return NextResponse.json(
        { error: `Account update failed: ${errorMessage}` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error updating account:', error);

    const resolvedParams = await params;
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.UPDATE_ACCOUNT,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to update account' },
      { status: 500 }
    );
  }
}
