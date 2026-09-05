import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  searchLDAPUserForProvisioning: vi.fn(),
  getConfigValue: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    privilegeAssignment: {
      findMany: mocks.findMany,
    },
  },
}));

vi.mock('@/lib/ldap', () => ({
  searchLDAPUserForProvisioning: mocks.searchLDAPUserForProvisioning,
}));

vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.getConfigValue,
}));

import {
  actorCanActOnStage,
  actorHasPermission,
  buildBreakGlassAuthorization,
  clearPrivilegeCache,
  resolveActorAuthorization,
  resolveReviewerAuthorization,
} from './core';

const facultyGroupDn = 'CN=UAR-Faculty,OU=Groups,DC=example,DC=test';
const directorGroupDn = 'CN=UAR-Directors,OU=Groups,DC=example,DC=test';
const adminGroupDn = 'CN=Domain Admins,OU=Groups,DC=example,DC=test';

const facultyAssignment = {
  permissionKey: 'access_requests.review.faculty',
  adGroupDns: [facultyGroupDn],
  updatedBy: null,
  updatedAt: new Date(),
};

const directorAssignment = {
  permissionKey: 'access_requests.review.director',
  adGroupDns: [directorGroupDn],
  updatedBy: null,
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  clearPrivilegeCache();
  mocks.getConfigValue.mockResolvedValue([]);
});

describe('resolveActorAuthorization', () => {
  it('grants legacy domain admins the full catalog', async () => {
    mocks.findMany.mockResolvedValue([facultyAssignment]);

    const auth = await resolveActorAuthorization('admin1', { isDomainAdmin: true });

    expect(auth.roles.has('system_administrator')).toBe(true);
    expect(auth.viaLegacyAdminFallback).toBe(true);
    expect(actorHasPermission(auth, 'vpn.manage')).toBe(true);
    expect(actorHasPermission(auth, 'access_requests.review.faculty')).toBe(true);
    expect(actorHasPermission(auth, 'appearance.manage')).toBe(true);
    expect(actorHasPermission(auth, 'break_glass.manage')).toBe(true);
  });

  it('grants nothing when no privilege maps groups (no LDAP call)', async () => {
    mocks.findMany.mockResolvedValue([{ ...facultyAssignment, adGroupDns: [] }]);

    const auth = await resolveActorAuthorization('regularuser', { isDomainAdmin: false });

    expect(auth.roles.size).toBe(0);
    expect(auth.permissions.size).toBe(0);
    expect(mocks.searchLDAPUserForProvisioning).not.toHaveBeenCalled();
  });

  it('grants mapped privileges through live directory membership', async () => {
    mocks.findMany.mockResolvedValue([facultyAssignment]);
    mocks.searchLDAPUserForProvisioning.mockResolvedValue({
      username: 'prof1',
      attributes: [{ type: 'memberOf', values: [facultyGroupDn] }, { type: 'userAccountControl', values: ['512'] }],
    });

    const auth = await resolveActorAuthorization('prof1', { isDomainAdmin: false });

    expect(actorHasPermission(auth, 'access_requests.review.faculty')).toBe(true);
    expect(actorHasPermission(auth, 'modules.manage')).toBe(false);
    expect(auth.roles.size).toBe(0);
  });

  it('performs one membership lookup even when several privileges map groups', async () => {
    mocks.findMany.mockResolvedValue([facultyAssignment, directorAssignment]);
    mocks.searchLDAPUserForProvisioning.mockResolvedValue({
      username: 'multi1',
      attributes: [{ type: 'memberOf', values: [facultyGroupDn.toUpperCase()] }, { type: 'userAccountControl', values: ['512'] }],
    });

    const auth = await resolveActorAuthorization('multi1', { isDomainAdmin: false });

    expect(mocks.searchLDAPUserForProvisioning).toHaveBeenCalledTimes(1);
    expect(actorHasPermission(auth, 'access_requests.review.faculty')).toBe(true);
    expect(actorHasPermission(auth, 'access_requests.review.director')).toBe(false);
  });

  it('fails open to legacy behavior for domain admins when the store is unreadable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findMany.mockRejectedValue(new Error('db down'));

    const auth = await resolveActorAuthorization('admin1', { isDomainAdmin: true });

    expect(auth.roles.has('system_administrator')).toBe(true);
    expect(actorHasPermission(auth, 'settings.manage')).toBe(true);
    consoleError.mockRestore();
  });

  it('skips assignments with invalid stored DNs instead of failing resolution', async () => {
    mocks.findMany.mockResolvedValue([
      { ...facultyAssignment, adGroupDns: ['not a dn'] },
      directorAssignment,
    ]);
    mocks.searchLDAPUserForProvisioning.mockResolvedValue({
      username: 'u1',
      attributes: [{ type: 'memberOf', values: [directorGroupDn] }, { type: 'userAccountControl', values: ['512'] }],
    });

    const auth = await resolveActorAuthorization('u1', { isDomainAdmin: false });

    expect(actorHasPermission(auth, 'access_requests.review.faculty')).toBe(false);
    expect(actorHasPermission(auth, 'access_requests.review.director')).toBe(true);
  });
});

