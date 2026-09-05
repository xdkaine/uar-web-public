export interface PrivilegeRow {
  permissionKey: string;
  description: string;
  adGroupDns: string[];
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface PrivilegesData {
  privileges: PrivilegeRow[];
  legacyAdminGroupDns: string[];
  operationalGaps: Array<{
    groupDn: string;
    missingPermissions: string[];
  }>;
}

const AREA_LABELS: Array<{ prefix: string; label: string }> = [
  { prefix: 'access_requests', label: 'Access Requests' },
  { prefix: 'tickets', label: 'Support Tickets' },
  { prefix: 'users', label: 'Directory Users' },
  { prefix: 'sessions', label: 'Sessions' },
  { prefix: 'lifecycle', label: 'Lifecycle & Sync' },
  { prefix: 'communications', label: 'Communications' },
  { prefix: 'offboard', label: 'Offboarding' },
  { prefix: 'password_expiration', label: 'Password Expiration' },
  { prefix: 'vpn', label: 'VPN' },
  { prefix: 'audit', label: 'Audit' },
  { prefix: 'service_alerts', label: 'Service Alerts' },
  { prefix: 'automation', label: 'Automation' },
  { prefix: 'events', label: 'Events' },
  { prefix: 'batch', label: 'Batch Accounts' },
  { prefix: 'blocklist', label: 'Blocklist' },
  { prefix: 'ratelimits', label: 'Rate Limiting' },
  { prefix: 'admin', label: 'Administration' },
];

function areaFor(key: string): string {
  const area = AREA_LABELS.find((entry) => key.startsWith(`${entry.prefix}.`));
  if (area) return area.label;
  const dotIndex = key.indexOf('.');
  return dotIndex > 0 ? key.slice(0, dotIndex) : 'Other';
}

export function groupPrivileges(privileges: PrivilegeRow[], filter: string): Map<string, PrivilegeRow[]> {
  const term = filter.trim().toLowerCase();
  const sections = new Map<string, PrivilegeRow[]>();
  for (const privilege of privileges) {
    const matches = !term
      || privilege.permissionKey.toLowerCase().includes(term)
      || privilege.description.toLowerCase().includes(term);
    if (!matches) continue;

    const area = areaFor(privilege.permissionKey);
    const entries = sections.get(area) ?? [];
    entries.push(privilege);
    sections.set(area, entries);
  }
  return sections;
}
