import { prisma } from '@/lib/prisma';
import { isMemberOfAdminGroup } from '@/lib/ldap/admin-groups';
import {
  ALL_PERMISSION_KEYS,
  expandPermissionPrerequisites,
  isValidPermissionKey,
  STAGE_ROLE_PERMISSIONS,
  SYSTEM_ADMINISTRATOR_ROLE_KEY,
  type PermissionKey,
} from './permissions';

export interface ActorAuthorization {
  username: string;
  /**
   * Role keys the actor holds. Privilege-first RBAC retires intermediate
   * roles: only the synthetic system_administrator key appears, and only for
   * legacy domain administrators and break-glass accounts.
   */
  roles: Set<string>;
  /** Privilege keys granted through AD group mappings (or the full catalog). */
  permissions: Set<PermissionKey>;
  /**
   * True when the legacy domain-admin check granted system_administrator.
   * Surfaced so diagnostics can distinguish mapped access from inherited
   * legacy access while directory mappings are migrated (ADR-0004).
   */
  viaLegacyAdminFallback: boolean;
  /**
   * True when authorization derives from an active local break-glass account
   * instead of any directory lookup (ADR-0009). Mutually exclusive with the
   * legacy fallback by construction.
   */
  viaLocalBreakGlass?: boolean;
}

export interface PrivilegeAssignmentRow {
  permissionKey: string;
  adGroupDns: string[];
  updatedBy: string | null;
  updatedAt: Date;
}

