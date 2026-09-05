import { describe, expect, it } from 'vitest';

import { ALL_PERMISSION_KEYS, type PermissionKey } from './permissions';
import {
  ADMIN_SEARCH_SCOPE_PERMISSIONS,
  findAdminSearchCoverageGaps,
  getAvailableAdminSearchTypes,
} from './search-access';

const directorDn = 'CN=svc_uar_director,OU=KaminoGroups,DC=sdc,DC=cpp';
const facultyDn = 'CN=svc_uar_faculty,OU=KaminoGroups,DC=sdc,DC=cpp';

describe('admin search operational coverage', () => {
  it('exposes only the search areas covered by effective permissions', () => {
    expect(
      getAvailableAdminSearchTypes(new Set<PermissionKey>([
        'admin.search',
        'access_requests.read',
        'tickets.read',
      ]))
    ).toEqual(['requests', 'tickets']);
  });

  it('reports every missing data privilege for a partially mapped search group', () => {
    const gaps = findAdminSearchCoverageGaps([
      { permissionKey: 'admin.search', adGroupDns: [directorDn] },
      { permissionKey: 'access_requests.read', adGroupDns: [directorDn] },
      { permissionKey: 'tickets.respond', adGroupDns: [directorDn] },
    ]);

    expect(gaps).toEqual([
      {
        groupDn: directorDn,
        missingPermissions: [
          ADMIN_SEARCH_SCOPE_PERMISSIONS.lifecycle,
          ADMIN_SEARCH_SCOPE_PERMISSIONS.vpn,
          ADMIN_SEARCH_SCOPE_PERMISSIONS.audit,
        ],
      },
    ]);
  });

  it('treats the approved all-38 mapping for both groups as gap-free', () => {
    const assignments = ALL_PERMISSION_KEYS.map((permissionKey) => ({
      permissionKey,
      adGroupDns: [directorDn, facultyDn],
    }));

    expect(findAdminSearchCoverageGaps(assignments)).toEqual([]);
    expect(getAvailableAdminSearchTypes(new Set(ALL_PERMISSION_KEYS))).toEqual([
      'requests',
      'lifecycle',
      'vpn',
      'tickets',
      'audit',
    ]);
  });

  it('uses the same DN canonicalization as live authorization', () => {
    const spacedDn = 'CN=Search Operators, OU=Groups, DC=example, DC=test';
    const compactDn = 'cn=search operators,ou=groups,dc=example,dc=test';
    const assignments = ALL_PERMISSION_KEYS.map((permissionKey) => ({
      permissionKey,
      adGroupDns: [permissionKey === 'admin.search' ? spacedDn : compactDn],
    }));

    expect(findAdminSearchCoverageGaps(assignments)).toEqual([]);
  });
});
