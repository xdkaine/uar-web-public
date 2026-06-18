import { NextRequest, NextResponse } from 'next/server';
import { searchLDAPUserForProvisioning } from '@/lib/ldap';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { encryptPassword } from '@/lib/encryption';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { sendVPNPendingFacultyNotification, sendStudentDirectorNotification } from '@/lib/email';
import { getEmailConfig, getStudentDirectorEmails } from '@/lib/email-config';
import { extractBronconame } from '@/lib/validation';
import { findReusableOffboardedRequest } from '@/lib/offboard-reenrollment';

type ReusableOffboardedRequest = { id: string } | null;

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
    const { ldapUsername, vpnUsername, password, expirationDate } = body;

    // First, get the request to check if it's internal or external
    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Validate required fields based on account type
    if (!ldapUsername || !password) {
      return NextResponse.json(
        { error: 'LDAP username and password are required' },
        { status: 400 }
      );
    }

    // VPN username is only required for external users
    if (!accessRequest.isInternal && !vpnUsername) {
      return NextResponse.json(
        { error: 'VPN username is required for external users' },
        { status: 400 }
      );
    }

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (!accessRequest.isVerified) {
      return NextResponse.json(
        { error: 'Cannot acknowledge unverified request' },
        { status: 400 }
      );
    }

    // funny logic time
    // check AD if account isnt done yet
    // If accountcreated is set, we're interacting with an existing account
    let reusableAdRequest: ReusableOffboardedRequest = null;
    let reusableVpnRequest: ReusableOffboardedRequest = null;
    if (!accessRequest.accountCreatedAt) {
      // Check if LDAP username already exists in Active Directory
      try {
        const ldapUser = await searchLDAPUserForProvisioning(ldapUsername);
        
        if (ldapUser) {
          reusableAdRequest = await findReusableOffboardedRequest({
            username: ldapUsername,
            email: accessRequest.email,
          });

          if (!reusableAdRequest) {
            return NextResponse.json(
              { error: `LDAP username "${ldapUsername}" already exists in Active Directory` },
              { status: 400 }
            );
          }
        }
      } catch (ldapError) {
        console.error('LDAP search error during acknowledgment:', ldapError);
        return NextResponse.json(
          { error: 'Failed to verify LDAP username availability. Please try again.' },
          { status: 500 }
        );
      }

      // Check if username already exists in Active Directory (for external users)
      if (!accessRequest.isInternal && vpnUsername) {
        try {
          const vpnUser = await searchLDAPUserForProvisioning(vpnUsername);
          
          if (vpnUser) {
            reusableVpnRequest = await findReusableOffboardedRequest({
              username: vpnUsername,
              email: accessRequest.email,
            });

            if (!reusableVpnRequest) {
              return NextResponse.json(
                { error: `username "${vpnUsername}" already exists in Active Directory` },
                { status: 400 }
              );
            }
          }
        } catch (ldapError) {
          console.error('LDAP search error for username:', ldapError);
          return NextResponse.json(
            { error: 'Failed to verify username availability. Please try again.' },
            { status: 500 }
          );
        }
      }
    }

    // Check if LDAP username is already in use in database
    // NOTE: We exclude reusable terminal requests so usernames can be reused after denial or campaign offboarding.
    const usernameChecks: Array<{ ldapUsername?: string; vpnUsername?: string }> = [{ ldapUsername }];
    
    // Only check username for external users
    if (!accessRequest.isInternal && vpnUsername) {
      usernameChecks.push({ vpnUsername });
    }
    
    const existingUser = await prisma.accessRequest.findFirst({
      where: {
        OR: usernameChecks,
        id: { not: resolvedParams.id },
        status: { notIn: ['rejected', 'offboarded'] },
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'Username is already in use by another request' },
        { status: 400 }
      );
    }

    const updateData: {
      acknowledgedByDirector: boolean;
      acknowledgedAt: Date;
      acknowledgedBy: string;
      status: string;
      ldapUsername: string;
      accountPassword: string;
      expirationDate?: Date;
      vpnUsername?: string;
      accountExpiresAt?: Date;
      linkedAdUsername?: string;
      linkedVpnUsername?: string;
      isManuallyAssigned?: boolean;
      manuallyAssignedAt?: Date;
      manuallyAssignedBy?: string;
      manualAssignmentNotes?: string;
    } = {
      acknowledgedByDirector: true,
      acknowledgedAt: new Date(),
      acknowledgedBy: admin.username,
      status: 'pending_faculty',
      ldapUsername,
      accountPassword: encryptPassword(password),
    };

    const reusableRequest = reusableAdRequest || reusableVpnRequest;

    if (reusableRequest) {
      updateData.linkedAdUsername = ldapUsername;
      updateData.linkedVpnUsername = vpnUsername || ldapUsername;
      updateData.isManuallyAssigned = true;
      updateData.manuallyAssignedAt = new Date();
      updateData.manuallyAssignedBy = admin.username;
      updateData.manualAssignmentNotes = `Prepared for reactivation from campaign-offboarded request ${reusableRequest.id}`;
    }

    // Only set VPN username for external users
    if (!accessRequest.isInternal) {
      updateData.vpnUsername = vpnUsername;
    }

    // Add expiration date for external users
    if (!accessRequest.isInternal && expirationDate) {
      updateData.accountExpiresAt = new Date(expirationDate);
    }

    const result = await prisma.accessRequest.updateMany({
      where: { 
        id: resolvedParams.id,
        status: 'pending_student_directors'
      },
      data: updateData,
    });

    if (result.count === 0) {
      const current = await prisma.accessRequest.findUnique({
        where: { id: resolvedParams.id },
        select: { status: true }
      });
      
      return NextResponse.json({ 
        error: `Request status is ${current?.status}, expected pending_student_directors` 
      }, { status: 400 });
    }

    const updatedRequest = await prisma.accessRequest.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!updatedRequest) {
      return NextResponse.json({ error: 'Request not found after update' }, { status: 404 });
    }

    if (reusableRequest) {
      await prisma.requestComment.create({
        data: {
          requestId: resolvedParams.id,
          comment: `Prepared for reactivation from campaign-offboarded request ${reusableRequest.id}. The existing account remains disabled until faculty approval re-enables access.`,
          author: admin.username,
          type: 'system',
        },
      });
    }

    // Create or update VPN account entry for tracking in VPN Management tab
    // For internal users with @cpp.edu email, extract bronconame from email for VPN username
    let vpnAccountUsername: string;
    if (accessRequest.isInternal) {
      vpnAccountUsername = extractBronconame(accessRequest.email) || ldapUsername;
    } else {
      vpnAccountUsername = vpnUsername || ldapUsername;
    }
    const portalType = accessRequest.isInternal ? 'Limited' : 'External';
    
    try {
      // Check if VPN account already exists
      const existingVpnAccount = await prisma.vPNAccount.findUnique({
        where: { username: vpnAccountUsername },
      });

      let vpnAccount;
      const encryptedPassword = encryptPassword(password);

      if (existingVpnAccount) {
        // Update existing VPN account
        vpnAccount = await prisma.vPNAccount.update({
          where: { username: vpnAccountUsername },
          data: {
            name: accessRequest.name,
            email: accessRequest.email,
            portalType: portalType,
            isInternal: accessRequest.isInternal,
            status: 'pending_faculty',
            password: encryptedPassword,
            expiresAt: !accessRequest.isInternal && expirationDate ? new Date(expirationDate) : undefined,
            accessRequestId: resolvedParams.id,
            adUsername: ldapUsername, // Link to AD account
          },
        });

        // Create status log for the update
        await prisma.vPNAccountStatusLog.create({
          data: {
            accountId: vpnAccount.id,
            oldStatus: existingVpnAccount.status,
            newStatus: 'pending_faculty',
            changedBy: admin.username,
            reason: 'Updated from access request acknowledgment',
          },
        });
      } else {
        // Create new VPN account
        vpnAccount = await prisma.vPNAccount.create({
          data: {
            username: vpnAccountUsername,
            name: accessRequest.name,
            email: accessRequest.email,
            portalType: portalType,
            isInternal: accessRequest.isInternal,
            status: 'pending_faculty',
            password: encryptedPassword,
            expiresAt: !accessRequest.isInternal && expirationDate ? new Date(expirationDate) : undefined,
            createdBy: admin.username,
            createdByFaculty: false,
            accessRequestId: resolvedParams.id,
            adUsername: ldapUsername, // Link to AD account
          },
        });

        // Create initial status log for the new VPN account
        await prisma.vPNAccountStatusLog.create({
          data: {
            accountId: vpnAccount.id,
            oldStatus: null,
            newStatus: 'pending_faculty',
            changedBy: admin.username,
            reason: 'Created from access request',
          },
        });
      }
    } catch (vpnError) {
      console.error('Error creating/updating VPN account entry:', vpnError);
      // Continue even if VPN account creation fails - this is for tracking only
    }

    // adding comments at steps
    let commentText = `Request acknowledged by ${admin.username} and moved to Pending Faculty. Credentials set: AD username: ${ldapUsername}`;
    if (!accessRequest.isInternal && vpnUsername) {
      commentText += `, Username: ${vpnUsername}`;
    }
    if (!accessRequest.isInternal && expirationDate) {
      const expDate = new Date(expirationDate).toLocaleDateString();
      commentText += `, Expiration: ${expDate}`;
    }
    commentText += '. VPN account entry created for tracking.';

    await prisma.requestComment.create({
      data: {
        requestId: resolvedParams.id,
        comment: commentText,
        author: admin.username,
        type: 'system',
      },
    });

    // Send email notification to faculty when first moved to pending_faculty
    try {
      const emailConfig = await getEmailConfig();
      const facultyEmail = emailConfig.facultyEmail;
      
      if (facultyEmail) {
        await sendVPNPendingFacultyNotification(
          facultyEmail,
          vpnAccountUsername,
          updatedRequest.name,
          updatedRequest.email,
          portalType,
          admin.username
        );
        console.log('[Acknowledge] Email sent to faculty:', facultyEmail);
      } else {
        console.warn('[Acknowledge] No faculty email configured');
      }
    } catch (emailError) {
      console.error('[Acknowledge] Failed to send faculty email:', emailError);
      // Don't fail the request if email fails
    }

    // Send notification to student directors
    try {
      const directorEmails = await getStudentDirectorEmails();
      
      if (directorEmails.length > 0) {
        await sendStudentDirectorNotification(
          'New Request Moved to Pending Faculty',
          `A new access request has been acknowledged and moved to pending faculty status.`,
          {
            'Request ID': resolvedParams.id,
            'Name': updatedRequest.name,
            'Email': updatedRequest.email,
            'LDAP Username': ldapUsername,
            'VPN Username': vpnUsername || 'N/A',
            'Type': accessRequest.isInternal ? 'Internal Student' : 'External Student',
            'Portal Type': portalType,
            'Acknowledged By': admin.username,
            'Acknowledged At': new Date().toLocaleString(),
          }
        );
        console.log('[Acknowledge] Notification sent to student directors:', directorEmails.join(', '));
      } else {
        console.warn('[Acknowledge] No student director emails configured');
      }
    } catch (emailError) {
      console.error('[Acknowledge] Failed to send student director notification:', emailError);
      // Don't fail the request if email fails
    }

    // Log the acknowledgment action
    await logAuditAction({
      action: AuditActions.ACKNOWLEDGE_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      details: {
        requestName: updatedRequest.name,
        requestEmail: updatedRequest.email,
        ldapUsername,
        vpnUsername,
        isInternal: accessRequest.isInternal,
        expirationDate,
        vpnAccountCreated: true,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ 
      success: true, 
      request: updatedRequest 
    });
  } catch (error) {
    console.error('Error acknowledging request:', error);
    
    // Log the failed acknowledgment
    const resolvedParams = await params;
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.ACKNOWLEDGE_REQUEST,
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
      { error: 'Failed to acknowledge request' },
      { status: 500 }
    );
  }
}
