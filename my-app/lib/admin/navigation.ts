/**
 * Single source of truth for admin navigation. The sidebar, command palette,
 * overview page, and legacy ?tab= redirects all derive from this registry so
 * routing, permissions, and module gating stay in one place.
 *
 * Every entry carries a `permission` (ADR-0011/ADR-0015): mapped users see
 * exactly the console entries their privileges cover, while legacy system
 * administrators and break-glass accounts hold the full catalog. `moduleId`
 * ties an entry to a capability module (lib/modules/registry.ts) - when that
 * module is disabled the entry renders grayed out instead of navigating.
 */
import {
  Activity,
  Ban,
  Calendar,
  ClipboardList,
  FileText,
  Gauge,
  KeyRound,
  LifeBuoy,
  Monitor,
  Package,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionKey } from '@/lib/rbac/permissions';
import type { ModuleId } from '@/lib/modules/registry';

export interface AdminNavItem {
  /** Legacy tab id - also the ?tab= deep-link value. */
  id: string;
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Permission required to see the entry. */
  permission?: PermissionKey;
  /** Any listed permission makes the entry available. */
  permissionsAnyOf?: readonly PermissionKey[];
  /** Module that must be enabled; disabled modules gray the entry out. */
  moduleId?: ModuleId;
  /** Analytics category preserved from the previous dashboard. */
  category: string;
}

export interface AdminNavSection {
  id: string;
  label: string;
  items: AdminNavItem[];
}

/**
 * A searchable destination inside an admin page. These entries improve
 * discovery only; page and API authorization remain enforced by the route
 * boundary and the destination is projected from the same permission set.
 */
export interface AdminNavDestination {
  id: string;
  parentId: AdminNavItem['id'];
  label: string;
  description: string;
  href: string;
  keywords: readonly string[];
  /** Every listed permission is required to advertise the destination. */
  permissionsAllOf?: readonly PermissionKey[];
}

export interface AdminConfigurationSection {
  id: 'general' | 'sign-in' | 'directory' | 'modules' | 'requests' | 'messages' | 'roles' | 'support' | 'break-glass' | 'appearance';
  label: string;
  permission: PermissionKey;
}

/** One manifest for configuration tabs, deep links, and the settings surface. */
export const ADMIN_CONFIGURATION_SECTIONS: readonly AdminConfigurationSection[] = [
  { id: 'general', label: 'General', permission: 'settings.manage' },
  { id: 'sign-in', label: 'Sign-in', permission: 'settings.manage' },
  { id: 'directory', label: 'Directory & Email', permission: 'directory.configure' },
  { id: 'modules', label: 'Modules', permission: 'modules.manage' },
  { id: 'requests', label: 'Access Requests', permission: 'governance.configure' },
  { id: 'messages', label: 'Messages', permission: 'messages.manage' },
  { id: 'roles', label: 'Privileges & Access', permission: 'roles.manage' },
  { id: 'support', label: 'Support & Routing', permission: 'tickets.configure' },
  { id: 'break-glass', label: 'Break-Glass Accounts', permission: 'break_glass.manage' },
  { id: 'appearance', label: 'Appearance & Pages', permission: 'appearance.manage' },
] as const;

export type AdminConfigurationSectionId = AdminConfigurationSection['id'];

export function getVisibleAdminConfigurationSections(
  permissions: ReadonlySet<string>
): AdminConfigurationSection[] {
  return ADMIN_CONFIGURATION_SECTIONS.filter((section) => permissions.has(section.permission));
}

