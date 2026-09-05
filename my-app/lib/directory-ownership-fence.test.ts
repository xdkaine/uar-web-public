import { describe, expect, it, vi } from 'vitest';

import {
  acquireDirectoryOwnershipFence,
  directoryObjectIdentity,
  directoryObjectIdentityMatches,
  findBatchDirectoryOwnershipClaims,
} from './directory-ownership-fence';

describe('directory ownership fence', () => {
  it('uses the lifecycle deletion username lock namespace', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ lock_acquired: 'locked' }]);
    await acquireDirectoryOwnershipFence({ $queryRaw: queryRaw } as never, ' Person1 ');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(String(queryRaw.mock.calls[0][0])).toContain('pg_advisory_xact_lock');
    expect(queryRaw.mock.calls[0].slice(1)).toEqual(['person1', 873211]);
  });

  it('requires immutable GUID and DN equality', () => {
    const original = {
      objectName: 'CN=Person1,OU=Users,DC=example,DC=test',
      attributes: [{ type: 'objectGUID', values: ['guid-1'] }],
    };
    const identity = directoryObjectIdentity(original);
    expect(identity).toEqual({ dn: original.objectName, objectGuid: 'guid-1' });
    expect(directoryObjectIdentityMatches(identity!, original)).toBe(true);
    expect(directoryObjectIdentityMatches(identity!, {
      ...original,
      attributes: [{ type: 'objectGUID', values: ['guid-2'] }],
    })).toBe(false);
    expect(directoryObjectIdentityMatches(identity!, null)).toBe(false);
  });

  it('finds only active batch-item ownership in the requested account lane', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'item-1', batchId: 'batch-1', accountType: 'AD', status: 'completed' }]);
    const claims = await findBatchDirectoryOwnershipClaims(
      { batchAccountItem: { findMany } } as never,
      ' Person1 ',
      'AD'
    );

    expect(claims).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        accountType: { in: ['AD', 'BOTH'] },
        lifecycleOwnerKind: 'batch_item',
        accessRequestId: null,
        ldapUsername: { equals: 'person1', mode: 'insensitive' },
      }),
      take: 2,
    }));
  });
});
