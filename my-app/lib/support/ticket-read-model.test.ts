import { describe, expect, it } from 'vitest';

import { buildTicketListVisibility } from './ticket-read-model';

describe('ticket list visibility', () => {
  it('includes owned, requested-for, direct-assigned, and group-assigned tickets', () => {
    expect(buildTicketListVisibility('alice', ['CN=Support,DC=example'])).toEqual({
      internalOnly: false,
      OR: [
        { username: 'alice' },
        { requestedForGroupDn: { in: ['CN=Support,DC=example'] } },
        {
          assignments: {
            some: {
              isActive: true,
              OR: [
                { targetType: 'user', targetUsername: { equals: 'alice', mode: 'insensitive' } },
                { targetType: 'directory_group', targetGroupDn: { in: ['CN=Support,DC=example'] } },
              ],
            },
          },
        },
      ],
    });
  });
});