function itemIsVisible(item: AdminNavItem, permissions: ReadonlySet<string>): boolean {
  if (item.permission && permissions.has(item.permission)) return true;
  return item.permissionsAnyOf?.some((permission) => permissions.has(permission)) ?? false;
}

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      {
        id: 'requests',
        href: '/admin/requests',
        label: 'Access Requests',
        description: 'Review, approve, and provision access requests',
        icon: ClipboardList,
        permission: 'access_requests.read',
        category: 'access_request',
      },
      {
        id: 'support',
        href: '/admin/support',
        label: 'Support Tickets',
        description: 'Respond to and resolve portal support tickets',
        icon: LifeBuoy,
        permission: 'tickets.read',
        category: 'support',
      },
      {
        id: 'batch',
        href: '/admin/batch',
        label: 'Batch Accounts',
        description: 'Create and track batches of accounts',
        icon: Package,
        permission: 'batch.manage',
        category: 'batch',
      },
      {
        id: 'events',
        href: '/admin/events',
        label: 'Events',
        description: 'Manage event-based access request catalogs',
        icon: Calendar,
        permission: 'events.manage',
        category: 'event',
      },
      {
        id: 'offboard-campaigns',
        href: '/admin/offboard-campaigns',
        label: 'Offboard Campaigns',
        description: 'Run and monitor offboarding campaigns',
        icon: ShieldAlert,
        permission: 'offboard.manage',
        category: 'offboard_campaign',
      },
    ],
  },
  {
    id: 'identity',
    label: 'Identity & Access',
    items: [
      {
        id: 'users',
        href: '/admin/users',
        label: 'Directory Users',
        description: 'Browse and manage Active Directory accounts',
        icon: Users,
        permission: 'users.read',
        category: 'user',
      },
      {
        id: 'vpn',
        href: '/admin/vpn',
        label: 'VPN Management',
        description: 'VPN accounts, imports, and status changes',
        icon: Shield,
        permission: 'vpn.manage',
        moduleId: 'vpn.management',
        category: 'vpn',
      },
      {
        id: 'lifecycle',
        href: '/admin/lifecycle',
        label: 'Account Lifecycle',
        description: 'Queued lifecycle actions and retries',
        icon: Activity,
        permission: 'lifecycle.read',
        category: 'lifecycle',
      },
      {
        id: 'sync-status',
        href: '/admin/sync-status',
        label: 'Sync Status',
        description: 'Directory synchronization state per account',
        icon: RefreshCw,
        permission: 'sync.read',
        category: 'sync_status',
      },
      {
        id: 'communications',
        href: '/admin/communications',
        label: 'Communications',
        description: 'Mass email campaigns and manual notifications',
        icon: Ticket,
        permission: 'communications.manage',
        moduleId: 'communications',
        category: 'communications',
      },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      {
        id: 'settings',
        href: '/admin/settings',
        label: 'System Configuration',
        description: 'Modules, messaging, privileges, directory, and appearance',
        icon: Settings,
        permissionsAnyOf: ADMIN_CONFIGURATION_SECTIONS.map((section) => section.permission),
        category: 'settings',
      },
      {
        id: 'blocklist',
        href: '/admin/blocklist',
        label: 'Blocklist',
        description: 'Blocked emails and domains for access requests',
        icon: Ban,
        permission: 'blocklist.manage',
        category: 'blocklist',
      },
    ],
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    items: [
      {
        id: 'sessions',
        href: '/admin/sessions',
        label: 'Active Sessions',
        description: 'Signed-in sessions and forced sign-outs',
        icon: Monitor,
        permission: 'sessions.read',
        category: 'session',
      },
      {
        id: 'password-expiration',
        href: '/admin/password-expiration',
        label: 'Password Expiration',
        description: 'Directory password expiry outlook',
        icon: KeyRound,
        permission: 'password_expiration.read',
        category: 'user',
      },
      {
        id: 'ratelimits',
        href: '/admin/ratelimits',
        label: 'Rate Limiting',
        description: 'Per-route rate limit posture and overrides',
        icon: Gauge,
        permission: 'ratelimits.manage',
        category: 'rate_limit',
      },
      {
        id: 'logs',
        href: '/admin/logs',
        label: 'Audit & History',
        description: 'Audit evidence and account-centered action history',
        icon: FileText,
        permission: 'audit.read',
        category: 'logs',
      },
      {
        id: 'alerts',
        href: '/admin/alerts',
        label: 'Service Alerts',
        description: 'Active alerts raised by monitoring and workflows',
        icon: ShieldAlert,
        permission: 'service_alerts.read',
        category: 'navigation',
      },
      {
        id: 'automation',
        href: '/admin/workflows',
        label: 'Workflows',
        description: 'Visual automation workflows and their runs',
        icon: Package,
        permission: 'automation.manage',
        category: 'navigation',
      },
      {
        id: 'operations',
        href: '/admin/operations',
        label: 'Scheduler Health',
        description: 'Cron jobs, cadence, and latest executions',
        icon: Activity,
        permission: 'audit.read',
        category: 'navigation',
      },
    ],
  },
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV_SECTIONS.flatMap(
  (section) => section.items
);

/**
 * Stable, operator-oriented targets for the command palette. Query parameters
 * select the owning tab; fragments identify the section that should receive
 * scroll/focus after the tab mounts.
 */