let cachedAssignments: PrivilegeAssignmentRow[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 30000;

async function loadAssignments(): Promise<PrivilegeAssignmentRow[]> {
  if (cachedAssignments && Date.now() - lastFetchTime < CACHE_TTL) {
    return cachedAssignments;
  }
  try {
    const rows = await prisma.privilegeAssignment.findMany();
    cachedAssignments = rows.map((row) => ({
      permissionKey: row.permissionKey,
      adGroupDns: Array.isArray(row.adGroupDns) ? row.adGroupDns : [],
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    }));
    lastFetchTime = Date.now();
    return cachedAssignments;
  } catch (error) {
    // Fail open: an unreadable privilege store must not lock existing domain
    // administrators out of the portal. Legacy behavior (domain admin = full
    // access) applies whenever privilege data cannot be resolved; mapped
    // users simply resolve no privileges until the store is readable again.
    console.error('[RBAC] Failed to load privilege assignments, using legacy fallback:', error);
    return [];
  }
}

export function clearPrivilegeCache(): void {
  cachedAssignments = null;
  lastFetchTime = 0;
}

/**
 * Backward-compatible alias used by the legacy roles route.
 */
export function clearRoleDefinitionCache(): void {
  clearPrivilegeCache();
}

export async function getAllPrivilegeAssignments(): Promise<PrivilegeAssignmentRow[]> {
  return loadAssignments();
}

function grantFullCatalog(auth: ActorAuthorization): void {
  auth.roles.add(SYSTEM_ADMINISTRATOR_ROLE_KEY);
  for (const permission of ALL_PERMISSION_KEYS) {
    auth.permissions.add(permission);
  }
}

function emptyAuthorization(username: string): ActorAuthorization {
  return {
    username,
    roles: new Set<string>(),
    permissions: new Set<PermissionKey>(),
    viaLegacyAdminFallback: false,
  };
}

/**
 * Match the actor's memberOf DNs against privilege assignments using the
 * hardened DN canonicalizer from lib/ldap/admin-groups.ts (accepts a
 * JSON-array configuration string, compares canonically, case-insensitive
 * with escape handling). Invalid stored DNs never fail resolution; the
 * privilege simply does not match until its mapping is corrected.
 */
function resolvePrivilegesFromMemberOf(
  memberOf: string[],
  assignments: PrivilegeAssignmentRow[]
): Set<PermissionKey> {
  const permissions = new Set<PermissionKey>();
  for (const assignment of assignments) {
    if (assignment.adGroupDns.length === 0) continue;
    if (!isValidPermissionKey(assignment.permissionKey)) continue;
    try {
      if (isMemberOfAdminGroup(memberOf, JSON.stringify(assignment.adGroupDns))) {
        permissions.add(assignment.permissionKey);
      }
    } catch {
      // Invalid stored DNs must not fail authorization resolution.
    }
  }
  return permissions;
}

async function fetchMemberOf(username: string): Promise<string[] | null> {
  try {
    const { searchLDAPUserForProvisioning } = await import('@/lib/ldap');
    const { ldapAccountIsEnabled } = await import('@/lib/ldap/account-status');
    const ldapUser = await searchLDAPUserForProvisioning(username);
    if (!ldapUser?.attributes || !ldapAccountIsEnabled(ldapUser.attributes)) {
      console.error('[RBAC] Directory identity is missing, disabled, or has invalid account status');
      return null;
    }
    const memberOfAttribute = ldapUser?.attributes?.find(
      (attribute: { type: string }) => attribute.type === 'memberOf'
    );
    return Array.isArray(memberOfAttribute?.values) ? memberOfAttribute.values : [];
  } catch (error) {
    console.error('[RBAC] Failed to resolve directory group memberships:', error);
    return null;
  }
}

/**
 * Resolve the authorization context for an actor.
 *
 * Resolution order:
 *   1. Legacy compatibility - the live LDAP domain-admin check performed by
 *      adminAuth grants the full catalog exactly as it granted full access
 *      before RBAC existed. This keeps current admins fully functional and is
 *      also the failure-mode fallback when privilege data is unreadable.
 *   2. Privilege mappings - ONE live memberOf lookup matched against every
 *      PrivilegeAssignment's configured AD group DNs. There are no
 *      intermediate roles: a privilege is granted when any of its mapped
 *      groups contains the actor.
 */
export async function resolveActorAuthorization(
  username: string,
  options: { isDomainAdmin: boolean }
): Promise<ActorAuthorization> {
  const auth = emptyAuthorization(username);
  const assignments = await loadAssignments();

  if (options.isDomainAdmin) {
    grantFullCatalog(auth);
    auth.viaLegacyAdminFallback = true;
    return auth;
  }

  const mappable = assignments.filter((assignment) => assignment.adGroupDns.length > 0);
  if (mappable.length === 0) {
    return auth;
  }

  const memberOf = await fetchMemberOf(username);
  if (!memberOf) return auth;

  auth.permissions = expandPermissionPrerequisites(
    resolvePrivilegesFromMemberOf(memberOf, assignments)
  );
  return auth;
}

export function actorHasPermission(auth: ActorAuthorization | null, permission: PermissionKey): boolean {
  return !!auth && auth.permissions.has(permission);
}

/**
 * Authorization for an authenticated local break-glass session (ADR-0009).
 * The account's active state is verified by the caller before invoking this;
 * the grant is the full catalog so break-glass administrators remain
 * functional while the directory is unavailable. No LDAP call participates.
 */
export async function buildBreakGlassAuthorization(username: string): Promise<ActorAuthorization> {
  const auth = emptyAuthorization(username);
  auth.viaLocalBreakGlass = true;
  grantFullCatalog(auth);
  return auth;
}

/**
 * Resolve authorization from ONE live directory lookup, without requiring the
 * actor to be a domain administrator (ADR-0006).
 *
 * - Legacy compatibility: members of the configured domain-admin groups
 *   (ldap.adminGroups / LDAP_ADMIN_GROUPS) still receive the full catalog -
 *   unchanged access for existing admins.
 * - Privilege mappings: each PrivilegeAssignment's adGroupDns is matched
 *   canonically against the same memberOf set.
 *
 * Fail-closed: directory errors or missing memberships yield an
 * authorization with zero privileges (never an implicit grant).
 */
export async function resolveReviewerAuthorization(username: string): Promise<ActorAuthorization> {
  const auth = emptyAuthorization(username);
  const assignments = await loadAssignments();

  const memberOf = await fetchMemberOf(username);
  if (!memberOf) {
    console.error('[RBAC] Directory lookup failed during reviewer resolution');
    return auth;
  }

  // Legacy fallback against the configured admin group list.
  try {
    const { getConfigValue } = await import('@/lib/config/resolver');
    const adminGroups = await getConfigValue<string[]>('ldap.adminGroups');
    if (adminGroups.length > 0 && isMemberOfAdminGroup(memberOf, JSON.stringify(adminGroups))) {
      grantFullCatalog(auth);
      auth.viaLegacyAdminFallback = true;
    }
  } catch (error) {
    console.error('[RBAC] Failed to resolve admin-group configuration:', error);
  }

  const mapped = expandPermissionPrerequisites(
    resolvePrivilegesFromMemberOf(memberOf, assignments)
  );
  for (const permission of mapped) {
    auth.permissions.add(permission);
  }

  return auth;
}

/**
 * Whether the actor may act on a governance stage requiring `reviewerRoleKey`.
 * System administrators can act on every stage; other actors need the
 * privilege bound to that stage's reviewer role.
 */
export function actorCanActOnStage(
  auth: ActorAuthorization | null,
  reviewerRoleKey: string
): boolean {
  if (!auth) return false;
  if (auth.roles.has(SYSTEM_ADMINISTRATOR_ROLE_KEY)) return true;
  const permission = STAGE_ROLE_PERMISSIONS[reviewerRoleKey];
  return !!permission && auth.permissions.has(permission);
}
