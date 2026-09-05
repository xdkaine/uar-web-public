import { describe, expect, it, vi } from 'vitest';

import { acquireVpnOwnershipFence } from './vpn-ownership-fence';

describe('VPN ownership fence', () => {
  it('uses the dedicated VPN ownership namespace', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ lock_acquired: 'locked' }]);

    await acquireVpnOwnershipFence({ $queryRaw: queryRaw } as never, ' VpnPerson ');

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(String(queryRaw.mock.calls[0][0])).toContain('pg_advisory_xact_lock');
    expect(queryRaw.mock.calls[0].slice(1)).toEqual(['vpnperson', 873212]);
  });

  it('rejects a blank VPN username before querying', async () => {
    const queryRaw = vi.fn();

    await expect(acquireVpnOwnershipFence({ $queryRaw: queryRaw } as never, '  '))
      .rejects.toThrow('A VPN username is required for ownership locking');
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
