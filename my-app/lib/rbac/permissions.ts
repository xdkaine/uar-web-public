/**
 * Code-defined privilege catalog. Privileges exist only if registered here;
 * PrivilegeAssignment rows reference these keys and are validated against this
 * catalog before writes are accepted (see app/api/admin/config/privileges).
 * Each privilege maps directly to AD group DNs - there are no intermediate
 * roles (privilege-first RBAC).
 */
export const PERMISSIONS = {
  'settings.manage': 'Update general system settings',
  'appearance.manage': 'Publish portal appearance and managed page content',
  'break_glass.manage': 'Manage local break-glass administrator accounts',
  'modules.manage': 'Enable and disable capability modules',
  'governance.configure': 'Edit request types, review workflows, and reviewer requirements',
  'messages.manage': 'Edit operational message templates',
  'roles.manage': 'Map privileges to directory groups (privilege assignments)',
  'directory.configure': 'Edit directory and email connection configuration',
  'access_requests.read': 'View the access request queue and details',
  'access_requests.review.director': 'Act on requests in the director review stage',
  'access_requests.review.faculty': 'Approve or reject requests at the faculty review stage',
  'access_requests.respond': 'Comment on requests and notify requesters',
  'access_requests.provision': 'Manually assign accounts, resend credentials, and reset request passwords',
  'vpn.manage': 'Mutate VPN accounts, imports, and status',
  'vpn.delete': 'Permanently delete a confirmed revoked VPN account record',
  'audit.read': 'View audit logs and action history',
  'audit.export': 'Export audit logs and evidence as CSV',
  'tickets.assign': 'Assign and reassign support tickets to users or approved groups',
  'tickets.configure': 'Manage allowed ticket subject/assignee groups and routing defaults',
  'tickets.read': 'View support tickets and attachments in the admin queue',
  'tickets.respond': 'Post staff responses and change ticket statuses',
  'users.read': 'Browse and inspect directory users and groups',
  'users.manage': 'Mutate directory users: enable/disable, group membership, comments',
  'events.manage': 'Create, edit, and remove events',
  'batch.manage': 'Create and manage batch account creation',
  'blocklist.manage': 'Manage the access request blocklist',
  'sessions.read': 'View active portal sessions',
  'sessions.revoke': 'Force sign-out of portal sessions',
  'lifecycle.read': 'View account lifecycle inventory, operations, and history',
  'lifecycle.manage': 'Manage queued lifecycle actions: retry, cancel, process',
  'lifecycle.delete': 'Permanently delete a confirmed disabled Active Directory account',
  'lifecycle.delete_unmanaged': 'Permanently delete reviewed disabled AD accounts that have no portal owner',
  'lifecycle.override': 'Run a directory-only lifecycle exception for an unlinked AD account',
  'sync.read': 'View account synchronization status',
  'communications.manage': 'Run mass email campaigns and manual notifications',
  'offboard.manage': 'Create, process, and roll back offboarding campaigns',
  'offboard.execute_direct': 'Execute reviewed immediate offboarding without a verification grace period',
  'password_expiration.read': 'View the password expiration outlook',
  'password_expiration.manage': 'Trigger password expiration notifications and processing',
  'ratelimits.manage': 'View and override rate limits',
  'admin.search': 'Use global admin search across users, requests, and tickets',
  'service_alerts.read': 'View service alerts raised by monitoring',
  'service_alerts.manage': 'Dismiss and resolve service alerts',
  'automation.manage': 'Create, edit, enable, and disable automation rules',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/**
 * Mutation capabilities imply their corresponding read capability. Keeping
 * this relationship in the catalog means an operator can always see the
 * records an action is allowed to change; routes still enforce their own
 * capability independently.
 */
export const PERMISSION_PREREQUISITES: Partial<Record<PermissionKey, readonly PermissionKey[]>> = {
  'access_requests.review.director': ['access_requests.read'],
  'access_requests.review.faculty': ['access_requests.read'],
  'access_requests.respond': ['access_requests.read'],
  'access_requests.provision': ['access_requests.read'],
  'audit.export': ['audit.read'],
  'tickets.assign': ['tickets.read'],
  'tickets.configure': ['tickets.read'],
  'tickets.respond': ['tickets.read'],
  'users.manage': ['users.read'],
  'sessions.revoke': ['sessions.read'],
  'lifecycle.manage': ['lifecycle.read', 'users.read'],
  'lifecycle.delete': ['lifecycle.manage', 'users.manage'],
  'lifecycle.delete_unmanaged': ['lifecycle.delete', 'lifecycle.override'],
  'vpn.delete': ['vpn.manage', 'lifecycle.manage'],
  'lifecycle.override': ['lifecycle.manage', 'users.manage'],
  'offboard.execute_direct': ['offboard.manage', 'lifecycle.manage', 'users.manage', 'vpn.manage', 'sessions.revoke'],
  'password_expiration.manage': ['password_expiration.read'],
  'service_alerts.manage': ['service_alerts.read'],
};

/** Expand a directly-assigned privilege set through all transitive prerequisites. */
export function expandPermissionPrerequisites(
  directPermissions: Iterable<PermissionKey>
): Set<PermissionKey> {
  const expanded = new Set<PermissionKey>(directPermissions);
  const pending = [...expanded];

  while (pending.length > 0) {
    const permission = pending.pop();
    if (!permission) continue;
    for (const prerequisite of PERMISSION_PREREQUISITES[permission] ?? []) {
      if (!expanded.has(prerequisite)) {
        expanded.add(prerequisite);
        pending.push(prerequisite);
      }
    }
  }

  return expanded;
}

export function isValidPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/** Roles seeded by migration that carry special compatibility semantics. */
export const SYSTEM_ADMINISTRATOR_ROLE_KEY = 'system_administrator';

/**
 * Reviewer role keys a governance stage may require. Limited to the seeded
 * review roles so a typo cannot publish a stage nobody can action; system
 * administrators can always act on any stage.
 */
export const KNOWN_REVIEWER_ROLE_KEYS = ['director', 'faculty'] as const;

export type ReviewerRoleKey = (typeof KNOWN_REVIEWER_ROLE_KEYS)[number];

/**
 * Stage reviewer role keys supported by the constrained governance catalog
 * (lib/workflow/schema.ts). Each maps to the permission that satisfies the
 * stage requirement.
 */
export const STAGE_ROLE_PERMISSIONS: Record<string, PermissionKey> = {
  director: 'access_requests.review.director',
  faculty: 'access_requests.review.faculty',
};
