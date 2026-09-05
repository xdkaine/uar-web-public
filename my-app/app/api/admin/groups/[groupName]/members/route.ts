import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { getLDAPGroupMembers, searchLDAPGroups, searchLDAPUser } from '@/lib/ldap';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { processLifecycleAction } from '@/lib/lifecycle-processor';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';
import { assertLifecycleGroupNotProtected } from '@/lib/lifecycle-protection';
import { createLifecycleGroupAction } from '@/lib/lifecycle-group-action';

// Helper to resolve group DN from name
async function resolveGroup(groupName: string, expectedDn?: string | null): Promise<Awaited<ReturnType<typeof searchLDAPGroups>>[number] | null> {
    const groups = await searchLDAPGroups(groupName);
    const exactMatches = groups.filter(g => g.name.toLowerCase() === groupName.toLowerCase());
    if (expectedDn) {
        const normalizedDn = expectedDn.trim().toLowerCase();
        return exactMatches.find((group) => group.dn.trim().toLowerCase() === normalizedDn) ?? null;
    }
    return exactMatches.length === 1 ? exactMatches[0] : null;
}

async function createAndProcessGroupAction(params: {
    actionType: 'add_group_member' | 'remove_from_group';
    username: string;
    groupDN: string;
    groupName: string;
    reason: string;
    actor: string;
    idempotencyKey: string;
}) {
    const { action, replayed } = await createLifecycleGroupAction({
        actionType: params.actionType,
        username: params.username,
        groupDn: params.groupDN,
        groupName: params.groupName,
        reason: params.reason,
        requestedBy: params.actor,
        idempotencyKey: params.idempotencyKey,
    });
    if (replayed) {
        if (action.status === 'queued') {
            const result = await processLifecycleAction(action.id);
            return { action, result, replayed: true };
        }
        const uncertain = action.status === 'processing' || action.status === 'reconciliation_required';
        return {
            action,
            result: {
                success: action.status === 'completed',
                actionId: action.id,
                reconciliationRequired: uncertain,
                error: action.errorMessage ?? (uncertain
                    ? 'Group action requires reconciliation'
                    : action.status === 'queued' ? 'Group action is still queued' : undefined),
            },
            replayed: true,
        };
    }
    const result = await processLifecycleAction(action.id);
    return { action, result, replayed: false };
}

