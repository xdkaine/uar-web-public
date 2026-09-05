import type { Prisma } from '@prisma/client';

export function buildTicketListVisibility(username: string, groupDns: string[]): Prisma.SupportTicketWhereInput {
  const assignmentTargets: Prisma.SupportTicketAssignmentWhereInput[] = [
    {
      targetType: 'user',
      targetUsername: { equals: username, mode: 'insensitive' },
    },
  ];

  if (groupDns.length > 0) {
    assignmentTargets.push({
      targetType: 'directory_group',
      targetGroupDn: { in: groupDns },
    });
  }

  const visibility: Prisma.SupportTicketWhereInput[] = [{ username }];
  if (groupDns.length > 0) {
    visibility.push({ requestedForGroupDn: { in: groupDns } });
  }
  visibility.push({
    assignments: {
      some: {
        isActive: true,
        OR: assignmentTargets,
      },
    },
  });

  return { internalOnly: false, OR: visibility };
}
