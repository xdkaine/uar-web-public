import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { isJsonBodyError, parseAdminJson } from '@/lib/admin-json-parser';
import { ADMIN_NAV_ITEMS, type AdminNavItem } from '@/lib/admin/navigation';

type TrackViewBody = {
  pageName?: string;
  category?: string;
};

const LEGACY_PAGE_PREFIX = 'Admin Dashboard - ';

/**
 * Page identifiers are allowlisted against the admin navigation registry so
 * attacker-chosen strings can never be written into audit details. The
 * legacy composite form sent by AdminRoutePage ("Admin Dashboard - <tabId>")
 * is accepted when the tab resolves to a known entry.
 */
function resolveTrackedPage(pageName: string): AdminNavItem | null {
  const direct = ADMIN_NAV_ITEMS.find((item) => item.id === pageName);
  if (direct) {
    return direct;
  }
  if (pageName.startsWith(LEGACY_PAGE_PREFIX)) {
    return (
      ADMIN_NAV_ITEMS.find((item) => item.id === pageName.slice(LEGACY_PAGE_PREFIX.length)) ??
      null
    );
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    // Verify admin session with rate limiting
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await parseAdminJson<TrackViewBody>(request);
    const { pageName, category } = body;

    if (!pageName || !category) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const navItem = typeof pageName === 'string' ? resolveTrackedPage(pageName) : null;
    if (!navItem || category !== navItem.category) {
      return NextResponse.json(
        { error: 'Unknown page identifier' },
        { status: 400 }
      );
    }

    // Log the page view
    await logAuditAction({
      action: AuditActions.VIEW_PAGE,
      category: navItem.category,
      username: admin.username,
      details: {
        pageName,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Error tracking page view:', error);
    return NextResponse.json(
      { error: 'Failed to track page view' },
      { status: 500 }
    );
  }
}
