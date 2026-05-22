import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { getIpAddress, logAuditAction } from '@/lib/audit-log';
import { sanitizeCsvImport } from '@/lib/csv-security';

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

    const body = await request.json();
    const { userType, portalType, fileName, records, columnMapping } = body;

    if (!userType || !fileName || !records || !Array.isArray(records)) {
      return NextResponse.json({ error: 'Invalid request data' }, { status: 400 });
    }

    if (userType !== 'Internal' && userType !== 'External') {
      return NextResponse.json({ error: 'Invalid user type' }, { status: 400 });
    }

    // For Internal users, portalType is required
    if (userType === 'Internal' && (!portalType || (portalType !== 'Management' && portalType !== 'Limited'))) {
      return NextResponse.json({ error: 'Portal type is required for Internal users' }, { status: 400 });
    }

    // Use a transaction to ensure all-or-nothing behavior
    const result = await prisma.$transaction(async (tx: any) => {
      // Create the import record with expiration (30 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const vpnImport = await tx.vPNImport.create({
        data: {
          userType,
          portalType: userType === 'Internal' ? portalType : null,
          fileName,
          importedBy: admin.username,
          totalRecords: records.length,
          status: 'pending',
          expiresAt,
        },
      });

      importId = vpnImport.id;

      // Validate all records before inserting
      // Apply CSV injection protection to sanitize imported values
      const importRecords = records.map((record: any, index: number) => {
        if (!record.vpnUsername || typeof record.vpnUsername !== 'string') {
          throw new Error(`Invalid VPN username at row ${index + 1}`);
        }
        
        return {
          importId: vpnImport.id,
          vpnUsername: sanitizeCsvImport(record.vpnUsername),
          fullName: record.fullName ? sanitizeCsvImport(record.fullName) : null,
          email: record.email ? sanitizeCsvImport(record.email) : null,
          notes: record.notes ? sanitizeCsvImport(record.notes) : null,
          rawData: JSON.stringify(record.rawData || {}),
          matchStatus: 'unmatched',
        };
      });

      // Create individual import records
      await tx.vPNImportRecord.createMany({
        data: importRecords,
      });

      return vpnImport;
    });

    const duration = Date.now() - startTime;

    // Log successful import
    await logAuditAction({
      category: 'vpn',
      action: 'import_created',
      username: admin.username,
      targetType: 'VPNImport',
      targetId: result.id,
      details: {
        fileName,
        userType,
        portalType,
        totalRecords: records.length,
        columnMapping,
        duration: `${duration}ms`,
      },
      ipAddress: getIpAddress(request) || 'unknown',
      success: true,
    });

    return NextResponse.json({
      success: true,
      data: {
        importId: result.id,
        totalRecords: records.length,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error('VPN import error:', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      importId,
      duration: `${duration}ms`,
    });

    // Log failure
    await logAuditAction({
      category: 'vpn',
      action: 'import_failed',
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
        error: 'Failed to import VPN records. Please check the file format and try again.',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userType = searchParams.get('userType');
    const portalType = searchParams.get('portalType');
    const status = searchParams.get('status');

    const whereClause: any = {};
    if (userType) {
      whereClause.userType = userType;
    }
    if (portalType) {
      whereClause.portalType = portalType;
    }
    if (status) {
      whereClause.status = status;
    }

    // Only show imports that haven't expired
    whereClause.OR = [
      { expiresAt: null },
      { expiresAt: { gte: new Date() } }
    ];

    const imports = await prisma.vPNImport.findMany({
      where: whereClause,
      include: {
        importRecords: {
          select: {
            id: true,
            vpnUsername: true,
            matchStatus: true,
            adUsername: true,
            vpnAccountCreated: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate match statistics for each import
    const importsWithStats = imports.map((imp: any) => ({
      id: imp.id,
      createdAt: imp.createdAt,
      userType: imp.userType,
      portalType: imp.portalType,
      fileName: imp.fileName,
      importedBy: imp.importedBy,
      totalRecords: imp.totalRecords,
      matchedRecords: imp.importRecords.filter((r: any) => r.matchStatus === 'matched').length,
      unmatchedRecords: imp.importRecords.filter((r: any) => r.matchStatus === 'unmatched').length,
      createdAccounts: imp.importRecords.filter((r: any) => r.vpnAccountCreated).length,
      status: imp.status,
      processedAt: imp.processedAt,
      expiresAt: imp.expiresAt,
      notes: imp.notes,
    }));

    return NextResponse.json({
      success: true,
      data: importsWithStats,
    });
  } catch (error) {
    console.error('Get VPN imports error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch VPN imports' },
      { status: 500 }
    );
  }
}
