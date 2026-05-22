import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { createLDAPUser, setLDAPUserExpiration, setLDAPUserPassword } from '@/lib/ldap';
import { sendCredentialsEmail } from '@/lib/email';
import { generateStrongPassword } from '@/lib/password';
import { nanoid } from 'nanoid';

interface AccountInput {
  name: string;
  email: string;
  institution: string;
  eventReason: string;
}

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 401 });
    }
    const adminUsername = admin.username;

    const body = await request.json();
    const { accounts, accountExpiresAt } = body as {
      accounts: AccountInput[];
      accountExpiresAt: string;
    };

    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json({ error: 'Accounts array is required' }, { status: 400 });
    }

    if (!accountExpiresAt) {
      return NextResponse.json({ error: 'Account expiration date is required' }, { status: 400 });
    }

    const expirationDate = new Date(accountExpiresAt);
    if (expirationDate < new Date()) {
      return NextResponse.json({ error: 'Expiration date must be in the future' }, { status: 400 });
    }

    // Validate all accounts first
    for (const account of accounts) {
      if (!account.name || !account.email || !account.institution) {
        return NextResponse.json(
          { error: 'Each account must have name, email, and institution' },
          { status: 400 }
        );
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(account.email)) {
        return NextResponse.json(
          { error: `Invalid email format: ${account.email}` },
          { status: 400 }
        );
      }
    }

    // Create batch record
    const batchId = nanoid();
    const results: AccountInput[] = [];
    let successful = 0;
    let failed = 0;

    // Process each account
    for (const account of accounts) {
      try {
        // Check if email already exists
        const existingRequest = await prisma.accessRequest.findFirst({
          where: {
            email: account.email.toLowerCase(),
            status: {
              in: ['pending_verification', 'pending_student_directors', 'pending_faculty', 'approved'],
            },
          },
        });

        if (existingRequest) {
          results.push({
            ...account,
            error: 'Email already has an active request',
            status: 'error',
          } as any);
          failed++;
          continue;
        }

        // Generate username from email (first part before @)
        const baseUsername = account.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        let username = baseUsername;
        let counter = 1;

        // Ensure username is unique
        while (await prisma.accessRequest.findFirst({ where: { ldapUsername: username } })) {
          username = `${baseUsername}${counter}`;
          counter++;
        }

        // Generate secure, user-friendly password
        const password = generateStrongPassword();

        // Create access request
        const accessRequest = await prisma.accessRequest.create({
          data: {
            name: account.name,
            email: account.email.toLowerCase(),
            isInternal: false,
            needsDomainAccount: true,
            institution: account.institution,
            eventReason: account.eventReason || `Batch: ${batchId}`,
            isVerified: true,
            verifiedAt: new Date(),
            status: 'approved',
            approvedAt: new Date(),
            approvedBy: adminUsername,
            ldapUsername: username,
            accountPassword: password,
            accountExpiresAt: expirationDate,
            accountCreatedAt: new Date(),
          },
        });

        // Try to create AD account
        try {
          await createLDAPUser(username, account.email, account.name, false, accessRequest.id, expirationDate);
          await setLDAPUserPassword(username, password);
          await setLDAPUserExpiration(username, expirationDate);

          // Send credentials email
          await sendCredentialsEmail(
            account.email,
            account.name,
            username,
            password,
            expirationDate
          );

          results.push({
            ...account,
            status: 'success',
          } as any);
          successful++;
        } catch (ldapError) {
          // LDAP creation failed, mark request with error
          const rawProvisioningError = ldapError instanceof Error ? ldapError.message : 'LDAP creation failed';
          await prisma.accessRequest.update({
            where: { id: accessRequest.id },
            data: {
              provisioningState: 'error',
              provisioningError: rawProvisioningError.replace(/\x00/g, ''),
            },
          });

          results.push({
            ...account,
            error: 'Failed to create AD account',
            status: 'error',
          } as any);
          failed++;
        }

        // Add comment to request
        await prisma.requestComment.create({
          data: {
            requestId: accessRequest.id,
            comment: `Account created via batch process (Batch ID: ${batchId}) by ${adminUsername}`,
            author: adminUsername,
            type: 'system',
          },
        });

      } catch (error) {
        console.error('[Batch Accounts] Error processing account:', account.email, error);
        results.push({
          ...account,
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        } as any);
        failed++;
      }
    }

    // Create batch creation record
    await prisma.batchAccountCreation.create({
      data: {
        createdBy: adminUsername,
        description: `Batch: ${batchId} - ${accounts[0]?.eventReason || 'Batch Account Creation'}`,
        totalAccounts: accounts.length,
        successfulAccounts: successful,
        failedAccounts: failed,
        status: failed === 0 ? 'completed' : 'partial',
      },
    });

    return NextResponse.json({
      message: 'Batch processing complete',
      successful,
      failed,
      total: accounts.length,
      details: results,
      batchId,
    });

  } catch (error) {
    console.error('[Batch Accounts] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process batch accounts' },
      { status: 500 }
    );
  }
}
