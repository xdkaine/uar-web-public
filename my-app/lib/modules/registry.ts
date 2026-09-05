export type ModuleId =
  | 'vpn.management'
  | 'support.tickets'
  | 'events'
  | 'password.expiration'
  | 'communications';

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  description: string;
  /**
   * What operators lose when this module is disabled, and what is preserved.
   * Shown in the Modules configuration section as an impact preview before
   * toggling.
   */
  disableImpact: string[];
  /** Module ids that must be enabled for this module to function. */
  dependsOn: ModuleId[];
  /**
   * Persisted configuration keys (lib/config/registry.ts) that belong to this
   * module. Shown with the module so its settings travel with its lifecycle;
   * every referenced key must exist in CONFIG_REGISTRY (enforced by test).
   */
  configKeys?: string[];
  /**
   * Legacy admin tab ids (lib/admin/navigation.ts) that render gated on this
   * module. Lets the Modules panel show which navigation surfaces disappear
   * or gray out when the module is disabled.
   */
  adminTabs?: string[];
  /**
   * Flow/automation trigger keys (lib/flow/catalog.ts, lib/automation/catalog.ts)
   * owned by this module. Live WorkflowGraph and AutomationRule rows using
   * these keys are listed as module usage so operators see what stops firing.
   */
  triggerKeys?: string[];
  /**
   * Cron route keys (lib/cron/registry.ts `route` values) that drive this
   * module's background processing. Every referenced key must exist in
   * CRON_ROUTE_REGISTRY (enforced by test).
   */
  cronJobKeys?: string[];
}

/**
 * The written specification of the application's optional capabilities. A
 * module id exists only if it is defined here; runtime state lives in the
 * ModuleState table and a missing row always means "enabled" so current
 * behavior is preserved on first deployment (compatibility contract #2 in
 * docs/architecture/modularity-configuration-roadmap.md).
 */
export const MODULE_REGISTRY: Record<ModuleId, ModuleDefinition> = {
  'vpn.management': {
    id: 'vpn.management',
    name: 'VPN Management',
    description:
      'VPN account tracking, spreadsheet imports, portal role changes, and VPN side effects inside access requests, lifecycle actions, and infrastructure sync.',
    disableImpact: [
      'VPN admin tabs are hidden and VPN mutation APIs return "module disabled".',
      'Access requests complete without creating or activating VPN tracking records.',
      'Lifecycle, offboarding, and sync operations skip their VPN portions and record that they were skipped.',
      'Historical VPN accounts, imports, and status logs are kept and remain viewable.',
    ],
    dependsOn: [],
    adminTabs: ['vpn'],
  },
  'support.tickets': {
    id: 'support.tickets',
    name: 'Support Tickets',
    description:
      'Portal support workflow: ticket creation for self or approved directory groups, requester receipts, responses, and assignment ownership.',
    disableImpact: [
      'New ticket creation and user replies return "module disabled".',
      'The support navigation entry and creation forms are hidden.',
      'Administrators keep read access to existing tickets, assignments, and history.',
      'Existing tickets, responses, and assignment records are preserved unchanged.',
    ],
    dependsOn: [],
    configKeys: [],
    adminTabs: ['support'],
    triggerKeys: ['ticket_created', 'ticket_replied', 'ticket_status_changed'],
  },
  'events': {
    id: 'events',
    name: 'Events',
    description:
      'Event-based access requests: event catalog management and the event selector inside request flows.',
    disableImpact: [
      'Event creation, editing, activation, and deletion APIs return "module disabled".',
      'The public events listing returns empty so request forms stop offering event-based requests.',
      'Existing requests keep their event references and remain fully viewable.',
    ],
    dependsOn: [],
    configKeys: [],
    adminTabs: ['events'],
  },
  'password.expiration': {
    id: 'password.expiration',
    name: 'Password Expiration',
    description:
      'Directory password expiration monitoring, milestone reminder emails, and the expiration reporting surface.',
    disableImpact: [
      'The expiration scheduler skips its pass and records a module-disabled outcome.',
      'Expiration notification and processing endpoints return "module disabled".',
      'The expiration report remains viewable as historical evidence.',
    ],
    dependsOn: [],
    configKeys: [],
    adminTabs: ['password-expiration'],
    cronJobKeys: ['process-password-expiration'],
  },
  'communications': {
    id: 'communications',
    name: 'Communications',
    description:
      'Mass email campaigns: audience resolution, preview/test sends, activation, scheduled delivery, and delivery logs.',
    disableImpact: [
      'New campaigns, activation, processing, quick sends, and test sends return "module disabled".',
      'The scheduler skips campaign processing and records a module-disabled outcome.',
      'Campaign cancellation stays available so in-flight work can be wound down safely.',
      'Delivery logs and recipient history are preserved and remain viewable.',
    ],
    dependsOn: [],
    configKeys: [],
    adminTabs: ['communications'],
    cronJobKeys: ['process-mass-email'],
  },
};

export const ALL_MODULE_IDS = Object.keys(MODULE_REGISTRY) as ModuleId[];

export function getModuleDefinition(moduleId: string): ModuleDefinition | null {
  return (MODULE_REGISTRY as Record<string, ModuleDefinition>)[moduleId] ?? null;
}

export function isKnownModuleId(moduleId: string): moduleId is ModuleId {
  return Object.prototype.hasOwnProperty.call(MODULE_REGISTRY, moduleId);
}
