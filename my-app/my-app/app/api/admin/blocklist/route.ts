import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { parseJsonWithLimit, MAX_REQUEST_BODY_SIZE, validateStringLength, INPUT_LIMITS } from '@/lib/validation';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

interface BlocklistRequestBody {
  email?: string;
  reason?: string;
  notes?: string;
  linkedTicketId?: string;
}

// GET - List all blocked emails
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const search = searchParams.get('search') || '';

    const where: any = {};
    
    if (!includeInactive) {
      where.isActive = true;
    }

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { reason: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }

    const blockedEmails = await prisma.blockedEmail.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Log viewing blocklist
    await logAuditAction({
      action: AuditActions.VIEW_BLOCKLIST,
      category: AuditCategories.BLOCKLIST,
      username: admin.username,
      details: {
        totalEntries: blockedEmails.length,
        includeInactive,
        hasSearch: !!search,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ blockedEmails }, { status: 200 });
  } catch (error) {
    console.error('Error fetching blocked emails:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blocked emails' },
      { status: 500 }
    );
  }
}

// POST - Add a new blocked email
export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await parseJsonWithLimit<BlocklistRequestBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const { email, reason, notes, linkedTicketId } = body;

    if (!email || !reason) {
      return NextResponse.json(
        { error: 'Email and reason are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate string lengths
    const emailValidation = validateStringLength(email, 'Email', INPUT_LIMITS.EMAIL);
    if (!emailValidation.valid) {
      return NextResponse.json({ error: emailValidation.error }, { status: 400 });
    }

    const reasonValidation = validateStringLength(reason, 'Reason', 500, 1);
    if (!reasonValidation.valid) {
      return NextResponse.json({ error: reasonValidation.error }, { status: 400 });
    }

    if (notes) {
      const notesValidation = validateStringLength(notes, 'Notes', 2000);
      if (!notesValidation.valid) {
        return NextResponse.json({ error: notesValidation.error }, { status: 400 });
      }
    }

    // Check if email is already blocked and active
    const existingBlock = await prisma.blockedEmail.findFirst({
      where: {
        email: email.toLowerCase(),
        isActive: true,
      },
    });

    if (existingBlock) {
      return NextResponse.json(
        { error: 'This email is already blocked' },
        { status: 409 }
      );
    }

    // Verify ticket exists if provided
    if (linkedTicketId) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: linkedTicketId },
        select: { id: true, subject: true },
      });

      if (!ticket) {
        return NextResponse.json(
          { error: 'Invalid ticket ID' },
          { status: 400 }
        );
      }
    }

    const blockedEmail = await prisma.blockedEmail.create({
      data: {
        email: email.toLowerCase(),
        reason,
        notes: notes || null,
        linkedTicketId: linkedTicketId || null,
        blockedBy: admin.username,
        isActive: true,
      },
    });

    // Log blocklist addition
    await logAuditAction({
      action: AuditActions.ADD_BLOCKLIST,
      category: AuditCategories.BLOCKLIST,
      username: admin.username,
      targetId: blockedEmail.id,
      targetType: 'BlockedEmail',
      details: { email: email.toLowerCase(), hasTicket: !!linkedTicketId },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(
      { 
        message: 'Email blocked successfully',
        blockedEmail,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error blocking email:', error);
    
    // Log the failure
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.ADD_BLOCKLIST,
        category: AuditCategories.BLOCKLIST,
        username: admin.username,
        targetType: 'BlockedEmail',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to block email' },
      { status: 500 }
    );
  }
}
