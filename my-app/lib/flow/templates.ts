/**
 * Predrafted workflow templates (ADR-0013). Templates are code-defined and
 * never auto-enabled: choosing one in the builder instantiates a DRAFT graph
 * the operator must review and publish. Nothing here runs until published.
 */
export interface WorkflowTemplateNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface WorkflowTemplateEdge {
  source: string;
  sourceHandle?: string;
  target: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowTemplateNode[];
  edges: WorkflowTemplateEdge[];
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'truenas-vm-ping-monitoring',
    name: 'TrueNAS VM reachability monitoring',
    description: 'Draft ICMP reachability checks for three TrueNAS VMs, with one deduplicated alert per VM and automatic recovery. This proves network reachability, not TrueNAS service health. Replace the reserved hosts before publishing.',
    nodes: [
      {
        id: 'monitor',
        type: 'source_monitor_endpoints',
        config: { checks: [1, 2, 3].map((number) => ({
          key: `truenas-vm-${number}`,
          name: `TrueNAS VM ${number}`,
          kind: 'icmp',
          host: `truenas-vm-${number}.invalid`,
          intervalSeconds: 60,
          timeoutMs: 3000,
          failureThreshold: 3,
          recoveryThreshold: 2,
          enabled: true,
        })) },
        position: { x: 40, y: 140 },
      },
      {
        id: 'alert',
        type: 'action_create_service_alert',
        config: { dedupeKey: 'truenas-ping-{{checkKey}}', severity: 'critical', title: '{{target}} is unreachable', message: 'ICMP probe to {{host}} failed: {{error}}' },
        position: { x: 360, y: 70 },
      },
      {
        id: 'resolve',
        type: 'action_resolve_service_alerts',
        config: { category: 'general', dedupeKey: 'truenas-ping-{{checkKey}}' },
        position: { x: 360, y: 230 },
      },
    ],
    edges: [
      { source: 'monitor', sourceHandle: 'failed', target: 'alert' },
      { source: 'monitor', sourceHandle: 'recovered', target: 'resolve' },
    ],
  },
  {
    id: 'proxmox-cluster-ping-monitoring',
    name: 'Proxmox cluster reachability monitoring',
    description: 'Draft ICMP reachability checks for a three-node Proxmox cluster, with node-specific alert and recovery handling. This proves network reachability, not cluster quorum or service health. Replace the reserved hosts before publishing.',
    nodes: [
      {
        id: 'monitor',
        type: 'source_monitor_endpoints',
        config: { checks: [1, 2, 3].map((number) => ({
          key: `proxmox-node-${number}`,
          name: `Proxmox node ${number}`,
          kind: 'icmp',
          host: `proxmox-node-${number}.invalid`,
          intervalSeconds: 60,
          timeoutMs: 3000,
          failureThreshold: 3,
          recoveryThreshold: 2,
          enabled: true,
        })) },
        position: { x: 40, y: 140 },
      },
      {
        id: 'alert',
        type: 'action_create_service_alert',
        config: { dedupeKey: 'proxmox-ping-{{checkKey}}', severity: 'critical', title: '{{target}} is unreachable', message: 'ICMP probe to {{host}} failed: {{error}}' },
        position: { x: 360, y: 70 },
      },
      {
        id: 'resolve',
        type: 'action_resolve_service_alerts',
        config: { category: 'general', dedupeKey: 'proxmox-ping-{{checkKey}}' },
        position: { x: 360, y: 230 },
      },
    ],
    edges: [
      { source: 'monitor', sourceHandle: 'failed', target: 'alert' },
      { source: 'monitor', sourceHandle: 'recovered', target: 'resolve' },
    ],
  },
  {
    id: 'multi-vm-ldaps-monitoring',
    name: 'Multi-VM LDAPS monitoring',
    description: 'Draft LDAPS connectivity checks for three directory VMs. Add a base DN and credential reference when a bind-and-search check is required, then replace the reserved hosts before publishing.',
    nodes: [
      {
        id: 'monitor',
        type: 'source_monitor_endpoints',
        config: { checks: [1, 2, 3].map((number) => ({
          key: `directory-vm-${number}`,
          name: `Directory VM ${number}`,
          kind: 'ldaps',
          host: `directory-vm-${number}.invalid`,
          port: 636,
          intervalSeconds: 60,
          timeoutMs: 5000,
          failureThreshold: 2,
          recoveryThreshold: 2,
          enabled: true,
        })) },
        position: { x: 40, y: 140 },
      },
      {
        id: 'alert',
        type: 'action_create_service_alert',
        config: { dedupeKey: 'ldaps-health-{{checkKey}}', severity: 'critical', title: '{{target}} LDAPS check failed', message: 'LDAPS check for {{host}} failed: {{error}}' },
        position: { x: 360, y: 70 },
      },
      {
        id: 'resolve',
        type: 'action_resolve_service_alerts',
        config: { category: 'directory', dedupeKey: 'ldaps-health-{{checkKey}}' },
        position: { x: 360, y: 230 },
      },
    ],
    edges: [
      { source: 'monitor', sourceHandle: 'failed', target: 'alert' },
      { source: 'monitor', sourceHandle: 'recovered', target: 'resolve' },
    ],
  },
  {
    id: 'monitored-endpoint-alert',
    name: 'Monitored endpoint outage alert',
    description: 'Raise a deduplicated service alert after a registered HTTPS or TCP target crosses its failure threshold.',
    nodes: [
      { id: 'trigger', type: 'trigger_health_check_failed', config: {}, position: { x: 40, y: 140 } },
      {
        id: 'alert',
        type: 'action_create_service_alert',
        config: {
          dedupeKey: 'endpoint-{{targetId}}',
          severity: 'critical',
          title: '{{target}} is unavailable',
          message: '{{protocol}} check for {{host}} failed: {{error}}',
        },
        position: { x: 360, y: 140 },
      },
    ],
    edges: [{ source: 'trigger', target: 'alert' }],
  },
  {
    id: 'monitored-endpoint-recovery',
    name: 'Monitored endpoint recovery cleanup',
    description: 'Resolve the endpoint service alert after the registered target crosses its recovery threshold.',
    nodes: [
      { id: 'trigger', type: 'trigger_health_check_recovered', config: {}, position: { x: 40, y: 140 } },
      {
        id: 'resolve',
        type: 'action_resolve_service_alerts',
        config: { category: 'general', dedupeKey: 'endpoint-{{targetId}}' },
        position: { x: 360, y: 140 },
      },
    ],
    edges: [{ source: 'trigger', target: 'resolve' }],
  },
  {
    id: 'attachment-malware-internal-ticket',
    name: 'Quarantined attachment security ticket',
    description:
      'When an upload is quarantined as malware, create an admin-only critical ticket with the original ticket and attachment references. Instantiating this template creates a draft; it never runs until an administrator publishes it.',
    nodes: [
      {
        id: 'trigger',
        type: 'trigger_attachment_malware_detected',
        config: {},
        position: { x: 40, y: 140 },
      },
      {
        id: 'create-ticket',
        type: 'action_create_internal_ticket',
        config: {
          subject: '[Security] Malware blocked on ticket {{ticketId}}',
          body:
            '<p>The attachment <strong>{{filename}}</strong> was quarantined after malware detection.</p><p>Original ticket: {{ticketId}}<br>Attachment: {{attachmentId}}<br>Uploaded by: {{uploadedBy}}</p>',
          category: 'SECURITY',
          severity: 'critical',
        },
        position: { x: 360, y: 140 },
      },
    ],
    edges: [{ source: 'trigger', target: 'create-ticket' }],
  },
  {
    id: 'group-join-auto-approval',
    name: 'Group join auto-approval',
    description:
      'When a ticket requests a specific group, queue the membership add automatically and close the ticket with a note. Only groups flagged "auto-approve joins" are fulfilled - the engine enforces this policy.',
    nodes: [
      { id: 'trigger', type: 'trigger_ticket_created', config: {}, position: { x: 40, y: 140 } },
      {
        id: 'check-group',
        type: 'logic_condition',
        config: {
          groups: [
            {
              match: 'all',
              comparisons: [{ field: 'joinGroupDn', op: 'contains', value: 'CN=' }],
            },
          ],
        },
        position: { x: 300, y: 120 },
      },
      {
        id: 'enqueue',
        type: 'action_enqueue_group_add',
        config: { groupDn: '{{joinGroupDn}}' },
        position: { x: 580, y: 60 },
      },
      {
        id: 'reply',
        type: 'action_add_ticket_response',
        config: {
          message:
            'Your membership request for {{joinGroupDn}} has been queued. Watch this ticket for confirmation.',
        },
        position: { x: 840, y: 60 },
      },
      { id: 'close', type: 'action_close_ticket', config: {}, position: { x: 1080, y: 60 } },
    ],
    edges: [
      { source: 'trigger', target: 'check-group' },
      { source: 'check-group', sourceHandle: 'true', target: 'enqueue' },
      { source: 'enqueue', target: 'reply' },
      { source: 'reply', target: 'close' },
    ],
  },
  {
    id: 'critical-ticket-escalation',
    name: 'Critical ticket escalation',
    description:
      'When a critical ticket arrives, email the on-call address and raise a critical service alert so it cannot be missed.',
    nodes: [
      { id: 'trigger', type: 'trigger_ticket_created', config: {}, position: { x: 40, y: 140 } },
      {
        id: 'check-severity',
        type: 'logic_condition',
        config: { field: 'severity', equals: 'critical' },
        position: { x: 300, y: 120 },
      },
      {
        id: 'email',
        type: 'action_send_email',
        config: {
          to: '',
          subject: '[Critical] {{ticket.subject}}',
          body: 'A critical ticket was created by {{ticket.username}}: {{ticket.subject}}.',
        },
        position: { x: 580, y: 40 },
      },
      {
        id: 'alert',
        type: 'action_create_service_alert',
        config: {
          dedupeKey: 'critical-ticket',
          severity: 'critical',
          title: 'Critical ticket received',
          message: 'Ticket {{ticket.id}} - {{ticket.subject}}',
        },
        position: { x: 580, y: 220 },
      },
    ],
    edges: [
      { source: 'trigger', target: 'check-severity' },
      { source: 'check-severity', sourceHandle: 'true', target: 'email' },
      { source: 'check-severity', sourceHandle: 'false', target: 'alert' },
    ],
  },
  {
    id: 'dc-outage-response',
    name: 'Directory outage alert + banner',
    description:
      'When the primary directory stops answering, raise a directory service alert and show a site banner. A second graph on recovery resolves them automatically.',
    nodes: [
      { id: 'trigger', type: 'trigger_dc_unreachable', config: {}, position: { x: 40, y: 140 } },
      {
        id: 'alert',
        type: 'action_create_service_alert',
        config: {
          dedupeKey: 'directory-unreachable',
          severity: 'critical',
          title: 'Primary directory unreachable',
          message: 'The directory health probe cannot reach any configured server.',
        },
        position: { x: 320, y: 60 },
      },
      {
        id: 'banner',
        type: 'action_create_notification_banner',
        config: {
          message: 'Sign-in and directory lookups may be slow or unavailable. Staff are investigating.',
          type: 'warning',
          expiresMinutes: '60',
        },
        position: { x: 600, y: 220 },
      },
    ],
    edges: [
      { source: 'trigger', target: 'alert' },
      { source: 'alert', target: 'banner' },
    ],
  },
  {
    id: 'dc-recovery-resolve',
    name: 'Directory recovery cleanup',
    description:
      'When the directory answers again, resolve the outage alert, clear the banner, and notify staff that service is restored.',
    nodes: [
      { id: 'trigger', type: 'trigger_dc_recovered', config: {}, position: { x: 40, y: 140 } },
      {
        id: 'resolve',
        type: 'action_resolve_service_alerts',
        config: { category: 'directory', dedupeKey: 'directory-unreachable' },
        position: { x: 320, y: 60 },
      },
      {
        id: 'email',
        type: 'action_send_email',
        config: {
          to: '',
          subject: '[Resolved] Directory reachable again',
          body: 'The directory health probe succeeded. Outage alerts were resolved automatically.',
        },
        position: { x: 600, y: 220 },
      },
    ],
    edges: [
      { source: 'trigger', target: 'resolve' },
      { source: 'resolve', target: 'email' },
    ],
  },
  {
    id: 'failed-lifecycle-alert',
    name: 'Notify on failed lifecycle action',
    description:
      'When a queued lifecycle action fails on a high-impact action type (disable or VPN revoke), email the admins with the affected user, action type, and error so nothing stalls silently.',
    nodes: [
      {
        id: 'trigger',
        type: 'trigger_lifecycle_action_failed',
        config: {},
        position: { x: 40, y: 140 },
      },
      {
        id: 'check-impact',
        type: 'logic_condition',
        config: {
          groups: [
            {
              match: 'any',
              comparisons: [
                {
                  field: 'actionType',
                  op: 'in',
                  value: ['disable_ad', 'disable_both', 'enable_both', 'revoke_vpn'],
                },
              ],
            },
          ],
        },
        position: { x: 320, y: 140 },
      },
      {
        id: 'email',
        type: 'action_send_email',
        config: {
          to: '',
          subject: '[Lifecycle] {{actionType}} failed for {{username}}',
          body:
            'Lifecycle action "{{actionType}}" for {{username}} failed.\n\nError: {{error}}\nAction ID: {{actionId}}\n\nInspect the lifecycle queue and retry once resolved.',
        },
        position: { x: 600, y: 140 },
      },
    ],
    edges: [
      { source: 'trigger', target: 'check-impact' },
      { source: 'check-impact', sourceHandle: 'true', target: 'email' },
    ],
  },
  {
    id: 'lifecycle-banner-cleanup',
    name: 'Cleanup banner when lifecycle completes',
    description:
      'Pair with a graph that raises a site banner during enforcement. When any lifecycle action this workflow started completes successfully, clear the banners the graph created - no stale warnings left behind.',
    nodes: [
      {
        id: 'trigger',
        type: 'trigger_lifecycle_action_completed',
        config: {},
        position: { x: 40, y: 140 },
      },
      {
        id: 'clear-banner',
        type: 'action_clear_notification_banner',
        config: { createdByGraph: true },
        position: { x: 320, y: 140 },
      },
    ],
    edges: [{ source: 'trigger', target: 'clear-banner' }],
  },
];
