import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { getIpAddress, logAuditAction } from '@/lib/audit-log';
import { encryptPassword } from '@/lib/encryption';
import { generateStrongPassword } from '@/lib/password';
import { appLogger } from '@/lib/logger';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

/**
 * Process a VPN import by creating VPN accounts for all matched records
 * POST /api/admin/vpn-import/process
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let importId: string | undefined;
  let adminUsername = 'unknown';
  
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      adminUsername = admin.username;
    }
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await parseJsonWithLimit<{ importId?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const { importId: reqImportId } = body;

    if (typeof reqImportId !== 'string' || !reqImportId.trim()) {
      return NextResponse.json({ error: 'Import ID is required' }, { status: 400 });
    }

    importId = reqImportId.trim();

    // Fetch the import with all matched records
    const vpnImport = await prisma.vPNImport.findUnique({
      where: { id: importId },
      include: {
        importRecords: {
          where: {
            matchStatus: 'matched',
            vpnAccountCreated: false,
          },
        },
      },
    });

    if (!vpnImport) {
      return NextResponse.json({ error: 'Import not found' }, { status: 404 });
    }

    if (vpnImport.importRecords.length === 0) {
      return NextResponse.json({ 
        error: 'No matched records to process or all accounts already created' 
      }, { status: 400 });
    }

    // Use a transaction to create all VPN accounts
    // Increase timeout for large batch imports
    const result = await prisma.$transaction(async (tx: any) => {
      let createdCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const record of vpnImport.importRecords) {
        try {
          // Skip if no AD username (shouldn't happen with matched status, but be safe)
          if (!record.adUsername) {
            errorCount++;
            errors.push(`${record.vpnUsername}: No AD username found`);
            continue;
          }

          // Generate a user-friendly password (admin should reset via faculty portal)
          const tempPassword = generateStrongPassword();
          const encryptedPassword = encryptPassword(tempPassword);

          // Determine portal type and if it's internal
          const portalType = vpnImport.userType === 'Internal' 
            ? (vpnImport.portalType || 'Management') 
            : 'External';
          const isInternal = vpnImport.userType === 'Internal';

          // Get email - prefer from import record, fallback to AD email, or construct from username for internal users
          const userEmail = record.email || record.adEmail || (isInternal ? `${record.vpnUsername}@cpp.edu` : '');
          const userName = record.fullName || record.adDisplayName || record.vpnUsername;

          // Validate email is present (required for AccessRequest creation)
          if (!userEmail) {
            errorCount++;
            errors.push(`${record.vpnUsername}: Email is required but not found in import or AD`);
            appLogger.warn(`Skipping VPN import record ${record.vpnUsername} - no email available`);
            continue;
          }

          // Check if VPN account already exists with this username
          const existingVpnAccount = await tx.vPNAccount.findUnique({
            where: { username: record.vpnUsername },
          });

          if (existingVpnAccount) {
            errorCount++;
            errors.push(`${record.vpnUsername}: VPN account already exists`);
            appLogger.warn(`Skipping VPN import record ${record.vpnUsername} - account already exists`);
            continue;
          }

          // Check if AccessRequest already exists for this user
          const existingAccessRequest = await tx.accessRequest.findFirst({
            where: {
              OR: [
                { email: userEmail.toLowerCase() },
                { ldapUsername: record.adUsername },
                { vpnUsername: record.vpnUsername },
                { linkedAdUsername: record.adUsername },
              ],
              status: { notIn: ['rejected', 'offboarded'] },
            },
          });

          // Create AccessRequest if it doesn't exist (similar to infrastructure sync)
          let accessRequestId = existingAccessRequest?.id || null;
          if (!existingAccessRequest) {
            const newAccessRequest = await tx.accessRequest.create({
              data: {
                name: userName,
                email: userEmail.toLowerCase(),
                isInternal,
                needsDomainAccount: false, // They already have AD account
                status: 'approved', // Auto-approve since they have AD access
                isVerified: true,
                verifiedAt: new Date(),
                isManuallyAssigned: true,
                linkedAdUsername: record.adUsername,
                linkedVpnUsername: record.vpnUsername,
                manuallyAssignedBy: admin.username,
                manuallyAssignedAt: new Date(),
                manualAssignmentNotes: `Auto-created during VPN import (${vpnImport.fileName}) - matched to AD account ${record.adUsername}`,
                ldapUsername: isInternal ? record.adUsername : undefined,
                vpnUsername: record.vpnUsername,
                approvedAt: new Date(),
                approvedBy: admin.username,
                approvalMessage: `Auto-approved - VPN import matched to existing AD account ${record.adUsername}`,
                accountCreatedAt: new Date(),
                provisioningState: 'completed',
                provisioningCompletedAt: new Date(),
              },
            });
            accessRequestId = newAccessRequest.id;
            appLogger.info(`Created AccessRequest for VPN import record ${record.vpnUsername}`);
          }

          // Create VPN account with active status (imports represent existing users)
          const vpnAccount = await tx.vPNAccount.create({
            data: {
              username: record.vpnUsername,
              name: userName,
              email: userEmail,
              portalType,
              isInternal,
              status: 'active',
              password: encryptedPassword,
              createdBy: admin.username,
              createdByFaculty: false,
              notes: `Created from import: ${vpnImport.fileName}\nMatched to AD: ${record.adUsername}\nAD Display Name: ${record.adDisplayName || 'N/A'}\nAD Email: ${record.adEmail || 'N/A'}`,
              importId: vpnImport.id,
              accessRequestId,
              adUsername: record.adUsername, // Link to AD account
            },
          });

          // Create status log
          await tx.vPNAccountStatusLog.create({
            data: {
              accountId: vpnAccount.id,
              oldStatus: null,
              newStatus: 'active',
              changedBy: admin.username,
              reason: `Account created from VPN import - matched to AD account ${record.adUsername}`,
            },
          });

          // Create ADAccountMatch record for tracking (like infrastructure sync does)
          if (isInternal && record.adUsername) {
            // First check if we have an AD sync record to link to, or create a dummy one
            let syncRecord = await tx.aDAccountSync.findFirst({
              where: {
                notes: { contains: 'VPN Import Tracking' },
                triggeredBy: admin.username,
                status: 'running',
              },
              orderBy: { createdAt: 'desc' },
            });

            // Create a tracking sync record if none exists
            if (!syncRecord) {
              syncRecord = await tx.aDAccountSync.create({
                data: {
                  triggeredBy: admin.username,
                  status: 'running',
                  notes: `VPN Import Tracking - ${vpnImport.fileName}`,
                },
              });
            }

            // Create match record
            await tx.aDAccountMatch.create({
              data: {
                syncId: syncRecord.id,
                adUsername: record.adUsername,
                adDisplayName: record.adDisplayName || userName,
                adEmail: record.adEmail || userEmail,
                vpnUsername: record.vpnUsername,
                vpnAccountId: vpnAccount.id,
                accessRequestId,
                requestEmail: userEmail,
                requestName: userName,
                matchType: 'full_match',
                wasAutoAssigned: true,
                assignedAt: new Date(),
                notes: `Created during VPN import: ${vpnImport.fileName}`,
              },
            });
          }

          // Update import record to mark as created
          await tx.vPNImportRecord.update({
            where: { id: record.id },
            data: {
              vpnAccountCreated: true,
              vpnAccountId: vpnAccount.id,
              createdAt_vpn: new Date(),
            },
          });

          createdCount++;
        } catch (error) {
          errorCount++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${record.vpnUsername}: ${errorMessage}`);
          console.error(`Failed to create VPN account for ${record.vpnUsername}:`, error);
        }
      }

      // Update import statistics
      const totalCreated = await tx.vPNImportRecord.count({
        where: {
          importId: vpnImport.id,
          vpnAccountCreated: true,
        },
      });

      const totalMatched = await tx.vPNImportRecord.count({
        where: {
          importId: vpnImport.id,
          matchStatus: 'matched',
        },
      });

      // Update import status
      const allProcessed = totalCreated === totalMatched && totalMatched > 0;
      await tx.vPNImport.update({
        where: { id: vpnImport.id },
        data: {
          createdAccounts: totalCreated,
          processedRecords: totalCreated,
          status: allProcessed ? 'completed' : 'processing',
          processedAt: allProcessed ? new Date() : null,
        },
      });

      // Finalize the AD sync tracking record if we created one
      const syncRecord = await tx.aDAccountSync.findFirst({
        where: {
          notes: { contains: `VPN Import Tracking - ${vpnImport.fileName}` },
          triggeredBy: admin.username,
          status: 'running',
        },
      });

      if (syncRecord) {
        const matchCount = await tx.aDAccountMatch.count({
          where: { syncId: syncRecord.id },
        });

        await tx.aDAccountSync.update({
          where: { id: syncRecord.id },
          data: {
            status: errorCount === 0 ? 'completed' : 'partial',
            completedAt: new Date(),
            totalADAccounts: createdCount,
            autoAssigned: createdCount,
            matchedAccounts: matchCount,
            notes: `VPN Import Tracking - ${vpnImport.fileName}\nCreated ${createdCount} VPN accounts with AD linkage${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
          },
        });
      }

      return { createdCount, errorCount, errors, totalCreated };
    }, {
      maxWait: 10000,
      timeout: 60000,
    });

    const duration = Date.now() - startTime;

    // Log successful processing
    await logAuditAction({
      category: 'vpn',
      action: 'import_processed',
      username: admin.username,
      targetType: 'VPNImport',
      targetId: importId,
      details: {
        createdCount: result.createdCount,
        errorCount: result.errorCount,
        errors: result.errors,
        duration: `${duration}ms`,
      },
      ipAddress: getIpAddress(request) || 'unknown',
      success: result.errorCount === 0,
    });

    // Send email notifications for successfully created accounts
    if (result.createdCount > 0) {
      try {
        const { sendVPNPendingFacultyNotification, sendStudentDirectorNotification } = await import('@/lib/email');
        const { getEmailConfig } = await import('@/lib/email-config');
        
        // Get faculty email from database or environment
        const emailConfig = await getEmailConfig();
        const facultyEmail = emailConfig.facultyEmail;
        
        // Notify faculty about the batch of accounts
        if (facultyEmail) {
          await sendVPNPendingFacultyNotification(
            facultyEmail,
            `Import Batch: ${vpnImport.fileName}`,
            `${result.createdCount} VPN account(s) from import`,
            vpnImport.importedBy,
            vpnImport.portalType || vpnImport.userType,
            admin.username
          );
        }

        // Notify student directors
        await sendStudentDirectorNotification(
          `VPN Import Processed - ${result.createdCount} Accounts Created`,
          `A VPN import has been processed and ${result.createdCount} new account(s) are awaiting faculty approval.`,
          {
            'Import File': vpnImport.fileName,
            'Accounts Created': result.createdCount.toString(),
            'Errors': result.errorCount.toString(),
            'Portal Type': vpnImport.portalType || vpnImport.userType,
            'Processed By': admin.username,
          }
        );
      } catch (emailError) {
        console.error('Failed to send email notifications for import processing:', emailError);
        // Don't fail the request if email fails
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        createdCount: result.createdCount,
        errorCount: result.errorCount,
        errors: result.errors,
        totalCreated: result.totalCreated,
      },
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error('VPN import processing error:', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      importId,
      duration: `${duration}ms`,
    });

    // Log failed processing attempt and let audit failures bubble
    await logAuditAction({
      category: 'vpn',
      action: 'import_process_failed',
      username: adminUsername,
      targetType: 'VPNImport',
      targetId: importId || 'N/A',
      details: {
        error: errorMessage,
        duration: `${duration}ms`,
      },
      ipAddress: getIpAddress(request) || 'unknown',
      success: false,
      errorMessage,
    });

    return NextResponse.json(
      { 
        error: 'Failed to process VPN import',
      },
      { status: 500 }
    );
  }
}
