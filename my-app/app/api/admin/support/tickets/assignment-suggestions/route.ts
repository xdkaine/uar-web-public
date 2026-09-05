import { NextRequest, NextResponse } from 'next/server';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { searchLDAPUsers } from '@/lib/ldap';
import { prisma } from '@/lib/prisma';
import { checkRateLimitAsync, isRateLimitUnavailable } from '@/lib/ratelimit';
import { actorHasPermission } from '@/lib/rbac/core';
import { describeGroup, formatGroupPath } from '@/lib/support/group-display';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'tickets.assign')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const query = (request.nextUrl.searchParams.get('q') || '').trim();
    if (query.length < 3) {
      return NextResponse.json({ suggestions: [], directoryUnavailable: false });
    }
    if (query.length > 100) {
      return NextResponse.json({ error: 'Search query is too long' }, { status: 400 });
    }

    const rateLimit = await checkRateLimitAsync('ticket-assignment-suggestions', {
      maxRequests: 30,
      windowMs: 60 * 1000,
      identifier: admin.username,
    });
    if (!rateLimit.success) {
      return NextResponse.json({ error: 'Too many searches. Please wait and try again.' }, { status: 429 });
    }

    const [groups, peopleResult] = await Promise.all([
      prisma.allowedTicketSubjectGroup.findMany({
        where: {
          isActive: true,
          canBeAssignee: true,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { dn: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { name: 'asc' },
        take: 6,
        select: { dn: true, name: true },
      }),
      searchLDAPUsers(query, 6)
        .then((people) => ({ people, unavailable: false }))
        .catch(() => ({ people: [], unavailable: true })),
    ]);

    const people = peopleResult.people.map((person) => ({
      targetType: 'user' as const,
      username: person.username,
      label: person.displayName,
      secondaryLabel: `Username: ${person.username}`,
    }));
    const approvedGroups = groups.map((group) => {
      const display = describeGroup(group);
      return {
        targetType: 'directory_group' as const,
        dn: group.dn,
        label: display.displayName,
        secondaryLabel: display.path.length > 0
          ? `Approved group \u00b7 ${formatGroupPath(display.path)}`
          : 'Approved group',
      };
    });

    return NextResponse.json({
      suggestions: [...people, ...approvedGroups],
      directoryUnavailable: peopleResult.unavailable,
    });
  } catch (error) {
    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: 'This service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }
    console.error('Error searching ticket assignment targets:', error);
    return NextResponse.json({ error: 'Failed to search people and groups' }, { status: 500 });
  }
}
