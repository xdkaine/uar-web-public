/**
 * Curated workflow node catalog (ADR-0013). A node type exists only if
 * defined here; graphs validate on save AND on execution, and an unknown or
 * removed type disables the graph loudly instead of misfiring. There is no
 * expression language, no arbitrary code, and no HTTP-call node - privileged
 * mutations always flow through existing vetted services.
 */

export type FlowNodeCategory = 'source' | 'trigger' | 'logic' | 'action';

export interface FlowNodeDefinition {
  type: string;
  category: FlowNodeCategory;
  label: string;
  description: string;
  /** Branch nodes expose two outgoing handles; everything else one. */
  handles?: Array<{ id: string; label: string }>;
  configSchema: Array<{
    name: string;
    label: string;
    /**
     * 'group-dn' renders a directory-group picker (value stays the DN);
     * the server treats it like any other string field.
     */
    kind: 'string' | 'number' | 'text' | 'select' | 'boolean' | 'group-dn' | 'group-dns' | 'monitor-checks';
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    placeholder?: string;
    help?: string;
  }>;
  /**
   * Typed event-context registry for trigger nodes. Condition comparisons may
   * only reference these keys - there are no free-form expressions anywhere.
   */
  contextFields?: Array<{ key: string; label: string }>;
}

/** Comparison operators for condition groups. All string compares are case-insensitive. */
export type ConditionComparisonOp = 'equals' | 'contains' | 'in';

export interface ConditionComparison {
  field: string;
  op: ConditionComparisonOp;
  value: string | string[];
}

export interface ConditionGroup {
  /** 'all' = every comparison must hold; 'any' = at least one. */
  match: 'all' | 'any';
  comparisons: ConditionComparison[];
}

export const TICKET_TRIGGER_VARS = [
  { name: 'ticketId', description: 'Ticket identifier' },
  { name: 'ticketSubject', description: 'Ticket title' },
  { name: 'username', description: "Creator's username" },
  { name: 'category', description: 'Category, when set' },
  { name: 'severity', description: 'Severity, when set' },
  { name: 'requestedForSelf', description: '"true" when the creator filed for themselves' },
  { name: 'requestedForGroupDn', description: 'Group DN the ticket was filed for, when set' },
  { name: 'joinGroupDn', description: 'Group DN requested to join, when set' },
  { name: 'joinAutoApprove', description: '"true" when the join group allows automatic adds' },
];

