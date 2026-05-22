import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: importId } = await params;

    const importData = await prisma.vPNImport.findUnique({
      where: { id: importId },
      include: {
        importRecords: {
          orderBy: {
            vpnUsername: 'asc',
          },
        },
      },
    });

    if (!importData) {
      return NextResponse.json({ error: 'Import not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: importData,
    });
  } catch (error) {
    console.error('Get VPN import records error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch import records' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: importId } = await params;
    const body = await request.json();
    const { status, notes } = body;

    const updateData: any = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;

    const updated = await prisma.vPNImport.update({
      where: { id: importId },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error('Update VPN import error:', error);
    return NextResponse.json(
      { error: 'Failed to update import' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: importId } = await params;

    await prisma.vPNImport.delete({
      where: { id: importId },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Delete VPN import error:', error);
    return NextResponse.json(
      { error: 'Failed to delete import' },
      { status: 500 }
    );
  }
}
