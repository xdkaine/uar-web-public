import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET /api/settings/banner - Get all active notification banners (public endpoint)
export async function GET(request: NextRequest) {
  try {
    const now = new Date();
    
    // Get all active notifications that are within their date range (if specified)
    const notifications = await prisma.notificationBanner.findMany({
      where: {
        isActive: true,
        OR: [
          { startDate: null },
          { startDate: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { endDate: null },
              { endDate: { gte: now } },
            ],
          },
        ],
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        message: true,
        type: true,
        priority: true,
        dismissible: true,
      },
    });

    // Also check for legacy banner in SystemSettings for backward compatibility
    const settings = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        globalNotificationBanner: true,
        notificationBannerType: true,
      },
    });

    // Add legacy banner if it exists and no new notifications
    if (settings?.globalNotificationBanner && notifications.length === 0) {
      return NextResponse.json({
        notifications: [{
          id: 'legacy',
          message: settings.globalNotificationBanner,
          type: settings.notificationBannerType || 'info',
          priority: 0,
          dismissible: true,
        }],
      });
    }

    return NextResponse.json({ notifications });
  } catch (error) {
    console.error('Error fetching notification banners:', error);
    return NextResponse.json({ notifications: [] });
  }
}