describe('resolveReviewerAuthorization', () => {
  it('grants the full catalog to members of the configured legacy admin groups', async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.getConfigValue.mockResolvedValue([adminGroupDn]);
    mocks.searchLDAPUserForProvisioning.mockResolvedValue({
      username: 'admin1',
      attributes: [{ type: 'memberOf', values: [adminGroupDn] }, { type: 'userAccountControl', values: ['512'] }],
    });

    const auth = await resolveReviewerAuthorization('admin1');

    expect(auth.viaLegacyAdminFallback).toBe(true);
    expect(actorHasPermission(auth, 'settings.manage')).toBe(true);
  });

  it('is fail-closed when the directory lookup errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findMany.mockResolvedValue([facultyAssignment]);
    mocks.searchLDAPUserForProvisioning.mockRejectedValue(new Error('ldap down'));

    const auth = await resolveReviewerAuthorization('prof1');

    expect(auth.permissions.size).toBe(0);
    consoleError.mockRestore();
  });

  it('combines legacy fallback with mapped privileges', async () => {
    mocks.findMany.mockResolvedValue([facultyAssignment]);
    mocks.getConfigValue.mockResolvedValue([adminGroupDn]);
    mocks.searchLDAPUserForProvisioning.mockResolvedValue({
      username: 'both1',
      attributes: [{ type: 'memberOf', values: [adminGroupDn, facultyGroupDn] }, { type: 'userAccountControl', values: ['512'] }],
    });

    const auth = await resolveReviewerAuthorization('both1');

    expect(auth.viaLegacyAdminFallback).toBe(true);
    expect(actorHasPermission(auth, 'access_requests.review.faculty')).toBe(true);
  });

  it('expands action-only privilege mappings with their read prerequisites', async () => {
    mocks.findMany.mockResolvedValue([{ ...facultyAssignment, permissionKey: 'access_requests.provision' }]);
    mocks.searchLDAPUserForProvisioning.mockResolvedValue({
      username: 'provisioner',
      attributes: [{ type: 'memberOf', values: [facultyGroupDn] }, { type: 'userAccountControl', values: ['512'] }],
    });

    const auth = await resolveActorAuthorization('provisioner', { isDomainAdmin: false });

    expect(actorHasPermission(auth, 'access_requests.provision')).toBe(true);
    expect(actorHasPermission(auth, 'access_requests.read')).toBe(true);
  });

  it('expands user-management and session-revocation prerequisites', async () => {
    mocks.findMany.mockResolvedValue([
      { ...facultyAssignment, permissionKey: 'users.manage' },
      { ...directorAssignment, permissionKey: 'sessions.revoke', adGroupDns: [facultyGroupDn] },
    ]);
    mocks.searchLDAPUserForProvisioning.mockResolvedValue({
      username: 'operator',
      attributes: [{ type: 'memberOf', values: [facultyGroupDn] }, { type: 'userAccountControl', values: ['512'] }],
    });

    const auth = await resolveActorAuthorization('operator', { isDomainAdmin: false });

    expect(actorHasPermission(auth, 'users.read')).toBe(true);
    expect(actorHasPermission(auth, 'sessions.read')).toBe(true);
  });

  it.each([['disabled', '514'], ['missing', null], ['malformed', 'not-a-number']])(
    'fails closed for a %s directory account',
    async (_label, uac) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.findMany.mockResolvedValue([facultyAssignment]);
      mocks.searchLDAPUserForProvisioning.mockResolvedValue({
        username: 'prof1',
        attributes: [
          { type: 'memberOf', values: [facultyGroupDn] },
          ...(uac === null ? [] : [{ type: 'userAccountControl', values: [uac] }]),
        ],
      });

      const auth = await resolveReviewerAuthorization('prof1');

      expect(auth.permissions.size).toBe(0);
      consoleError.mockRestore();
    }
  );
});

describe('buildBreakGlassAuthorization', () => {
  it('grants the full catalog without any directory call', async () => {
    const auth = await buildBreakGlassAuthorization('breakglass');

    expect(auth.viaLocalBreakGlass).toBe(true);
    expect(actorHasPermission(auth, 'offboard.manage')).toBe(true);
    expect(mocks.searchLDAPUserForProvisioning).not.toHaveBeenCalled();
  });
});

describe('actorCanActOnStage', () => {
  it('lets system administrators act on any stage', async () => {
    mocks.findMany.mockResolvedValue([]);
    const auth = await resolveActorAuthorization('admin1', { isDomainAdmin: true });
    expect(actorCanActOnStage(auth, 'director')).toBe(true);
    expect(actorCanActOnStage(auth, 'faculty')).toBe(true);
  });

  it('requires the stage-bound privilege for mapped actors', async () => {
    mocks.findMany.mockResolvedValue([facultyAssignment]);
    mocks.searchLDAPUserForProvisioning.mockResolvedValue({
      username: 'prof1',
      attributes: [{ type: 'memberOf', values: [facultyGroupDn] }, { type: 'userAccountControl', values: ['512'] }],
    });
    const auth = await resolveActorAuthorization('prof1', { isDomainAdmin: false });

    expect(actorCanActOnStage(auth, 'faculty')).toBe(true);
    expect(actorCanActOnStage(auth, 'director')).toBe(false);
  });
});
