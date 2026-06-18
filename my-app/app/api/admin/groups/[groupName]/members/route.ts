import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { getLDAPGroupMembers, addLDAPGroupMember, removeLDAPGroupMember, searchLDAPGroups, searchLDAPUser } from '@/lib/ldap';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';

// Helper to resolve group DN from name
async function resolveGroupDN(groupName: string): Promise<string | null> {
    // First try exact match search
    const groups = await searchLDAPGroups(groupName);
    const exactMatch = groups.find(g => g.name.toLowerCase() === groupName.toLowerCase());
    return exactMatch ? exactMatch.dn : null;
}

// GET - List members
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ groupName: string }> }
) {
    try {
        const { admin, response } = await checkAdminAuthWithRateLimit(request);
        if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { groupName } = await params;
        const decodedGroupName = decodeURIComponent(groupName);

        const groupDN = await resolveGroupDN(decodedGroupName);
        if (!groupDN) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        const members = await getLDAPGroupMembers(groupDN);

        return NextResponse.json({ members });
    } catch (error) {
        console.error('Error fetching group members:', error);
        return NextResponse.json(
            { error: 'Failed to fetch group members', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

// POST - Add member
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ groupName: string }> }
) {
    try {
        const { admin, response } = await checkAdminAuthWithRateLimit(request);
        if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { groupName } = await params;
        const decodedGroupName = decodeURIComponent(groupName);
        const { username } = await request.json();

        if (!username) {
            return NextResponse.json({ error: 'Username is required' }, { status: 400 });
        }

        const groupDN = await resolveGroupDN(decodedGroupName);
        if (!groupDN) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        // Resolve user DN
        const user = await searchLDAPUser(username);
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const userDN = user.objectName; // Assuming searchLDAPUser returns objectName as DN

        await addLDAPGroupMember(groupDN, userDN);

        // Create Lifecycle Action
        const adAccount = await prisma.accessRequest.findFirst({
            where: {
                OR: [
                    { ldapUsername: username },
                    { linkedAdUsername: username },
                ],
                status: { notIn: ['rejected', 'offboarded'] },
            },
            orderBy: { createdAt: 'desc' },
        });

        const lifecycleAction = await prisma.accountLifecycleAction.create({
            data: {
                actionType: 'add_to_group',
                targetAccountType: 'AD',
                targetUsername: username,
                targetUserId: adAccount?.id,
                reason: 'Group membership update',
                notes: `Added to group: ${decodedGroupName}`,
                requestedBy: admin.username,
                status: 'completed',
                processedAt: new Date(),
                processedBy: admin.username,
                completedAt: new Date(),
            }
        });

        await prisma.accountLifecycleHistory.create({
            data: {
                actionId: lifecycleAction.id,
                event: 'completed',
                performedBy: admin.username,
                newStatus: 'completed',
                details: JSON.stringify({
                    group: decodedGroupName,
                    action: 'add_member',
                    userDN,
                    groupDN
                })
            }
        });

        await logAuditAction({
            action: AuditActions.ADD_GROUP_MEMBER,
            category: AuditCategories.GROUP,
            username: admin.username,
            targetId: username,
            targetType: 'AD Group Member',
            details: { action: 'add_member', group: decodedGroupName, user: username },
            ipAddress: getIpAddress(request),
            userAgent: getUserAgent(request),
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error adding group member:', error);
        return NextResponse.json(
            { error: 'Failed to add group member', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}

// DELETE - Remove member
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ groupName: string }> }
) {
    try {
        const { admin, response } = await checkAdminAuthWithRateLimit(request);
        if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { groupName } = await params;
        const decodedGroupName = decodeURIComponent(groupName);
        const { username } = await request.json();

        if (!username) {
            return NextResponse.json({ error: 'Username is required' }, { status: 400 });
        }

        const groupDN = await resolveGroupDN(decodedGroupName);
        if (!groupDN) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        // Resolve user DN
        const user = await searchLDAPUser(username);
        if (!user) {
            // If user not found, maybe they are already gone, but we need DN to remove from group.
            // If we can't find the user, we can't get their DN to remove them.
            // However, for removal, maybe we can try to construct DN if we knew the structure, but safer to fail or require DN.
            // For now, fail if user not found.
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const userDN = user.objectName;

        await removeLDAPGroupMember(groupDN, userDN);

        // Create Lifecycle Action
        const adAccount = await prisma.accessRequest.findFirst({
            where: {
                OR: [
                    { ldapUsername: username },
                    { linkedAdUsername: username },
                ],
                status: { notIn: ['rejected', 'offboarded'] },
            },
            orderBy: { createdAt: 'desc' },
        });

        const lifecycleAction = await prisma.accountLifecycleAction.create({
            data: {
                actionType: 'remove_from_group',
                targetAccountType: 'AD',
                targetUsername: username,
                targetUserId: adAccount?.id,
                reason: 'Group membership update',
                notes: `Removed from group: ${decodedGroupName}`,
                requestedBy: admin.username,
                status: 'completed',
                processedAt: new Date(),
                processedBy: admin.username,
                completedAt: new Date(),
            }
        });

        await prisma.accountLifecycleHistory.create({
            data: {
                actionId: lifecycleAction.id,
                event: 'completed',
                performedBy: admin.username,
                newStatus: 'completed',
                details: JSON.stringify({
                    group: decodedGroupName,
                    action: 'remove_member',
                    userDN,
                    groupDN
                })
            }
        });

        await logAuditAction({
            action: AuditActions.REMOVE_GROUP_MEMBER,
            category: AuditCategories.GROUP,
            username: admin.username,
            targetId: username,
            targetType: 'AD Group Member',
            details: { action: 'remove_member', group: decodedGroupName, user: username },
            ipAddress: getIpAddress(request),
            userAgent: getUserAgent(request),
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error removing group member:', error);
        return NextResponse.json(
            { error: 'Failed to remove group member', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
