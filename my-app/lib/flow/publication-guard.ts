import { FLOW_NODE_CATALOG } from './catalog';

/** Stable IDs inserted by the example-workflow migration. They are reference
 * material, not operator-owned automation configuration. */
export const SEEDED_WORKFLOW_EXAMPLE_IDS = new Set([
  'flowseed_autojoin01',
  'flowseed_outage02',
  'flowseed_recover03',
]);

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const URL_CONFIG_FIELDS = new Set(['url', 'uri', 'href', 'endpoint']);
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isSeededWorkflowExample(id: string): boolean {
  return SEEDED_WORKFLOW_EXAMPLE_IDS.has(id);
}

function isReservedHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.invalid')
    || normalized.endsWith('.test')
    || normalized === 'example.com'
    || normalized.endsWith('.example.com')
    || normalized === 'example.net'
    || normalized.endsWith('.example.net')
    || normalized === 'example'
    || normalized.endsWith('.example')
    || normalized === 'example.org'
    || normalized.endsWith('.example.org')
    || normalized === 'example.edu'
    || normalized.endsWith('.example.edu')
    || normalized === 'sample'
    || normalized.endsWith('.sample');
}

function graphRuntimeTokens(nodes: unknown): Set<string> {
  const tokens = new Set<string>();
  if (!Array.isArray(nodes)) return tokens;
  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== 'object') continue;
    const node = rawNode as { type?: unknown };
    if (typeof node.type !== 'string') continue;
    const definition = FLOW_NODE_CATALOG[node.type];
    if (definition?.category !== 'trigger' && definition?.category !== 'source') continue;
    for (const field of definition.contextFields ?? []) tokens.add(field.key);
  }
  return tokens;
}

function executableValues(config: unknown): Array<{ path: string; kind: 'recipient' | 'url'; value: string }> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const values: Array<{ path: string; kind: 'recipient' | 'url'; value: string }> = [];
  for (const [key, rawValue] of Object.entries(config)) {
    const kind = key === 'to' || key === 'recipient' || key === 'recipients'
      ? 'recipient'
      : URL_CONFIG_FIELDS.has(key)
        ? 'url'
        : null;
    if (!kind) continue;
    if (typeof rawValue === 'string') values.push({ path: key, kind, value: rawValue });
    if (Array.isArray(rawValue)) {
      rawValue.forEach((entry, index) => {
        if (typeof entry === 'string') values.push({ path: `${key}[${index}]`, kind, value: entry });
      });
    }
  }
  return values;
}

function monitorHosts(config: unknown): Array<{ path: string; value: string }> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const checks = (config as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return [];
  return checks.flatMap((check, index) => {
    if (!check || typeof check !== 'object') return [];
    const host = (check as { host?: unknown }).host;
    return typeof host === 'string' ? [{ path: `checks[${index}].host`, value: host }] : [];
  });
}

function validateRecipient(value: string, label: string): string[] {
  const errors: string[] = [];
  const addresses = value.split(/[\s,;]+/).filter(Boolean);
  if (addresses.length === 0) return [`${label} requires at least one recipient address`];
  for (const address of addresses) {
    if (address.includes('{{')) {
      errors.push(`${label} must use explicit recipient email addresses; runtime tokens are not valid recipients`);
      continue;
    }
    if (!EMAIL_ADDRESS.test(address)) {
      errors.push(`${label} has an invalid recipient address "${address}"`);
      continue;
    }
    const host = address.slice(address.lastIndexOf('@') + 1);
    if (host && isReservedHost(host)) {
      errors.push(`${label} uses the reserved/example destination "${host}"`);
    }
  }
  return errors;
}

/** Runtime backstop for graphs published before destination guards existed. */
export function validateWorkflowEmailRecipients(value: string): string[] {
  return validateRecipient(value, 'Email recipient');
}

function validateUrl(value: string, label: string, tokens: Set<string>): string[] {
  const errors: string[] = [];
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (!tokens.has(match[1]!)) errors.push(`${label} uses unknown runtime token {{${match[1]}}}`);
  }
  const materialized = value.replace(PLACEHOLDER, (_match, name: string) => tokens.has(name) ? 'runtime-value' : 'invalid-token');
  try {
    const destination = new URL(materialized);
    if (!['https:', 'http:'].includes(destination.protocol)) {
      errors.push(`${label} must use an http(s) URL`);
    } else if (isReservedHost(destination.hostname)) {
      errors.push(`${label} uses the reserved/example destination "${destination.hostname}"`);
    }
  } catch {
    errors.push(`${label} has an invalid URL destination`);
  }
  return errors;
}

/**
 * Publication-only guard. Drafts intentionally remain editable, including
 * examples and unresolved placeholders, so operators can use them as working
 * material. Only executable destinations are inspected; descriptions and
 * other explanatory copy are never treated as runnable configuration.
 */
export function validateWorkflowPublication(nodes: unknown): string[] {
  const errors: string[] = [];
  const tokens = graphRuntimeTokens(nodes);
  if (!Array.isArray(nodes)) return errors;

  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== 'object') continue;
    const node = rawNode as { id?: unknown; type?: unknown; config?: unknown };
    const nodeLabel = typeof node.id === 'string' ? `Node ${node.id}` : 'Workflow node';
    for (const entry of executableValues(node.config)) {
      const fieldLabel = `${nodeLabel} ${entry.path}`;
      errors.push(...(entry.kind === 'recipient'
        ? validateRecipient(entry.value, fieldLabel)
        : validateUrl(entry.value, fieldLabel, tokens)));
    }
    if (node.type === 'source_monitor_endpoints') {
      for (const entry of monitorHosts(node.config)) {
        if (isReservedHost(entry.value)) {
          errors.push(`${nodeLabel} ${entry.path} uses the reserved/example destination "${entry.value}"`);
        }
      }
    }
  }

  return Array.from(new Set(errors));
}
