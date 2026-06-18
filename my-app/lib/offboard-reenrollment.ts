import { prisma } from '@/lib/prisma';
import { INTERNAL_EMAIL_DOMAIN } from '@/lib/validation';
import type { Prisma } from '@prisma/client';

const reusableOffboardedSelect = {
  id: true,
  name: true,
  email: true,
  isInternal: true,
  ldapUsername: true,
  vpnUsername: true,
  linkedAdUsername: true,
  linkedVpnUsername: true,
  accountExpiresAt: true,
  adAccountStatus: true,
  vpnAccountStatus: true,
} satisfies Prisma.AccessRequestSelect;

export type ReusableOffboardedRequest = Prisma.AccessRequestGetPayload<{ select: typeof reusableOffboardedSelect }>;

type ReusableOffboardedClient = {
  accessRequest: {
    findFirst(args: {
      where: Prisma.AccessRequestWhereInput;
      orderBy: Prisma.AccessRequestOrderByWithRelationInput;
      select: typeof reusableOffboardedSelect;
    }): Promise<ReusableOffboardedRequest | null>;
  };
};

function usernameWhere(username: string) {
  return [
    { ldapUsername: { equals: username, mode: 'insensitive' as const } },
    { linkedAdUsername: { equals: username, mode: 'insensitive' as const } },
    { vpnUsername: { equals: username, mode: 'insensitive' as const } },
    { linkedVpnUsername: { equals: username, mode: 'insensitive' as const } },
  ];
}

export async function findReusableOffboardedRequest(params: {
  username?: string | null;
  email?: string | null;
  client?: ReusableOffboardedClient;
}) {
  const username = params.username?.trim();
  const email = params.email?.trim();
  if (!username && !email) {
    return null;
  }

  const client = (params.client || prisma) as ReusableOffboardedClient;
  const where: Prisma.AccessRequestWhereInput = { status: 'offboarded' };

  if (username && email) {
    where.AND = [
      { email: { equals: email, mode: 'insensitive' } },
      { OR: usernameWhere(username) },
    ];
  } else if (username) {
    where.OR = usernameWhere(username);
  } else if (email) {
    where.email = { equals: email, mode: 'insensitive' };
  }

  return client.accessRequest.findFirst({
    where,
    orderBy: { updatedAt: 'desc' },
    select: reusableOffboardedSelect,
  });
}

export function reusableOffboardedUsername(
  request: Partial<Pick<ReusableOffboardedRequest, 'ldapUsername' | 'linkedAdUsername'>> | null | undefined,
  fallbackEmail?: string | null
): string | null {
  return request?.ldapUsername ||
    request?.linkedAdUsername ||
    (fallbackEmail?.endsWith(INTERNAL_EMAIL_DOMAIN) ? fallbackEmail.split('@')[0] : null) ||
    null;
}