export const FLOW_NODE_CATALOG: Record<string, FlowNodeDefinition> = {
  source_monitor_endpoints: {
    type: 'source_monitor_endpoints',
    category: 'source',
    label: 'Monitor endpoints',
    description: 'Test a bounded list of services and route each independent failure or recovery into this workflow.',
    handles: [
      { id: 'failed', label: 'FAILED' },
      { id: 'recovered', label: 'RECOVERED' },
    ],
    configSchema: [
      { name: 'checks', label: 'Checks', kind: 'monitor-checks', required: true },
    ],
    contextFields: [
      { key: 'checkKey', label: 'Check key' },
      { key: 'targetId', label: 'Check record ID' },
      { key: 'target', label: 'Check name' },
      { key: 'host', label: 'Host' },
      { key: 'protocol', label: 'Check type' },
      { key: 'statusCode', label: 'HTTP status' },
      { key: 'latencyMs', label: 'Latency (ms)' },
      { key: 'error', label: 'Failure detail' },
    ],
  },
  // ------------------------------ Triggers ------------------------------
  trigger_ticket_created: {
    type: 'trigger_ticket_created',
    category: 'trigger',
    label: 'Ticket created',
    description: 'A new support ticket is submitted.',
    configSchema: [],
    contextFields: [
      { key: 'ticketId', label: 'Ticket ID' },
      { key: 'ticketSubject', label: 'Ticket subject' },
      { key: 'username', label: 'Creator username' },
      { key: 'category', label: 'Category' },
      { key: 'severity', label: 'Severity' },
      { key: 'requestedForSelf', label: 'Filed for self' },
      { key: 'requestedForGroupDn', label: 'Filed-for group DN' },
      { key: 'joinGroupDn', label: 'Join-request group DN' },
      { key: 'joinAutoApprove', label: 'Join auto-approved' },
    ],
  },
  trigger_ticket_replied: {
    type: 'trigger_ticket_replied',
    category: 'trigger',
    label: 'Ticket replied',
    description: 'Someone responds to a ticket.',
    configSchema: [],
    contextFields: [
      { key: 'ticketId', label: 'Ticket ID' },
      { key: 'ticketSubject', label: 'Ticket subject' },
      { key: 'username', label: 'Replier username' },
      { key: 'isStaff', label: 'Replier is staff' },
    ],
  },
  trigger_ticket_status_changed: {
    type: 'trigger_ticket_status_changed',
    category: 'trigger',
    label: 'Ticket status changed',
    description: 'A ticket moves between open / in_progress / closed.',
    configSchema: [],
    contextFields: [
      { key: 'ticketId', label: 'Ticket ID' },
      { key: 'ticketSubject', label: 'Ticket subject' },
      { key: 'oldStatus', label: 'Previous status' },
      { key: 'newStatus', label: 'New status' },
      { key: 'status', label: 'Status' },
      { key: 'username', label: 'Actor username' },
    ],
  },
  trigger_dc_unreachable: {
    type: 'trigger_dc_unreachable',
    category: 'trigger',
    label: 'Primary AD unreachable',
    description: 'The directory health probe cannot reach any configured server.',
    configSchema: [],
    contextFields: [
      { key: 'target', label: 'Probe target' },
      { key: 'error', label: 'Error message' },
    ],
  },
  trigger_dc_recovered: {
    type: 'trigger_dc_recovered',
    category: 'trigger',
    label: 'Directory recovered',
    description: 'The directory answers again after a failure alert was active.',
    configSchema: [],
    contextFields: [{ key: 'target', label: 'Probe target' }],
  },
  trigger_schedule: {
    type: 'trigger_schedule',
    category: 'trigger',
    label: 'Schedule',
    description:
      'Runs on an interval. Minutes granularity; evaluated by the workflow tick worker.',
    configSchema: [
      { name: 'everyMinutes', label: 'Every (minutes)', kind: 'number', required: true, help: 'Minimum 5 minutes.' },
      { name: 'topic', label: 'Run topic key', kind: 'string', required: true, help: 'Stable key used for dedupe, e.g. nightly-report.' },
    ],
    contextFields: [],
  },
  trigger_lifecycle_action_completed: {
    type: 'trigger_lifecycle_action_completed',
    category: 'trigger',
    label: 'Lifecycle action completed',
    description:
      'A queued account lifecycle action finished successfully. Emitted by the lifecycle processor after it marks the action completed.',
    configSchema: [],
    contextFields: [
      { key: 'actionType', label: 'Action type' },
      { key: 'username', label: 'Affected username' },
      { key: 'status', label: 'Result status' },
      { key: 'actionId', label: 'Action ID' },
      { key: 'batchId', label: 'Batch ID' },
    ],
  },
  trigger_lifecycle_action_failed: {
    type: 'trigger_lifecycle_action_failed',
    category: 'trigger',
    label: 'Lifecycle action failed',
    description:
      'A queued account lifecycle action failed. Emitted by the lifecycle processor with the failure error message.',
    configSchema: [],
    contextFields: [
      { key: 'actionType', label: 'Action type' },
      { key: 'username', label: 'Affected username' },
      { key: 'status', label: 'Result status' },
      { key: 'actionId', label: 'Action ID' },
      { key: 'batchId', label: 'Batch ID' },
      { key: 'error', label: 'Error message' },
    ],
  },
  trigger_attachment_malware_detected: {
    type: 'trigger_attachment_malware_detected',
    category: 'trigger',
    label: 'Attachment malware blocked',
    description:
      'A ticket upload is quarantined after the malware scanner reports a threat.',
    configSchema: [],
    contextFields: [
      { key: 'ticketId', label: 'Original ticket ID' },
      { key: 'attachmentId', label: 'Quarantined attachment ID' },
      { key: 'filename', label: 'Attachment filename' },
      { key: 'uploadedBy', label: 'Uploader username' },
    ],
  },
  trigger_health_check_failed: {
    type: 'trigger_health_check_failed',
    category: 'trigger',
    label: 'Monitored endpoint failed',
    description: 'An approved HTTPS or TCP endpoint crossed its configured failure threshold.',
    configSchema: [],
    contextFields: [
      { key: 'targetId', label: 'Target ID' },
      { key: 'target', label: 'Target name' },
      { key: 'host', label: 'Host' },
      { key: 'protocol', label: 'Protocol' },
      { key: 'error', label: 'Probe error' },
      { key: 'latencyMs', label: 'Latency (ms)' },
    ],
  },
  trigger_health_check_recovered: {
    type: 'trigger_health_check_recovered',
    category: 'trigger',
    label: 'Monitored endpoint recovered',
    description: 'An approved endpoint crossed its configured recovery threshold.',
    configSchema: [],
    contextFields: [
      { key: 'targetId', label: 'Target ID' },
      { key: 'target', label: 'Target name' },
      { key: 'host', label: 'Host' },
      { key: 'protocol', label: 'Protocol' },
      { key: 'latencyMs', label: 'Latency (ms)' },
    ],
  },
  trigger_operational_issue_detected: {
    type: 'trigger_operational_issue_detected',
    category: 'trigger',
    label: 'Operational issue detected',
    description:
      'A curated scheduler or access-request detector opens a new issue episode. Filter by scheduled_job_failed, scheduled_job_overdue, or access_request_intervention_required with a Condition. Raw log text is never accepted.',
    configSchema: [],
    contextFields: [
      { key: 'detectorKey', label: 'Detector key' },
      { key: 'reasonCode', label: 'Reason code' },
      { key: 'severity', label: 'Severity' },
      { key: 'subjectType', label: 'Subject type' },
      { key: 'subjectId', label: 'Subject ID' },
      { key: 'route', label: 'Scheduled job route' },
      { key: 'summary', label: 'Safe summary' },
      { key: 'dedupeKey', label: 'Dedupe key' },
      { key: 'evidenceEventId', label: 'Evidence event ID' },
      { key: 'correlationId', label: 'Correlation ID' },
      { key: 'href', label: 'Admin evidence link' },
    ],
  },
  trigger_operational_issue_resolved: {
    type: 'trigger_operational_issue_resolved',
    category: 'trigger',
    label: 'Operational issue resolved',
    description:
      'A previously active structured detector no longer matches, allowing recovery notifications or alert cleanup.',
    configSchema: [],
    contextFields: [
      { key: 'detectorKey', label: 'Detector key' },
      { key: 'reasonCode', label: 'Reason code' },
      { key: 'severity', label: 'Severity' },
      { key: 'subjectType', label: 'Subject type' },
      { key: 'subjectId', label: 'Subject ID' },
      { key: 'route', label: 'Scheduled job route' },
      { key: 'summary', label: 'Safe summary' },
      { key: 'dedupeKey', label: 'Dedupe key' },
      { key: 'evidenceEventId', label: 'Evidence event ID' },
      { key: 'correlationId', label: 'Correlation ID' },
      { key: 'href', label: 'Admin evidence link' },
    ],
  },

  // ------------------------------- Logic --------------------------------
  logic_condition: {
    type: 'logic_condition',
    category: 'logic',
    label: 'Condition',
    description:
      'Branch on fields of the event context. A single field comparison, or up to 5 groups combined with AND (each group matching ALL or ANY of its comparisons). TRUE/FALSE wires route execution.',
    handles: [
      { id: 'true', label: 'TRUE' },
      { id: 'false', label: 'FALSE' },
    ],
    configSchema: [
      { name: 'field', label: 'Field', kind: 'select', required: true, options: [
        { value: 'category', label: 'Ticket category' },
        { value: 'severity', label: 'Severity' },
        { value: 'status', label: 'Status' },
        { value: 'newStatus', label: 'New status (status change)' },
        { value: 'username', label: 'Username' },
        { value: 'requestedForSelf', label: 'Filed for self?' },
        { value: 'requestedForGroupDn', label: 'Filed-for group DN' },
        { value: 'joinGroupDn', label: 'Join-request group DN' },
        { value: 'joinAutoApprove', label: 'Join auto-approved by config?' },
        { value: 'detectorKey', label: 'Operational detector key' },
        { value: 'reasonCode', label: 'Operational reason code' },
        { value: 'subjectType', label: 'Operational subject type' },
        { value: 'route', label: 'Scheduled job route' },
      ] },
      { name: 'equals', label: 'Equals', kind: 'string', required: true, placeholder: 'e.g. ACCOUNT or true', help: 'Boolean fields compare against "true" / "false". Ignored when advanced condition groups are configured.' },
    ],
  },
  logic_delay: {
    type: 'logic_delay',
    category: 'logic',
    label: 'Wait',
    description: 'Pause this branch. Timers survive restarts; runs resume late, never double-fire.',
    handles: [{ id: 'out', label: 'After wait' }],
    configSchema: [
      { name: 'minutes', label: 'Minutes to wait', kind: 'number', required: true, help: '1 - 1440 minutes.' },
    ],
  },

  // ------------------------------ Actions -------------------------------
  action_send_email: {
    type: 'action_send_email',
    category: 'action',
    label: 'Send email',
    description: 'Send a plain-text email through the portal relay. Recipients are explicit addresses.',
    configSchema: [
      { name: 'to', label: 'Recipients', kind: 'text', required: true, placeholder: 'one@cpp.edu, two@cpp.edu', help: '{{tokens}} from the event context are substituted in subject and body.' },
      { name: 'subject', label: 'Subject', kind: 'string', required: true },
      { name: 'body', label: 'Body', kind: 'text', required: true },
    ],
  },
  action_create_service_alert: {
    type: 'action_create_service_alert',
    category: 'action',
    label: 'Raise service alert',
    description: 'Upsert a categorized service alert by dedupe key. Re-occurrence increments counters.',
    configSchema: [
      { name: 'dedupeKey', label: 'Dedupe key', kind: 'string', required: true },
      { name: 'severity', label: 'Severity', kind: 'select', options: [
        { value: 'info', label: 'Info' },
        { value: 'warning', label: 'Warning' },
        { value: 'critical', label: 'Critical' },
      ] },
      { name: 'title', label: 'Title', kind: 'string', required: true },
      { name: 'message', label: 'Message', kind: 'text', required: true },
    ],
  },
  action_resolve_service_alerts: {
    type: 'action_resolve_service_alerts',
    category: 'action',
    label: 'Resolve service alerts',
    description: 'Resolve matching alerts and cascade-cleanup artifacts this workflow created with them.',
    configSchema: [
      { name: 'category', label: 'Category', kind: 'select', options: [
        { value: 'directory', label: 'Directory' },
        { value: 'email', label: 'Email' },
        { value: 'storage', label: 'Storage' },
        { value: 'general', label: 'General' },
      ] },
      { name: 'dedupeKey', label: 'Dedupe key (optional)', kind: 'string' },
    ],
  },
  action_create_notification_banner: {
    type: 'action_create_notification_banner',
    category: 'action',
    label: 'Create global notification',
    description: 'Show a site-wide banner. Auto-expires after the given minutes and is tracked for cleanup.',
    configSchema: [
      { name: 'message', label: 'Message', kind: 'text', required: true },
      { name: 'type', label: 'Type', kind: 'select', options: [
        { value: 'info', label: 'Info' },
        { value: 'warning', label: 'Warning' },
        { value: 'error', label: 'Error' },
        { value: 'success', label: 'Success' },
      ] },
      { name: 'expiresMinutes', label: 'Expires after (minutes)', kind: 'number', help: 'Blank means until cleared by a workflow or administrator.' },
    ],
  },
  action_clear_notification_banner: {
    type: 'action_clear_notification_banner',
    category: 'action',
    label: 'Clear global notification',
    description:
      'Deactivate matching site banners. Match by the banner reference a workflow recorded when raising it, or clear every active banner this workflow graph created. Matching nothing succeeds silently.',
    configSchema: [
      { name: 'dedupeKey', label: 'Banner reference (optional)', kind: 'string', help: 'The FlowArtifact refId recorded when a workflow created the banner (its banner id).' },
      { name: 'createdByGraph', label: 'Clear banners this graph created', kind: 'boolean', help: 'Deactivates every active banner created by any run of this workflow.' },
    ],
  },
  action_add_ticket_response: {
    type: 'action_add_ticket_response',
    category: 'action',
    label: 'Reply to ticket',
    description: 'Post a system response on the triggering ticket. {{tokens}} are substituted.',
    configSchema: [
      { name: 'message', label: 'Response', kind: 'text', required: true },
    ],
  },
  action_close_ticket: {
    type: 'action_close_ticket',
    category: 'action',
    label: 'Close ticket',
    description: 'Close the triggering ticket as automation.',
    configSchema: [],
  },
  action_update_ticket: {
    type: 'action_update_ticket',
    category: 'action',
    label: 'Update ticket',
    description:
      'Move the triggering ticket to a chosen status as automation. Status changes are logged like staff actions.',
    configSchema: [
      {
        name: 'status',
        label: 'Set status to',
        kind: 'select',
        required: true,
        options: [
          { value: 'open', label: 'Open' },
          { value: 'in_progress', label: 'In progress' },
          { value: 'closed', label: 'Closed' },
        ],
      },
    ],
  },
  action_create_internal_ticket: {
    type: 'action_create_internal_ticket',
    category: 'action',
    label: 'Create internal ticket',
    description:
      'Create an admin-only support ticket. Use this for operational or security events that must never appear in the requester portal.',
    configSchema: [
      { name: 'subject', label: 'Subject', kind: 'string', required: true },
      { name: 'body', label: 'Description', kind: 'text', required: true },
      {
        name: 'category',
        label: 'Category',
        kind: 'select',
        required: true,
        options: [
          { value: 'SECURITY', label: 'Security' },
          { value: 'SYSTEM', label: 'System' },
          { value: 'OTHER', label: 'Other' },
        ],
      },
      {
        name: 'severity',
        label: 'Severity',
        kind: 'select',
        required: true,
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'critical', label: 'Critical' },
        ],
      },
    ],
  },
  action_enqueue_group_add: {
    type: 'action_enqueue_group_add',
    category: 'action',
    label: 'Add user to group',
    description:
      'Queue a lifecycle group-membership add for the triggering ticket creator. Only groups flagged "auto-approve joins" in Support & Routing are eligible; never binds LDAP inline - claims/retries stay owned by the lifecycle queue.',
    configSchema: [
      { name: 'groupDns', label: 'Groups', kind: 'group-dns', required: true, help: 'Choose up to 10 approved groups. The requested-group token can be included with fixed groups.' },
    ],
  },
  action_enqueue_group_remove: {
    type: 'action_enqueue_group_remove',
    category: 'action',
    label: 'Remove user from group',
    description:
      'Queue a lifecycle group-membership removal for the user resolved from the event context. Uses the same allowlist gates as the add node; never binds LDAP inline - claims/retries stay owned by the lifecycle queue.',
    configSchema: [
      { name: 'groupDn', label: 'Group', kind: 'group-dn', required: true, placeholder: 'CN=App-Users,OU=Groups,DC=sdc,DC=cpp', help: 'Pick a group, or use {{joinGroupDn}} with a join trigger context.' },
    ],
  },
};

