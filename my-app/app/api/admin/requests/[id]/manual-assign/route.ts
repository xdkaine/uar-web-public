import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { searchLDAPUser, updateUserAttributes, tagAccountWithAccessRequestId, formatRequestDescription } from '@/lib/ldap';
import { sendManualAssignmentLinkedEmail } from '@/lib/email';
import { extractBronconame } from '@/lib/validation';
import { appLogger } from '@/lib/logger';

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
    const { linkedAdUsername, linkedVpnUsername, notes, forceAssignment } = body;

    if (!linkedAdUsername || linkedAdUsername.trim() === '') {
      return NextResponse.json(
        { error: 'Active Directory username is required' },
        { status: 400 }
      );
    }

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (!accessRequest.isVerified) {
      return NextResponse.json(
        { error: 'Cannot manually assign unverified request' },
        { status: 400 }
      );
    }

    if (accessRequest.status === 'approved') {
      return NextResponse.json(
        { error: 'Request has already been approved' },
        { status: 400 }
      );
    }

    if (accessRequest.status === 'rejected') {
      return NextResponse.json(
        { error: 'Cannot manually assign a rejected request' },
        { status: 400 }
      );
    }

    if (accessRequest.isManuallyAssigned) {
      return NextResponse.json(
        { 
          error: `Request was already manually assigned to "${accessRequest.linkedAdUsername}" by ${accessRequest.manuallyAssignedBy} on ${new Date(accessRequest.manuallyAssignedAt!).toLocaleString()}` 
        },
        { status: 400 }
      );
    }

    // This stays as a warning because manual assignment is the escape hatch for legacy account mismatches.
    if (accessRequest.isInternal && accessRequest.email && !forceAssignment) {
      const expectedUsername = extractBronconame(accessRequest.email);
      if (expectedUsername && expectedUsername !== linkedAdUsername.toLowerCase()) {
        appLogger.warn('Manual assignment username mismatch with email bronconame', {
          requestId: resolvedParams.id,
          email: accessRequest.email,
          expectedUsername,
          providedUsername: linkedAdUsername,
          assignedBy: admin.username,
        });
        
        return NextResponse.json(
          { 
            warning: true,
            error: `Username mismatch detected: Email "${accessRequest.email}" suggests username should be "${expectedUsername}", but you entered "${linkedAdUsername}". This may be intentional for existing accounts.`,
            suggestion: expectedUsername,
            providedUsername: linkedAdUsername,
            message: 'If this is correct (e.g., linking to a pre-existing account with different username), please confirm to proceed with force assignment.',
            requiresConfirmation: true,
          },
          { status: 409 }
        );
      }
    }

    let adDisplayName: string | null = null;
    try {
      const adUser = await searchLDAPUser(linkedAdUsername);
      if (!adUser) {
        return NextResponse.json(
          { error: `Active Directory account "${linkedAdUsername}" not found in LDAP` },
          { status: 404 }
        );
      }
      const displayNameAttr = adUser.attributes.find(attr => attr.type === 'cn' || attr.type === 'displayName');
      adDisplayName = displayNameAttr?.values[0] || null;
    } catch (ldapError) {
      console.error('LDAP search error:', ldapError);
      return NextResponse.json(
        { error: 'Failed to verify Active Directory account. Please check the username and try again.' },
        { status: 500 }
      );
    }

    if (!accessRequest.isInternal && linkedVpnUsername && linkedVpnUsername.trim() !== '') {
      try {
        const vpnUser = await searchLDAPUser(linkedVpnUsername);
        if (!vpnUser) {
          return NextResponse.json(
            { error: `VPN account "${linkedVpnUsername}" not found in LDAP` },
            { status: 404 }
          );
        }
      } catch (ldapError) {
        console.error('LDAP search error for VPN:', ldapError);
        return NextResponse.json(
          { error: 'Failed to verify VPN account. Please check the username and try again.' },
          { status: 500 }
        );
      }
    }

    // Rejected and campaign-offboarded requests do not reserve usernames.
    const existingRequestWithUsername = await prisma.accessRequest.findFirst({
      where: {
        ldapUsername: linkedAdUsername.trim(),
        id: { not: resolvedParams.id },
        status: { notIn: ['rejected', 'offboarded'] },
      },
      select: { id: true, name: true, email: true, status: true },
    });

    if (existingRequestWithUsername) {
      return NextResponse.json(
        { 
          error: `Active Directory username "${linkedAdUsername}" is already assigned to another request (${existingRequestWithUsername.name} - ${existingRequestWithUsername.email}, status: ${existingRequestWithUsername.status})` 
        },
        { status: 409 }
      );
    }

    if (!accessRequest.isInternal) {
      const vpnUsernameToCheck = linkedVpnUsername?.trim() || linkedAdUsername.trim();
      const existingRequestWithVpnUsername = await prisma.accessRequest.findFirst({
        where: {
          vpnUsername: vpnUsernameToCheck,
          id: { not: resolvedParams.id },
          status: { notIn: ['rejected', 'offboarded'] },
        },
        select: { id: true, name: true, email: true, status: true },
      });

      if (existingRequestWithVpnUsername) {
        return NextResponse.json(
          { 
            error: `VPN username "${vpnUsernameToCheck}" is already assigned to another request (${existingRequestWithVpnUsername.name} - ${existingRequestWithVpnUsername.email}, status: ${existingRequestWithVpnUsername.status})` 
          },
          { status: 409 }
        );
      }
    }

    let updatedRequest;
    
    try {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        console.log(`[Manual Assignment] Starting transaction for request ${resolvedParams.id}`);
        
        const updateData: Prisma.AccessRequestUpdateManyMutationInput = {
          isManuallyAssigned: true,
          manuallyAssignedAt: new Date(),
          manuallyAssignedBy: admin.username,
          linkedAdUsername: linkedAdUsername.trim(),
          manualAssignmentNotes: notes?.trim() || null,
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: admin.username,
          accountCreatedAt: new Date(),
          ldapUsername: linkedAdUsername.trim(),
          version: { increment: 1 },
        };

        if (!accessRequest.isInternal) {
          updateData.linkedVpnUsername = linkedVpnUsername?.trim() || linkedAdUsername.trim();
          updateData.vpnUsername = linkedVpnUsername?.trim() || linkedAdUsername.trim();
        }

        // The write must fail if another admin changed the request after this page loaded.
        console.log(`[Manual Assignment] Updating AccessRequest with optimistic locking (version: ${accessRequest.version})`);
        const updatedRequestResult = await tx.accessRequest.updateMany({
          where: { 
            id: resolvedParams.id,
            version: accessRequest.version,
            status: { in: ['pending_verification', 'pending_student_directors', 'pending_faculty'] },
          },
          data: updateData,
        });

        if (updatedRequestResult.count === 0) {
          const currentRequest = await tx.accessRequest.findUnique({
            where: { id: resolvedParams.id },
            select: { status: true, version: true, isManuallyAssigned: true, manuallyAssignedBy: true },
          });
          
          console.error(`[Manual Assignment] ROLLBACK - Update failed. Current state:`, currentRequest);
          
          if (currentRequest?.isManuallyAssigned) {
            throw new Error(`Request was already manually assigned by ${currentRequest.manuallyAssignedBy}. Transaction rolled back.`);
          }
          
          if (currentRequest?.version !== accessRequest.version) {
            throw new Error(`Request was modified by another administrator (version mismatch). Transaction rolled back.`);
          }
          
          throw new Error(`Request status has changed to "${currentRequest?.status}". Please refresh and try again. Transaction rolled back.`);
        }

        console.log(`[Manual Assignment] AccessRequest updated successfully`);

        const finalRequest = await tx.accessRequest.findUnique({
          where: { id: resolvedParams.id },
        });

        if (!finalRequest) {
          console.error(`[Manual Assignment] ROLLBACK - Could not fetch updated request`);
          throw new Error('Failed to fetch updated request. Transaction rolled back.');
        }

        console.log(`[Manual Assignment] Creating comment for audit trail`);
        let commentText = `Request manually assigned to existing Active Directory account: ${linkedAdUsername}`;
        if (accessRequest.isInternal) {
          const vpnUsername = extractBronconame(accessRequest.email) || linkedAdUsername.trim();
          commentText += `\nVPN account created/updated: ${vpnUsername} (Internal - Limited Portal)`;
          commentText += `\nLinked AD account: ${linkedAdUsername}`;
          const expectedUsername = extractBronconame(accessRequest.email);
          if (expectedUsername && expectedUsername !== linkedAdUsername.toLowerCase()) {
            commentText += `\nNote: Request email (${accessRequest.email}) bronconame differs from AD username (${linkedAdUsername})`;
            commentText += `\nThis is a manual assignment to an existing account.`;
          }
        } else if (linkedVpnUsername && linkedVpnUsername.trim() !== '') {
          commentText += `\nLinked VPN account: ${linkedVpnUsername}`;
        }
        if (notes && notes.trim()) {
          commentText += `\n\nNotes: ${notes.trim()}`;
        }
        commentText += `\n\nAssigned by: ${admin.username}`;

        await tx.requestComment.create({
          data: {
            requestId: resolvedParams.id,
            comment: commentText,
            author: admin.username,
            type: 'system',
          },
        });

        if (!accessRequest.isInternal) {
          const vpnAccountUsername = linkedVpnUsername?.trim() || linkedAdUsername.trim();
          
          console.log(`[Manual Assignment] Checking for VPN account: ${vpnAccountUsername}`);
          const vpnAccount = await tx.vPNAccount.findUnique({
            where: { username: vpnAccountUsername },
          });

          if (vpnAccount) {
            console.log(`[Manual Assignment] Updating VPN account status to active`);
            await tx.vPNAccount.update({
              where: { id: vpnAccount.id },
              data: {
                email: accessRequest.email,
                name: accessRequest.name,
                status: 'active',
                createdByFaculty: true,
                facultyCreatedAt: new Date(),
                adUsername: linkedAdUsername.trim(),
              },
            });

            await tx.vPNAccountStatusLog.create({
              data: {
                accountId: vpnAccount.id,
                oldStatus: vpnAccount.status,
                newStatus: 'active',
                changedBy: admin.username,
                reason: 'Manually assigned to access request',
              },
            });
            console.log(`[Manual Assignment] VPN account updated successfully`);
          } else {
            console.log(`[Manual Assignment] No VPN account found for ${vpnAccountUsername}, skipping VPN update`);
          }
        }

        if (accessRequest.isInternal) {
          console.log(`[Manual Assignment] Creating VPN account record for internal user`);
          try {
            const vpnUsername = extractBronconame(accessRequest.email) || linkedAdUsername.trim();
            const vpnAccountName = adDisplayName || accessRequest.name;
            
            console.log(`[Manual Assignment] Using VPN username: ${vpnUsername} (from email: ${accessRequest.email})`);
            console.log(`[Manual Assignment] Using VPN name: ${vpnAccountName} (AD displayName)`);
            console.log(`[Manual Assignment] Linked AD account: ${linkedAdUsername}`);
            
            const existingVpnAccount = await tx.vPNAccount.findUnique({
              where: { username: vpnUsername },
            });

            if (existingVpnAccount) {
              console.log(`[Manual Assignment] VPN account already exists for ${vpnUsername}, updating status`);
              await tx.vPNAccount.update({
                where: { id: existingVpnAccount.id },
                data: {
                  email: accessRequest.email,
                  name: vpnAccountName,
                  status: 'active',
                  portalType: 'Limited',
                  isInternal: true,
                  createdByFaculty: true,
                  facultyCreatedAt: new Date(),
                  adUsername: linkedAdUsername.trim(),
                },
              });

              await tx.vPNAccountStatusLog.create({
                data: {
                  accountId: existingVpnAccount.id,
                  oldStatus: existingVpnAccount.status,
                  newStatus: 'active',
                  changedBy: admin.username,
                  reason: 'Manually assigned to access request',
                },
              });
            } else {
              console.log(`[Manual Assignment] Creating new VPN account for ${vpnUsername}`);
              
              const newVpnAccount = await tx.vPNAccount.create({
                data: {
                  username: vpnUsername,
                  name: vpnAccountName,
                  email: accessRequest.email,
                  portalType: 'Limited',
                  isInternal: true,
                  status: 'active',
                  password: '',
                  createdBy: admin.username,
                  createdByFaculty: true,
                  facultyCreatedAt: new Date(),
                  adUsername: linkedAdUsername.trim(),
                },
              });

              await tx.vPNAccountStatusLog.create({
                data: {
                  accountId: newVpnAccount.id,
                  oldStatus: 'pending_faculty',
                  newStatus: 'active',
                  changedBy: admin.username,
                  reason: 'Created via manual assignment of access request',
                },
              });

              console.log(`[Manual Assignment] VPN account created successfully: ${newVpnAccount.id}`);
            }
          } catch (vpnCreateError) {
            console.error(`[Manual Assignment] Failed to create/update VPN account:`, vpnCreateError);
            throw new Error(`Failed to create VPN account: ${vpnCreateError instanceof Error ? vpnCreateError.message : 'Unknown error'}. Transaction rolled back.`);
          }
        }

        console.log(`[Manual Assignment] Transaction completed successfully - COMMIT`);
        return finalRequest;
      }, {
        maxWait: 5000,
        timeout: 30000,
        isolationLevel: 'Serializable',
      });

      updatedRequest = result;
      
    } catch (transactionError) {
      console.error('[Manual Assignment] Transaction ROLLED BACK due to error:', transactionError);

      await logAuditAction({
        action: AuditActions.MANUAL_ASSIGN_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        actorType: 'admin',
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        subjectUsername: linkedAdUsername.trim(),
        subjectEmail: accessRequest.email,
        relatedRequestId: resolvedParams.id,
        eventKind: 'write',
        outcome: 'rollback',
        details: {
          manuallyAssigned: true,
          failed: true,
          error: transactionError instanceof Error ? transactionError.message : 'Unknown error',
          linkedAdUsername: linkedAdUsername.trim(),
          linkedVpnUsername: linkedVpnUsername?.trim() || null,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
        success: false,
        errorMessage: transactionError instanceof Error ? transactionError.message : 'Unknown error',
      });

      throw transactionError;
    }

    console.log(`[Manual Assignment] Logging successful assignment to audit log`);
    await logAuditAction({
      action: AuditActions.MANUAL_ASSIGN_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      actorType: 'admin',
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      subjectUsername: linkedAdUsername.trim(),
      subjectEmail: updatedRequest.email,
      relatedRequestId: resolvedParams.id,
      eventKind: 'write',
      outcome: 'success',
      details: {
        requestName: updatedRequest.name,
        requestEmail: updatedRequest.email,
        linkedAdUsername: linkedAdUsername.trim(),
        linkedVpnUsername: linkedVpnUsername?.trim() || null,
        isInternal: accessRequest.isInternal,
        manuallyAssigned: true,
        notes: notes?.trim() || null,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
      success: true,
    });

    console.log(`[Manual Assignment] Request ${resolvedParams.id} successfully manually assigned to ${linkedAdUsername}`);

    const ldapWarnings: string[] = [];

    // LDAP updates happen after commit so directory failures do not roll back the request link.
    if (accessRequest.isInternal) {
      console.log(`[Manual Assignment] Updating AD account email and description for internal user`);
      try {
        await updateUserAttributes(linkedAdUsername.trim(), {
          mail: accessRequest.email,
          description: formatRequestDescription(resolvedParams.id),
        });
        
        console.log(`[Manual Assignment] AD account email and description updated successfully`);
      } catch (ldapUpdateError) {
        const errorMsg = `Failed to update AD account email/description: ${ldapUpdateError instanceof Error ? ldapUpdateError.message : 'Unknown error'}`;
        console.error(`[Manual Assignment] ${errorMsg}`);
        ldapWarnings.push(errorMsg);
        appLogger.warn('Manual assignment completed but AD email/description update failed', {
          requestId: resolvedParams.id,
          linkedAdUsername: linkedAdUsername.trim(),
          error: ldapUpdateError instanceof Error ? ldapUpdateError.message : 'Unknown error',
        });
      }

      console.log(`[Manual Assignment] Tagging AD account with Access Request ID`);
      try {
        await tagAccountWithAccessRequestId(linkedAdUsername.trim(), resolvedParams.id);
        console.log(`[Manual Assignment] AD account tagged successfully with Request ID: ${resolvedParams.id}`);
      } catch (tagError) {
        const errorMsg = `Failed to tag AD account with Request ID: ${tagError instanceof Error ? tagError.message : 'Unknown error'}`;
        console.error(`[Manual Assignment] ${errorMsg}`);
        ldapWarnings.push(errorMsg);
        appLogger.warn('Manual assignment completed but AD tagging failed', {
          requestId: resolvedParams.id,
          linkedAdUsername: linkedAdUsername.trim(),
          error: tagError instanceof Error ? tagError.message : 'Unknown error',
        });
      }
    }

    if (accessRequest.isInternal) {
      console.log('[Manual Assignment] Sending linkage confirmation email to internal requester');
      try {
        await sendManualAssignmentLinkedEmail({
          email: updatedRequest.email,
          name: updatedRequest.name,
          ldapUsername: linkedAdUsername.trim(),
          linkedBy: admin.username,
          notes: notes?.trim() || null,
          isGrandfathered: Boolean(accessRequest.isGrandfatheredAccount),
        });
        console.log('[Manual Assignment] Link confirmation email sent');
      } catch (emailError) {
        console.error('[Manual Assignment] Failed to send link confirmation email:', emailError);
      }
    }

    return NextResponse.json({
      message: 'Request successfully linked to existing account',
      request: updatedRequest,
      warnings: ldapWarnings.length > 0 ? ldapWarnings : undefined,
    });
  } catch (error) {
    console.error('[Manual Assignment] Fatal error:', error);
    
    let errorMessage = 'An unexpected error occurred';
    let statusCode = 500;
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      if (errorMessage.includes('already manually assigned')) {
        statusCode = 409;
      } else if (errorMessage.includes('modified by another administrator')) {
        statusCode = 409;
      } else if (errorMessage.includes('status has changed')) {
        statusCode = 409;
      } else if (errorMessage.includes('Transaction rolled back')) {
        statusCode = 409;
      }
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        rollback: true,
      },
      { status: statusCode }
    );
  }
}
