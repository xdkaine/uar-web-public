import { describe, expect, it } from 'vitest';

import { isForbiddenProbeAddress, validateEndpointDraft } from './endpoint-policy';

describe('monitored endpoint policy', () => {
  it('applies safe Proxmox and TrueNAS presets', () => {
    expect(validateEndpointDraft({ name: 'PVE 1', preset: 'proxmox', host: '10.0.0.10' })).toMatchObject({
      ok: true,
      value: { protocol: 'https', port: 8006, path: '/api2/json/version' },
    });
    expect(validateEndpointDraft({ name: 'NAS', preset: 'truenas', host: 'nas.example.edu' })).toMatchObject({
      ok: true,
      value: { protocol: 'https', port: 443, path: '/api/v2.0/system/state' },
    });
  });

  it('rejects URL syntax, credentials, and traversal in configured hosts and paths', () => {
    expect(validateEndpointDraft({ name: 'bad', preset: 'generic_https', host: 'https://host.test', path: '/' }).ok).toBe(false);
    expect(validateEndpointDraft({ name: 'bad', preset: 'generic_https', host: 'user@host.test', path: '/' }).ok).toBe(false);
    expect(validateEndpointDraft({ name: 'bad', preset: 'generic_https', host: 'host.test', path: '/../secret' }).ok).toBe(false);
  });

  it.each(['127.0.0.1', '::1', '0.0.0.0', '169.254.169.254', '224.0.0.1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254'])(
    'blocks special-use destination %s',
    (address) => expect(isForbiddenProbeAddress(address)).toBe(true)
  );

  it.each(['10.10.1.4', '192.168.50.2', '172.20.1.2', '203.0.113.10'])(
    'allows explicitly registered private or unicast destination %s',
    (address) => expect(isForbiddenProbeAddress(address)).toBe(false)
  );
});
