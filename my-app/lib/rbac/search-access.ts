import {
  expandPermissionPrerequisites,
  isValidPermissionKey,
  type PermissionKey,
} from './permissions';
import { canonicalizeAdminGroupDn } from '@/lib/ldap/admin-groups';

export const ADMIN_SEARCH_SCOPE_PERMISSIONS = {
  requests: 'access_requests.read',
  lifecycle: 'lifecycle.read',
  vpn: 'vpn.manage',
  tickets: 'tickets.read',
  audit: 'audit.read',
} as const satisfies Record<string, PermissionKey>;

export type AdminSearchScope = keyof typeof ADMIN_SEARCH_SCOPE_PERMISSIONS;
export type AdminSearchType = 'all' | AdminSearchScope;

export const ADMIN_SEARCH_SCOPES = Object.keys(
  ADMIN_SEARCH_SCOPE_PERMISSIONS
) as AdminSearchScope[];

export function isAdminSearchType(value: string): value is AdminSearchType {
  return value === 'all' || Object.prototype.hasOwnProperty.call(ADMIN_SEARCH_SCOPE_PERMISSIONS, value);
}

export function getAvailableAdminSearchTypes(
  permissions: ReadonlySet<string>
): AdminSearchScope[] {
  return ADMIN_SEARCH_SCOPES.filter((scope) =>
    permissions.has(ADMIN_SEARCH_SCOPE_PERMISSIONS[scope])
  );
}

interface PrivilegeMapping {
  permissionKey: string;
  adGroupDns: readonly string[];
}

export interface AdminSearchCoverageGap {
  groupDn: string;
  missingPermissions: PermissionKey[];
}

/**
 * Find directory groups that can open Global Search but cannot search every
 * advertised data area. This is an operator-facing configuration diagnostic;
 * route authorization remains fail-closed independently.
 */
export function findAdminSearchCoverageGaps(
  assignments: readonly PrivilegeMapping[]
): AdminSearchCoverageGap[] {
  const displayDnByCanonical = new Map<string, string>();
  const directPermissionsByGroup = new Map<string, Set<PermissionKey>>();

  for (const assignment of assignments) {
    if (!isValidPermissionKey(assignment.permissionKey)) continue;
    for (const rawDn of assignment.adGroupDns) {
      const groupDn = rawDn.trim();
      if (!groupDn) continue;
      let canonical: string;
      try {
        canonical = canonicalizeAdminGroupDn(groupDn);
      } catch {
        // Invalid stored DNs grant no runtime access and cannot contribute to
        // a meaningful operational-coverage diagnostic.
        continue;
      }
      displayDnByCanonical.set(canonical, displayDnByCanonical.get(canonical) ?? groupDn);
      const permissions = directPermissionsByGroup.get(canonical) ?? new Set<PermissionKey>();
      permissions.add(assignment.permissionKey);
      directPermissionsByGroup.set(canonical, permissions);
    }
  }

  const gaps: AdminSearchCoverageGap[] = [];
  for (const [canonical, directPermissions] of directPermissionsByGroup) {
    if (!directPermissions.has('admin.search')) continue;
    const effectivePermissions = expandPermissionPrerequisites(directPermissions);
    const missingPermissions = ADMIN_SEARCH_SCOPES
      .map((scope) => ADMIN_SEARCH_SCOPE_PERMISSIONS[scope])
      .filter((permission) => !effectivePermissions.has(permission));
    if (missingPermissions.length > 0) {
      gaps.push({
        groupDn: displayDnByCanonical.get(canonical) ?? canonical,
        missingPermissions,
      });
    }
  }

  return gaps.sort((left, right) => left.groupDn.localeCompare(right.groupDn));
}