export const TRIGGER_TYPES = Object.values(FLOW_NODE_CATALOG)
  .filter((definition) => definition.category === 'trigger' || definition.category === 'source')
  .map((definition) => definition.type);

/** Trigger catalog key -> the flow node type that starts such a graph. */
export const TRIGGER_KEY_TO_NODE_TYPE: Record<string, string> = {
  monitor_endpoints: 'source_monitor_endpoints',
  ticket_created: 'trigger_ticket_created',
  ticket_replied: 'trigger_ticket_replied',
  ticket_status_changed: 'trigger_ticket_status_changed',
  dc_unreachable: 'trigger_dc_unreachable',
  dc_recovered: 'trigger_dc_recovered',
  lifecycle_action_completed: 'trigger_lifecycle_action_completed',
  lifecycle_action_failed: 'trigger_lifecycle_action_failed',
  attachment_malware_detected: 'trigger_attachment_malware_detected',
  health_check_failed: 'trigger_health_check_failed',
  health_check_recovered: 'trigger_health_check_recovered',
  operational_issue_detected: 'trigger_operational_issue_detected',
  operational_issue_resolved: 'trigger_operational_issue_resolved',
};

export const NODE_TYPE_TO_TRIGGER_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(TRIGGER_KEY_TO_NODE_TYPE).map(([key, type]) => [type, key])
);

export function isKnownNodeType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(FLOW_NODE_CATALOG, type);
}