export const ADMIN_NAV_DESTINATIONS: readonly AdminNavDestination[] = [
  {
    id: 'settings.access-control',
    parentId: 'settings',
    label: 'Sign-in policy',
    description: 'Enabled identity sources, auth-service copy, readiness, and chooser preview',
    href: '/admin/settings?section=sign-in',
    keywords: ['authentication', 'auth service', 'oidc', 'ldap', 'active directory', 'break glass', 'login', 'registration'],
    permissionsAllOf: ['settings.manage'],
  },
  {
    id: 'settings.infrastructure',
    parentId: 'settings',
    label: 'Infrastructure Sync',
    description: 'Directory-based recovery and infrastructure synchronization controls',
    href: '/admin/settings?section=general#infrastructure-management',
    keywords: ['sync', 'recovery', 'directory', 'database loss', 'infrastructure'],
    permissionsAllOf: ['settings.manage'],
  },
  {
    id: 'settings.notifications',
    parentId: 'settings',
    label: 'Notification banners',
    description: 'Create, schedule, edit, and remove portal-wide notices',
    href: '/admin/settings?section=general#notification-banners',
    keywords: ['announcement', 'banner', 'notice', 'maintenance message'],
    permissionsAllOf: ['settings.manage'],
  },
  {
    id: 'settings.directory-connection',
    parentId: 'settings',
    label: 'Directory connection',
    description: 'Primary and failover LDAPS servers, bind account, and connection tests',
    href: '/admin/settings?section=directory#directory-connection',
    keywords: ['ldap', 'ldaps', 'active directory', 'domain controller', 'failover', 'bind', 'tls'],
    permissionsAllOf: ['directory.configure'],
  },
  {
    id: 'settings.directory-scopes',
    parentId: 'settings',
    label: 'Directory search scopes',
    description: 'User and group search bases used for directory lookups',
    href: '/admin/settings?section=directory#directory-search-scopes',
    keywords: ['ldap', 'ou', 'dn', 'search base', 'users', 'groups'],
    permissionsAllOf: ['directory.configure'],
  },
  {
    id: 'settings.directory-targets',
    parentId: 'settings',
    label: 'Directory provisioning targets',
    description: 'Administrative and account-provisioning Active Directory groups',
    href: '/admin/settings?section=directory#directory-provisioning-targets',
    keywords: ['groups', 'provisioning', 'membership', 'admin group', 'kamino'],
    permissionsAllOf: ['directory.configure'],
  },
  {
    id: 'settings.modules',
    parentId: 'settings',
    label: 'Capability modules',
    description: 'Enable or disable optional portal capabilities without deleting history',
    href: '/admin/settings?section=modules',
    keywords: ['vpn module', 'communications module', 'features', 'capabilities'],
    permissionsAllOf: ['modules.manage'],
  },
  {
    id: 'settings.request-governance',
    parentId: 'settings',
    label: 'Access-request governance',
    description: 'Request eligibility, review workflow, and provisioning policy',
    href: '/admin/settings?section=requests',
    keywords: ['requests', 'approval', 'workflow', 'reviewer', 'faculty', 'provisioning'],
    permissionsAllOf: ['governance.configure'],
  },
  {
    id: 'settings.messages',
    parentId: 'settings',
    label: 'Message templates',
    description: 'Author, preview, test, publish, and restore portal email messages',
    href: '/admin/settings?section=messages',
    keywords: ['email', 'template', 'copy', 'preview', 'publish', 'restore'],
    permissionsAllOf: ['messages.manage'],
  },
  {
    id: 'settings.privileges',
    parentId: 'settings',
    label: 'Privileges & access',
    description: 'Map Active Directory groups to administrative capabilities',
    href: '/admin/settings?section=roles',
    keywords: ['rbac', 'roles', 'permissions', 'privileges', 'group mapping'],
    permissionsAllOf: ['roles.manage'],
  },
  {
    id: 'settings.attachment-policy',
    parentId: 'settings',
    label: 'Support attachment policy',
    description: 'File-count and size limits for ticket evidence uploads',
    href: '/admin/settings?section=support#support-attachment-policy',
    keywords: ['support', 'ticket', 'attachment', 'upload', 'evidence', 'malware'],
    permissionsAllOf: ['tickets.configure'],
  },
  {
    id: 'settings.ticket-groups',
    parentId: 'settings',
    label: 'Approved ticket groups',
    description: 'Configure directory groups used for ticket subjects, joins, and assignment',
    href: '/admin/settings?section=support#approved-ticket-groups',
    keywords: ['support', 'ticket routing', 'ownership', 'queue', 'group snapshots'],
    permissionsAllOf: ['tickets.configure'],
  },
  {
    id: 'settings.break-glass',
    parentId: 'settings',
    label: 'Break-glass accounts',
    description: 'Create, rotate, disable, and audit emergency local accounts',
    href: '/admin/settings?section=break-glass#break-glass-accounts',
    keywords: ['local account', 'emergency', 'password', 'oidc outage', 'directory outage'],
    permissionsAllOf: ['break_glass.manage'],
  },
  {
    id: 'settings.appearance',
    parentId: 'settings',
    label: 'Theme & navigation appearance',
    description: 'Portal theme tokens, logo, navigation links, and page presentation',
    href: '/admin/settings?section=appearance#portal-theme',
    keywords: ['appearance', 'theme', 'logo', 'colors', 'navigation', 'pages'],
    permissionsAllOf: ['appearance.manage'],
  },
  {
    id: 'lifecycle.accounts',
    parentId: 'lifecycle',
    label: 'Lifecycle accounts',
    description: 'Select accounts, preview affected systems, and start governed changes',
    href: '/admin/lifecycle?view=accounts#lifecycle-accounts',
    keywords: ['disable ad', 'enable ad', 'vpn', 'offboard', 'delete directory account'],
    permissionsAllOf: ['lifecycle.read'],
  },
  {
    id: 'lifecycle.groups',
    parentId: 'lifecycle',
    label: 'Lifecycle groups',
    description: 'Inspect directory groups and add or remove governed membership',
    href: '/admin/lifecycle?view=groups#lifecycle-groups',
    keywords: ['group membership', 'add member', 'remove member', 'active directory'],
    permissionsAllOf: ['lifecycle.read', 'users.read'],
  },
  {
    id: 'lifecycle.operations',
    parentId: 'lifecycle',
    label: 'Lifecycle operations',
    description: 'Review queued, failed, completed, and reconciliation-required actions',
    href: '/admin/lifecycle?view=operations#lifecycle-operations',
    keywords: ['queue', 'retry', 'reconcile', 'history', 'failed action', 'processing'],
    permissionsAllOf: ['lifecycle.read'],
  },
  {
    id: 'communications.mass-email-compose',
    parentId: 'communications',
    label: 'Compose mass email',
    description: 'Build a recipient audience, preview content, and prepare a campaign',
    href: '/admin/communications?view=mass-email&workspace=compose#mass-email-workspace',
    keywords: ['bulk email', 'audience', 'recipients', 'groups', 'draft', 'preview'],
    permissionsAllOf: ['communications.manage'],
  },
  {
    id: 'communications.mass-email-campaigns',
    parentId: 'communications',
    label: 'Mass-email campaigns',
    description: 'Inspect campaign delivery, recipients, skips, failures, and reconciliation',
    href: '/admin/communications?view=mass-email&workspace=campaigns#mass-email-workspace',
    keywords: ['delivery', 'sent', 'failed', 'campaign history', 'delivery unknown'],
    permissionsAllOf: ['communications.manage'],
  },
  {
    id: 'communications.manual',
    parentId: 'communications',
    label: 'Manual notifications',
    description: 'Find a request and resend verification, activation, or password-reset messages',
    href: '/admin/communications?view=manual-notifications#manual-notifications',
    keywords: ['resend', 'verification email', 'activation token', 'reset link', 'request'],
    permissionsAllOf: ['communications.manage'],
  },
  {
    id: 'offboard.campaigns',
    parentId: 'offboard-campaigns',
    label: 'Offboard campaign list',
    description: 'Monitor active, paused, completed, and rollback-ready offboarding campaigns',
    href: '/admin/offboard-campaigns?view=campaigns#offboard-campaigns',
    keywords: ['offboarding', 'waves', 'reminders', 'enforcement', 'rollback'],
    permissionsAllOf: ['offboard.manage'],
  },
  {
    id: 'offboard.dry-run',
    parentId: 'offboard-campaigns',
    label: 'New offboard dry run',
    description: 'Select accounts and preview a safe offboarding campaign before activation',
    href: '/admin/offboard-campaigns?view=dry-run#offboard-campaigns',
    keywords: ['offboarding', 'preview', 'canary', 'waves', 'accounts'],
    permissionsAllOf: ['offboard.manage'],
  },
  {
    id: 'batch.new',
    parentId: 'batch',
    label: 'New account batch',
    description: 'Create and review a batch of directory and VPN accounts',
    href: '/admin/batch?action=new#new-account-batch',
    keywords: ['bulk accounts', 'create users', 'vpn accounts', 'event accounts'],
    permissionsAllOf: ['batch.manage'],
  },
  {
    id: 'batch.history',
    parentId: 'batch',
    label: 'Batch history',
    description: 'Inspect prior batch results, failures, reconciliation, and details',
    href: '/admin/batch#batch-history',
    keywords: ['bulk accounts', 'results', 'failed', 'reconcile', 'audit'],
    permissionsAllOf: ['batch.manage'],
  },
  {
    id: 'operations.scheduler-health',
    parentId: 'operations',
    label: 'Scheduler health',
    description: 'Registered jobs, cadence, outcomes, and last-run freshness',
    href: '/admin/operations#scheduler-health',
    keywords: ['cron', 'jobs', 'stale', 'cadence', 'last run'],
    permissionsAllOf: ['audit.read'],
  },
  {
    id: 'operations.intervention-signals',
    parentId: 'operations',
    label: 'Intervention signals',
    description: 'Structured scheduler and request conditions that need operator review',
    href: '/admin/operations#intervention-signals',
    keywords: ['detector', 'episode', 'warning', 'critical', 'stale'],
    permissionsAllOf: ['audit.read'],
  },
  {
    id: 'operations.executions',
    parentId: 'operations',
    label: 'Latest scheduler executions',
    description: 'Recent cron outcomes, durations, and execution timestamps',
    href: '/admin/operations#latest-executions',
    keywords: ['cron run', 'success', 'failed', 'duration', 'outcome'],
    permissionsAllOf: ['audit.read'],
  },
  {
    id: 'operations.alerts',
    parentId: 'operations',
    label: 'Active service alerts',
    description: 'Current service alerts and their occurrence counts',
    href: '/admin/operations#active-service-alerts',
    keywords: ['incident', 'alert', 'monitoring', 'critical', 'service health'],
    permissionsAllOf: ['audit.read', 'service_alerts.read'],
  },
  {
    id: 'operations.workflow-runs',
    parentId: 'operations',
    label: 'Recent workflow runs',
    description: 'Recorded automation executions and failure classifications',
    href: '/admin/operations#recent-workflow-runs',
    keywords: ['automation', 'flow run', 'trigger', 'failure'],
    permissionsAllOf: ['audit.read'],
  },
] as const;

