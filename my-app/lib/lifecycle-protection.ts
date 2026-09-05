import { getConfigValue } from '@/lib/config/resolver';
import { canonicalizeAdminGroupDn } from '@/lib/ldap/admin-groups';
import { getLDAPGroupAncestorDNs } from '@/lib/ldap';
import { prisma } from '@/lib/prisma';

type DirectoryUser = {
  objectName: string;
  attributes: Array<{ type: string; values: string[] }>;
};

const PROTECTED_BUILTIN_GROUP_CNS = new Set([
  'cn=administrators',
  'cn=domain admins',
  'cn=enterprise admins',
  'cn=schema admins',
  'cn=account operators',
  'cn=server operators',
  'cn=backup operators',
  'cn=print operators',
  'cn=dnsadmins',
  'cn=group policy creator owners',
  'cn=key admins',
  'cn=enterprise key admins',
]);

const PROTECTED_PRIMARY_GROUP_RIDS = new Set([
  '512', // Domain Admins
  '518', // Schema Admins
  '519', // Enterprise Admins
  '520', // Group Policy Creator Owners
  '526', // Key Admins
  '527', // Enterprise Key Admins
  '544', // Administrators
  '548', // Account Operators
  '549', // Server Operators
  '550', // Print Operators
  '551', // Backup Operators
]);

export type LifecycleAccountProtectionAssertion = {
  protectedGroupDns: string[];
  protectedPrimaryGroupRids: string[];
};

function isProtectedBuiltinGroup(canonicalGroupDn: string): boolean {
  return PROTECTED_BUILTIN_GROUP_CNS.has(canonicalGroupDn.split(',')[0]);
}

function values(user: DirectoryUser, attributeName: string): string[] {
  return user.attributes.find(
    (attribute) => attribute.type.toLowerCase() === attributeName.toLowerCase()
  )?.values ?? [];
}

async function protectedGroupDns(): Promise<Set<string>> {
  const [configuredAdminGroups, assignments] = await Promise.all([
    getConfigValue<string[]>('ldap.adminGroups'),
    prisma.privilegeAssignment.findMany({ select: { adGroupDns: true } }),
  ]);
  return new Set(
    [...configuredAdminGroups, ...assignments.flatMap((assignment) => assignment.adGroupDns)]
      .map((groupDn) => canonicalizeAdminGroupDn(groupDn))
  );
}

export async function assertLifecycleGroupNotProtected(groupDn: string): Promise<void> {
  const canonicalGroupDn = canonicalizeAdminGroupDn(groupDn);
  const [protectedGroups, ancestorDns] = await Promise.all([
    protectedGroupDns(),
    getLDAPGroupAncestorDNs(groupDn),
  ]);
  if (
    isProtectedBuiltinGroup(canonicalGroupDn)
    || protectedGroups.has(canonicalGroupDn)
    || ancestorDns.some((ancestorDn) => {
      const canonicalAncestorDn = canonicalizeAdminGroupDn(ancestorDn);
      return isProtectedBuiltinGroup(canonicalAncestorDn) || protectedGroups.has(canonicalAncestorDn);
    })
  ) {
    throw new Error('Administrative and privilege-bearing groups cannot be changed through Account Lifecycle.');
  }
}

export async function assertLifecycleAccountNotProtected(
  user: DirectoryUser
): Promise<LifecycleAccountProtectionAssertion> {
  const adminCount = values(user, 'adminCount')[0];
  const primaryGroupId = values(user, 'primaryGroupID')[0];
  const criticalSystemObject = values(user, 'isCriticalSystemObject')[0]?.toLowerCase();
  if (adminCount === '1' || PROTECTED_PRIMARY_GROUP_RIDS.has(primaryGroupId) || criticalSystemObject === 'true') {
    throw new Error('Protected directory administrator accounts cannot be changed through lifecycle override.');
  }

  const protectedGroups = await protectedGroupDns();
  const directGroupDns = values(user, 'memberOf');
  for (const groupDn of directGroupDns) {
    const canonicalGroupDn = canonicalizeAdminGroupDn(groupDn);
    if (isProtectedBuiltinGroup(canonicalGroupDn) || protectedGroups.has(canonicalGroupDn)) {
      throw new Error('Protected directory administrator accounts cannot be changed through lifecycle override.');
    }
  }

  const ancestorDns = (await Promise.all(
    directGroupDns.map((groupDn) => getLDAPGroupAncestorDNs(groupDn))
  )).flat();
  for (const ancestorDn of ancestorDns) {
    const canonicalAncestorDn = canonicalizeAdminGroupDn(ancestorDn);
    if (isProtectedBuiltinGroup(canonicalAncestorDn) || protectedGroups.has(canonicalAncestorDn)) {
      throw new Error('Protected directory administrator accounts cannot be changed through lifecycle override.');
    }
  }

  // The deletion helper applies this same policy in its final same-connection
  // AD search before a GUID-targeted delete. AD cannot atomically bind these
  // requests; external directory writers can still change state between them.
  return {
    protectedGroupDns: [...protectedGroups],
    protectedPrimaryGroupRids: [...PROTECTED_PRIMARY_GROUP_RIDS],
  };
}
