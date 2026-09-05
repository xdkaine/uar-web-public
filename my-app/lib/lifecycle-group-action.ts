import { prisma } from '@/lib/prisma';
import { getLDAPGroupIdentity, searchLDAPUser } from '@/lib/ldap';
import { assertLifecycleGroupNotProtected } from '@/lib/lifecycle-protection';

type GroupActionType = 'add_group_member' | 'remove_from_group';

export type CreateLifecycleGroupActionInput = {
  actionType: GroupActionType;
  username: string;
  groupDn: string;
  groupName?: string;
  reason: string;
  requestedBy: string;
  relatedTicketId?: string | null;
  idempotencyKey: string;
  canRestore?: boolean;
  flowArtifact?: { runId: string; nodeId: string };
};

type ExistingAction = NonNullable<Awaited<ReturnType<typeof prisma.accountLifecycleAction.findUnique>>>;

function assertReplayMatches(input: CreateLifecycleGroupActionInput, action: ExistingAction): void {
  if (
    action.actionType !== input.actionType
    || action.targetUsername.toLowerCase() !== input.username.toLowerCase()
    || action.targetGroupDn?.toLowerCase() !== input.groupDn.toLowerCase()
    || action.reason !== input.reason
    || action.requestedBy !== input.requestedBy
    || action.relatedTicketId !== (input.relatedTicketId ?? null)
  ) {
    throw new Error('Idempotency key is already bound to a different group lifecycle action');
  }
}

function userObjectGuid(
  user: NonNullable<Awaited<ReturnType<typeof searchLDAPUser>>>
): string | null {
  return user.attributes.find(
    (attribute) => attribute.type.toLowerCase() === 'objectguid'
  )?.values?.[0] ?? null;
}

/**
 * The only supported authoring path for new lifecycle group actions. It binds
 * both directory objects by immutable identity and records the initial history
 * atomically before any worker can claim the action.
 */
export async function createLifecycleGroupActions(inputs: CreateLifecycleGroupActionInput[]) {
  const prepared = await Promise.all(inputs.map(async (input) => {
    const replay = await prisma.accountLifecycleAction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replay) {
      assertReplayMatches(input, replay);
      return { input, replay, group: null, user: null, objectGuid: null };
    }

    const [group, user] = await Promise.all([
      getLDAPGroupIdentity(input.groupDn),
      searchLDAPUser(input.username),
      assertLifecycleGroupNotProtected(input.groupDn),
    ]);
    if (!user) throw new Error(`Directory user not found: ${input.username}`);
    const objectGuid = userObjectGuid(user);
    if (!objectGuid) throw new Error(`Directory user has no readable immutable identity: ${input.username}`);
    if (group.dn.toLowerCase() !== input.groupDn.toLowerCase()) {
      throw new Error('Directory group resolved to a different DN than the approved target');
    }
    return { input, replay: null, group, user, objectGuid };
  }));

  return prisma.$transaction(async (tx) => {
    const results: Array<{ action: ExistingAction; replayed: boolean }> = [];
    for (const item of prepared) {
      const existing = item.replay ?? await tx.accountLifecycleAction.findUnique({
        where: { idempotencyKey: item.input.idempotencyKey },
      });
      let action: ExistingAction;
      let replayed: boolean;
      if (existing) {
        assertReplayMatches(item.input, existing);
        action = existing;
        replayed = true;
      } else {
        if (!item.group || !item.user || !item.objectGuid) {
          throw new Error('Prepared group lifecycle identity evidence is missing');
        }
        const groupDn = item.group.dn;
        action = await tx.accountLifecycleAction.create({
      data: {
        actionType: item.input.actionType,
        targetAccountType: 'AD',
        targetUsername: item.input.username,
        targetGroupDn: groupDn,
        targetGroupObjectGuid: item.group.objectGuid,
        targetDirectoryDn: item.user.objectName,
        targetDirectoryObjectGuid: item.objectGuid,
        reason: item.input.reason,
        notes: JSON.stringify({ groupDn, groupName: item.input.groupName }),
        requestedBy: item.input.requestedBy,
        relatedTicketId: item.input.relatedTicketId ?? null,
        idempotencyKey: item.input.idempotencyKey,
        status: 'queued',
        operationMode: 'governed',
        canRestore: item.input.canRestore ?? false,
      },
    });
    await tx.accountLifecycleHistory.create({
      data: {
        actionId: action.id,
        event: 'created',
        performedBy: item.input.requestedBy,
        newStatus: 'queued',
        details: JSON.stringify({
          groupDn,
          groupObjectGuid: item.group.objectGuid,
          userDn: item.user.objectName,
          userObjectGuid: item.objectGuid,
        }),
      },
    });
        replayed = false;
      }

      if (item.input.flowArtifact) {
        const artifact = await tx.flowArtifact.findFirst({
          where: {
            runId: item.input.flowArtifact.runId,
            nodeId: item.input.flowArtifact.nodeId,
            kind: 'lifecycle_action',
            refId: action.id,
          },
          select: { id: true },
        });
        if (!artifact) {
          await tx.flowArtifact.create({
            data: {
              runId: item.input.flowArtifact.runId,
              nodeId: item.input.flowArtifact.nodeId,
              kind: 'lifecycle_action',
              refId: action.id,
            },
          });
        }
      }
      results.push({ action, replayed });
    }
    return results;
  });
}

export async function createLifecycleGroupAction(input: CreateLifecycleGroupActionInput) {
  const [result] = await createLifecycleGroupActions([input]);
  return result;
}
