import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfigValue: vi.fn(),
  getLDAPGroupAncestorDNs: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock('@/lib/config/resolver', () => ({ getConfigValue: mocks.getConfigValue }));
vi.mock('@/lib/ldap', () => ({ getLDAPGroupAncestorDNs: mocks.getLDAPGroupAncestorDNs }));
vi.mock('@/lib/prisma', () => ({
  prisma: { privilegeAssignment: { findMany: mocks.findMany } },
}));

import { assertLifecycleAccountNotProtected, assertLifecycleGroupNotProtected } from './lifecycle-protection';

const adminGroupDn = 'CN=Domain Admins,CN=Users,DC=example,DC=test';

function directoryUser(attributes: Array<{ type: string; values: string[] }>) {
  return { objectName: 'CN=fixture,OU=Users,DC=example,DC=test', attributes };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConfigValue.mockResolvedValue([adminGroupDn]);
  mocks.getLDAPGroupAncestorDNs.mockResolvedValue([]);
  mocks.findMany.mockResolvedValue([]);
});

describe('lifecycle directory protection', () => {
  it('blocks disabled administrator-group members independently of enabled state', async () => {
    await expect(assertLifecycleAccountNotProtected(directoryUser([
      { type: 'userAccountControl', values: ['514'] },
      { type: 'memberOf', values: [adminGroupDn] },
    ]))).rejects.toThrow('Protected directory administrator');
  });

  it('blocks adminCount and Domain Admin primary-group accounts', async () => {
    await expect(assertLifecycleAccountNotProtected(directoryUser([
      { type: 'adminCount', values: ['1'] },
      { type: 'memberOf', values: [] },
    ]))).rejects.toThrow('Protected directory administrator');
    await expect(assertLifecycleAccountNotProtected(directoryUser([
      { type: 'primaryGroupID', values: ['512'] },
      { type: 'memberOf', values: [] },
    ]))).rejects.toThrow('Protected directory administrator');
  });

  it('blocks other protected administrator primary-group RIDs', async () => {
    for (const primaryGroupID of ['518', '519', '520', '526', '527', '544', '548', '549', '550', '551']) {
      await expect(assertLifecycleAccountNotProtected(directoryUser([
        { type: 'primaryGroupID', values: [primaryGroupID] },
        { type: 'memberOf', values: [] },
      ]))).rejects.toThrow('Protected directory administrator');
    }
  });

  it('fails closed when protected-group policy cannot be loaded', async () => {
    mocks.findMany.mockRejectedValue(new Error('privilege store unavailable'));
    await expect(assertLifecycleAccountNotProtected(directoryUser([
      { type: 'memberOf', values: [] },
    ]))).rejects.toThrow('privilege store unavailable');
  });

  it('allows an ordinary account when protection policy is readable', async () => {
    await expect(assertLifecycleAccountNotProtected(directoryUser([
      { type: 'memberOf', values: ['CN=Researchers,OU=Groups,DC=example,DC=test'] },
    ]))).resolves.toMatchObject({
      protectedGroupDns: [adminGroupDn.toLowerCase()],
      protectedPrimaryGroupRids: expect.arrayContaining(['512', '526', '527']),
    });
  });

  it('blocks a nested administrator before adminCount propagation', async () => {
    mocks.getLDAPGroupAncestorDNs.mockResolvedValue([
      'CN=Intermediate,OU=Groups,DC=example,DC=test',
      adminGroupDn,
    ]);
    await expect(assertLifecycleAccountNotProtected(directoryUser([
      { type: 'adminCount', values: ['0'] },
      { type: 'primaryGroupID', values: ['513'] },
      { type: 'memberOf', values: ['CN=Research Leads,OU=Groups,DC=example,DC=test'] },
    ]))).rejects.toThrow('Protected directory administrator');
  });

  it('rechecks mapped privilege groups by canonical DN', async () => {
    mocks.findMany.mockResolvedValue([{ adGroupDns: ['CN=Lifecycle Operators,OU=Groups,DC=example,DC=test'] }]);
    await expect(assertLifecycleGroupNotProtected('cn=lifecycle operators,ou=groups,dc=EXAMPLE,dc=TEST'))
      .rejects.toThrow('privilege-bearing groups');
  });

  it('blocks built-in privileged groups even when application configuration omits them', async () => {
    mocks.getConfigValue.mockResolvedValue([]);
    await expect(assertLifecycleGroupNotProtected('CN=Backup Operators,CN=Builtin,DC=example,DC=test'))
      .rejects.toThrow('privilege-bearing groups');
  });

  it('blocks groups nested transitively under a built-in protected group', async () => {
    mocks.getConfigValue.mockResolvedValue([]);
    mocks.getLDAPGroupAncestorDNs.mockResolvedValue([
      'CN=Intermediate,OU=Groups,DC=example,DC=test',
      'CN=Domain Admins,CN=Users,DC=example,DC=test',
    ]);
    await expect(assertLifecycleGroupNotProtected('CN=Research Users,OU=Groups,DC=example,DC=test'))
      .rejects.toThrow('privilege-bearing groups');
  });

  it('blocks groups nested transitively under a mapped privilege group', async () => {
    const mappedGroup = 'CN=Lifecycle Operators,OU=Groups,DC=example,DC=test';
    mocks.findMany.mockResolvedValue([{ adGroupDns: [mappedGroup] }]);
    mocks.getLDAPGroupAncestorDNs.mockResolvedValue([mappedGroup.toLowerCase()]);
    await expect(assertLifecycleGroupNotProtected('CN=Research Users,OU=Groups,DC=example,DC=test'))
      .rejects.toThrow('privilege-bearing groups');
  });

  it('fails closed when live ancestry cannot be read', async () => {
    mocks.getLDAPGroupAncestorDNs.mockRejectedValue(new Error('directory ancestry unavailable'));
    await expect(assertLifecycleGroupNotProtected('CN=Research Users,OU=Groups,DC=example,DC=test'))
      .rejects.toThrow('directory ancestry unavailable');
  });
});