// GET - List members
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ groupName: string }> }
) {
    try {
        const { admin, response } = await checkAdminAuthWithRateLimit(request);
        if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        if (!actorHasPermission(admin, 'users.read')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { groupName } = await params;
        const decodedGroupName = decodeURIComponent(groupName);

        const group = await resolveGroup(decodedGroupName, request.nextUrl.searchParams.get('dn'));
        if (!group) {
            return NextResponse.json({ error: 'Group not found' }, { status: 404 });
        }

        const [members, protection] = await Promise.all([
            getLDAPGroupMembers(group.dn),
            assertLifecycleGroupNotProtected(group.dn)
                .then(() => ({ protected: false, reason: null }))
                .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : '';
                    if (!message.includes('Administrative and privilege-bearing groups')) throw error;
                    return { protected: true, reason: message };
                }),
        ]);
        const readOnly = isProductionCloneReadOnly();
        const hasMutationPermission = actorHasPermission(admin, 'users.manage')
            && actorHasPermission(admin, 'lifecycle.manage');

        return NextResponse.json({
            members,
            group: { name: group.name, dn: group.dn },
            mutation: {
                allowed: hasMutationPermission && !readOnly && !protection.protected,
                readOnly,
                protected: protection.protected,
                readOnlyReason: readOnly
                    ? 'Directory mutations are disabled in this production-clone environment.'
                    : null,
                protectionReason: protection.reason,
            },
        });
    } catch (error) {
        console.error('Error fetching group members:', error);
        return NextResponse.json(
            { error: 'Failed to fetch group members' },
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

        if (!actorHasPermission(admin, 'users.manage') || !actorHasPermission(admin, 'lifecycle.manage')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (isProductionCloneReadOnly()) {
            return NextResponse.json({ error: 'Directory mutations are disabled in this production-clone environment.', code: 'CLONE_READ_ONLY' }, { status: 409 });
        }

        const { groupName } = await params;
        const decodedGroupName = decodeURIComponent(groupName);
        const { username, groupDn, reason, idempotencyKey } = await request.json();

        if (typeof username !== 'string' || !username.trim()) {
            return NextResponse.json({ error: 'Username is required' }, { status: 400 });
        }
        if (typeof groupDn !== 'string' || !groupDn.trim()) {
            return NextResponse.json({ error: 'The selected group DN is required' }, { status: 400 });
        }
        if (typeof reason !== 'string' || !reason.trim()) {
            return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
        }
        if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
            return NextResponse.json({ error: 'A stable idempotency key is required' }, { status: 400 });
        }

        const group = await resolveGroup(decodedGroupName, groupDn);
        if (!group) {
            return NextResponse.json({ error: 'The selected group identity no longer matches the directory. Refresh groups and try again.' }, { status: 409 });
        }
        try {
            await assertLifecycleGroupNotProtected(group.dn);
        } catch {
            return NextResponse.json({ error: 'Administrative and privilege-bearing groups cannot be changed here.' }, { status: 409 });
        }

        const user = await searchLDAPUser(username.trim());
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const canonicalUsername = user.attributes.find(
            (attribute) => attribute.type.toLowerCase() === 'samaccountname'
        )?.values?.[0]?.trim() || username.trim();
        const { action: lifecycleAction, result } = await createAndProcessGroupAction({
            actionType: 'add_group_member',
            username: canonicalUsername,
            groupDN: group.dn,
            groupName: decodedGroupName,
            reason: reason.trim(),
            actor: admin.username,
            idempotencyKey,
        });

        await logAuditAction({
            action: AuditActions.ADD_GROUP_MEMBER,
            category: AuditCategories.GROUP,
            username: admin.username,
            targetId: canonicalUsername,
            targetType: 'AD Group Member',
            relatedLifecycleActionId: lifecycleAction.id,
            eventKind: 'lifecycle',
            outcome: result.success ? 'success' : 'failure',
            details: { action: 'add_member', group: decodedGroupName, user: canonicalUsername, requestedUser: username.trim() },
            ipAddress: getIpAddress(request),
            userAgent: getUserAgent(request),
            success: result.success,
            errorMessage: result.success ? undefined : result.error,
        });

        return NextResponse.json({
            success: result.success,
            actionId: lifecycleAction.id,
            result: {
                success: result.success,
                actionId: lifecycleAction.id,
                reconciliationRequired: result.reconciliationRequired,
                error: result.success ? undefined : result.reconciliationRequired
                    ? 'Group membership outcome requires reconciliation.'
                    : 'Group membership change failed. Review the lifecycle operation.',
            },
        }, { status: result.success ? 200 : 207 });
    } catch (error) {
        console.error('Error adding group member:', error);
        return NextResponse.json(
            { error: 'Failed to add group member' },
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

        if (!actorHasPermission(admin, 'users.manage') || !actorHasPermission(admin, 'lifecycle.manage')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (isProductionCloneReadOnly()) {
            return NextResponse.json({ error: 'Directory mutations are disabled in this production-clone environment.', code: 'CLONE_READ_ONLY' }, { status: 409 });
        }

        const { groupName } = await params;
        const decodedGroupName = decodeURIComponent(groupName);
        const { username, groupDn, reason, idempotencyKey } = await request.json();

        if (typeof username !== 'string' || !username.trim()) {
            return NextResponse.json({ error: 'Username is required' }, { status: 400 });
        }
        if (typeof groupDn !== 'string' || !groupDn.trim()) {
            return NextResponse.json({ error: 'The selected group DN is required' }, { status: 400 });
        }
        if (typeof reason !== 'string' || !reason.trim()) {
            return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
        }
        if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
            return NextResponse.json({ error: 'A stable idempotency key is required' }, { status: 400 });
        }

        const group = await resolveGroup(decodedGroupName, groupDn);
        if (!group) {
            return NextResponse.json({ error: 'The selected group identity no longer matches the directory. Refresh groups and try again.' }, { status: 409 });
        }
        try {
            await assertLifecycleGroupNotProtected(group.dn);
        } catch {
            return NextResponse.json({ error: 'Administrative and privilege-bearing groups cannot be changed here.' }, { status: 409 });
        }

        const user = await searchLDAPUser(username);
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        const canonicalUsername = user.attributes.find(
            (attribute) => attribute.type.toLowerCase() === 'samaccountname'
        )?.values?.[0]?.trim() || username.trim();
        const { action: lifecycleAction, result } = await createAndProcessGroupAction({
            actionType: 'remove_from_group',
            username: canonicalUsername,
            groupDN: group.dn,
            groupName: decodedGroupName,
            reason: reason.trim(),
            actor: admin.username,
            idempotencyKey,
        });

        await logAuditAction({
            action: AuditActions.REMOVE_GROUP_MEMBER,
            category: AuditCategories.GROUP,
            username: admin.username,
            targetId: canonicalUsername,
            targetType: 'AD Group Member',
            relatedLifecycleActionId: lifecycleAction.id,
            eventKind: 'lifecycle',
            outcome: result.success ? 'success' : 'failure',
            details: { action: 'remove_member', group: decodedGroupName, user: canonicalUsername, requestedUser: username.trim() },
            ipAddress: getIpAddress(request),
            userAgent: getUserAgent(request),
            success: result.success,
            errorMessage: result.success ? undefined : result.error,
        });

        return NextResponse.json({
            success: result.success,
            actionId: lifecycleAction.id,
            result: {
                success: result.success,
                actionId: lifecycleAction.id,
                reconciliationRequired: result.reconciliationRequired,
                error: result.success ? undefined : result.reconciliationRequired
                    ? 'Group membership outcome requires reconciliation.'
                    : 'Group membership change failed. Review the lifecycle operation.',
            },
        }, { status: result.success ? 200 : 207 });
    } catch (error) {
        console.error('Error removing group member:', error);
        return NextResponse.json(
            { error: 'Failed to remove group member' },
            { status: 500 }
        );
    }
}
