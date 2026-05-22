import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const itemResult = await prisma.batchAccountItem.updateMany({
            where: { status: 'processing' },
            data: {
                status: 'failed',
                errorMessage: 'Cleaned up stuck processing state from previous crash'
            }
        });

        const batchResult = await prisma.batchAccountCreation.updateMany({
            where: { status: 'processing' },
            data: { status: 'failed' }
        });

        return NextResponse.json({ success: true, itemResult, batchResult });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
