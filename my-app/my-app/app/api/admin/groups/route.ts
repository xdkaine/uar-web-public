import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { searchLDAPGroups } from '@/lib/ldap';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function GET(request: NextRequest) {
    try {
        const { admin, response } = await checkAdminAuthWithRateLimit(request);

        if (!admin || response) {
            return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const query = searchParams.get('q') || '';

        // If query is provided but too short, return empty (optional, but good for UX if they are typing)
        // However, the requirement is to list names, so we probably want to support "get all" if query is empty.
        // If query is present but < 2 chars, maybe we still want to search? 
        // Let's just pass the query to searchLDAPGroups. If it's empty, searchLDAPGroups should handle it (we'll check that next).
        // Actually, looking at the plan: "If no query is provided, fetch all groups (pass empty string to searchLDAPGroups)."

        console.log(`[API] Searching groups with query: "${query}"`);
        const groups = await searchLDAPGroups(query);
        console.log(`[API] Found ${groups.length} groups`);

        // Log viewing the group list
        await logAuditAction({
            action: AuditActions.VIEW_GROUP_LIST,
            category: AuditCategories.GROUP,
            username: admin.username,
            details: {
                query,
                resultCount: groups.length
            },
            ipAddress: getIpAddress(request),
            userAgent: getUserAgent(request),
        });

        return NextResponse.json({ groups });
    } catch (error) {
        console.error('Error searching groups:', error);
        return NextResponse.json(
            { error: 'Failed to search groups', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