export function getVisibleAdminNavDestinations(
  permissions: ReadonlySet<string>,
  disabledModules: ReadonlySet<string> = new Set()
): AdminNavDestination[] {
  return ADMIN_NAV_DESTINATIONS.filter((destination) => {
    const parent = ADMIN_NAV_ITEMS.find((item) => item.id === destination.parentId);
    if (!parent || !itemIsVisible(parent, permissions)) return false;
    if (isAdminNavItemModuleDisabled(parent, disabledModules)) return false;
    return destination.permissionsAllOf?.every((permission) => permissions.has(permission)) ?? true;
  });
}

/**
 * Resolves the exact navigation projection shared by the sidebar, command
 * palette, and overview. Route handlers remain the authorization boundary;
 * this only keeps the console from advertising unavailable tools.
 */
export function getVisibleAdminNavSections(
  permissions: ReadonlySet<string>
): AdminNavSection[] {
  return ADMIN_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => itemIsVisible(item, permissions)),
  })).filter((section) => section.items.length > 0);
}

export function isAdminNavItemModuleDisabled(
  item: AdminNavItem,
  disabledModules: ReadonlySet<string>
): boolean {
  return Boolean(item.moduleId && disabledModules.has(item.moduleId));
}

export function findAdminNavItemByTab(tab: string | null): AdminNavItem | null {
  if (!tab) return null;
  return ADMIN_NAV_ITEMS.find((item) => item.id === tab) ?? null;
}

/**
 * Server-side route authorization projection. Navigation is a discovery aid;
 * this registry prevents copied deep links from mounting an unrelated client
 * panel. Unregistered admin pages fail closed until explicitly assigned.
 */
const ADMIN_ROUTE_PERMISSIONS: ReadonlyArray<{ path: string; permissionsAnyOf: readonly PermissionKey[] }> = [
  ...ADMIN_NAV_ITEMS.map((item) => ({
    path: item.href,
    permissionsAnyOf: item.permissionsAnyOf ?? (item.permission ? [item.permission] : []),
  })),
  { path: '/admin/batch-accounts', permissionsAnyOf: ['batch.manage'] },
  { path: '/admin/search', permissionsAnyOf: ['admin.search'] },
];

export function canAccessAdminRoute(pathname: string, permissions: ReadonlySet<string>): boolean {
  if (pathname === '/admin' || pathname === '/admin/') return permissions.size > 0;
  const route = ADMIN_ROUTE_PERMISSIONS
    .filter(({ path }) => pathname === path || pathname.startsWith(`${path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0];

  return Boolean(route && route.permissionsAnyOf.some((permission) => permissions.has(permission)));
}
