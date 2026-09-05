export const AUTOMATION_TRIGGER_KEYS = [
  'dc_unreachable',
  'dc_recovered',
  'ticket_created',
] as const;

export type AutomationTriggerKey = (typeof AUTOMATION_TRIGGER_KEYS)[number];

export function isAutomationTriggerKey(value: unknown): value is AutomationTriggerKey {
  return (
    typeof value === 'string' &&
    (AUTOMATION_TRIGGER_KEYS as readonly string[]).includes(value)
  );
}

export interface DcProbeAutomationContext {
  probeSource: string;
  target: string;
  error?: string;
}

export interface TicketCreatedAutomationContext {
  ticketId: string;
  ticketSubject: string;
  ticketCategory: string | null;
  ticketSeverity: string | null;
  creatorUsername: string;
  joinGroupDn: string | null;
  requestedForGroupDn: string | null;
}

export type AutomationContext = Record<string, unknown>;

export type ConditionConfig =
  | { key: 'context_field_equals'; field: string; value: string }
  | { key: 'context_field_exists'; field: string };

export const AUTOMATION_ACTION_DEFS = {
  create_service_alert: {
    description: 'Create or re-occurrence-count a categorized service alert',
    configLimit: { dedupeKey: 200, title: 200, message: 4000 },
    categories: ['directory', 'email', 'storage', 'general'],
    severities: ['info', 'warning', 'critical'],
  },
  resolve_service_alerts: { description: 'Resolve active service alerts for a source' },
  send_email: { description: 'Send a plain-text email to fixed recipients' },
  enqueue_group_add: {
    description:
      'Queue an AD group-membership add for the ticket requester via the lifecycle queue',
  },
  add_ticket_response: { description: 'Post an automated staff response on the ticket' },
  close_ticket: { description: 'Close the ticket with an automated status log entry' },
} as const;

export type AutomationActionKey = keyof typeof AUTOMATION_ACTION_DEFS;

export function isAutomationActionKey(value: unknown): value is AutomationActionKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AUTOMATION_ACTION_DEFS, value);
}

export type ActionSpec =
  | {
      key: 'create_service_alert';
      config: {
        dedupeKey: string;
        category: string;
        severity: string;
        title: string;
        message: string;
      };
    }
  | { key: 'resolve_service_alerts'; config: { source: string } }
  | { key: 'send_email'; config: { to: string[]; subject: string; body: string } }
  | { key: 'enqueue_group_add' }
  | { key: 'add_ticket_response'; config: { message: string } }
  | { key: 'close_ticket' };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateString(
  value: unknown,
  label: string,
  min: number,
  max: number,
  errors: string[]
): string | null {
  if (typeof value !== 'string') {
    errors.push(`${label} must be a string`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    errors.push(`${label} must be ${min}-${max} characters`);
    return null;
  }
  return trimmed;
}

export function validateCondition(raw: unknown): { ok: true; condition: ConditionConfig } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'Each condition must be an object' };
  }
  const key = raw.key;
  const errors: string[] = [];
  if (key === 'context_field_equals') {
    const field = validateString(raw.field, 'condition.field', 1, 200, errors);
    const value = validateString(raw.value, 'condition.value', 0, 1000, errors);
    if (errors.length > 0 || !field || value === null) {
      return { ok: false, error: errors.join('; ') };
    }
    return { ok: true, condition: { key, field, value } };
  }
  if (key === 'context_field_exists') {
    const field = validateString(raw.field, 'condition.field', 1, 200, errors);
    if (errors.length > 0 || !field) {
      return { ok: false, error: errors.join('; ') };
    }
    return { ok: true, condition: { key, field } };
  }
  return { ok: false, error: `Unknown condition key: ${String(key)}` };
}

export function validateAction(raw: unknown): { ok: true; action: ActionSpec } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'Each action must be an object' };
  }
  const key = raw.key;
  if (!isAutomationActionKey(key)) {
    return { ok: false, error: `Unknown action key: ${String(key)}` };
  }
  const config = raw.config ?? {};
  if (!isPlainObject(config)) {
    return { ok: false, error: `Action "${key}" config must be an object when present` };
  }
  const errors: string[] = [];

  if (key === 'create_service_alert') {
    const limits = AUTOMATION_ACTION_DEFS.create_service_alert.configLimit;
    const dedupeKey = validateString(config.dedupeKey, 'create_service_alert.dedupeKey', 1, limits.dedupeKey, errors);
    const category = validateString(config.category, 'create_service_alert.category', 1, 40, errors);
    const severity = typeof config.severity === 'undefined' ? 'warning' : validateString(config.severity, 'create_service_alert.severity', 1, 20, errors);
    const title = validateString(config.title, 'create_service_alert.title', 1, limits.title, errors);
    const message = validateString(config.message, 'create_service_alert.message', 1, limits.message, errors);
    if (category && !(AUTOMATION_ACTION_DEFS.create_service_alert.categories as readonly string[]).includes(category)) {
      errors.push(`create_service_alert.category must be one of: ${AUTOMATION_ACTION_DEFS.create_service_alert.categories.join(', ')}`);
    }
    if (typeof severity === 'string' && !(AUTOMATION_ACTION_DEFS.create_service_alert.severities as readonly string[]).includes(severity)) {
      errors.push(`create_service_alert.severity must be one of: ${AUTOMATION_ACTION_DEFS.create_service_alert.severities.join(', ')}`);
    }
    if (errors.length > 0 || !dedupeKey || !category || typeof severity !== 'string' || !title || !message) {
      return { ok: false, error: errors.join('; ') || 'create_service_alert requires dedupeKey, category, severity, title, message' };
    }
    return { ok: true, action: { key, config: { dedupeKey, category, severity, title, message } } };
  }

  if (key === 'resolve_service_alerts') {
    const source = validateString(config.source, 'resolve_service_alerts.source', 1, 120, errors);
    if (errors.length > 0 || !source) {
      return { ok: false, error: errors.join('; ') };
    }
    return { ok: true, action: { key, config: { source } } };
  }

  if (key === 'send_email') {
    const toRaw = config.to;
    if (!Array.isArray(toRaw) || toRaw.length < 1 || toRaw.length > 10) {
      return { ok: false, error: 'send_email.to must contain 1-10 recipients' };
    }
    const to: string[] = [];
    for (const entry of toRaw) {
      if (typeof entry !== 'string' || !EMAIL_PATTERN.test(entry.trim().toLowerCase())) {
        return { ok: false, error: 'send_email.to entries must be valid email addresses' };
      }
      to.push(entry.trim().toLowerCase());
    }
    const subject = validateString(config.subject, 'send_email.subject', 1, 300, errors);
    const body = validateString(config.body, 'send_email.body', 1, 10000, errors);
    if (errors.length > 0 || !subject || !body) {
      return { ok: false, error: errors.join('; ') };
    }
    return { ok: true, action: { key, config: { to, subject, body } } };
  }

  if (key === 'enqueue_group_add') {
    for (const forbidden of Object.keys(config)) {
      errors.push(`enqueue_group_add does not accept config field "${forbidden}"`);
    }
    if (errors.length > 0) {
      return { ok: false, error: errors.join('; ') };
    }
    return { ok: true, action: { key } };
  }

  if (key === 'add_ticket_response') {
    const message = validateString(config.message, 'add_ticket_response.message', 1, 4000, errors);
    if (errors.length > 0 || !message) {
      return { ok: false, error: errors.join('; ') };
    }
    return { ok: true, action: { key, config: { message } } };
  }

  if (key === 'close_ticket') {
    for (const forbidden of Object.keys(config)) {
      errors.push(`close_ticket does not accept config field "${forbidden}"`);
    }
    if (errors.length > 0) {
      return { ok: false, error: errors.join('; ') };
    }
    return { ok: true, action: { key } };
  }

  return { ok: false, error: `Unhandled action key: ${String(key)}` };
}

export interface ValidatedRuleDefinition {
  conditions: ConditionConfig[];
  actions: ActionSpec[];
}

export function validateRuleDefinition(raw: {
  conditions?: unknown;
  actions?: unknown;
}): { ok: true; definition: ValidatedRuleDefinition } | { ok: false; error: string } {
  if (!Array.isArray(raw.conditions) || raw.conditions.length > 20) {
    return { ok: false, error: 'conditions must be an array of at most 20 entries' };
  }
  if (!Array.isArray(raw.actions) || raw.actions.length < 1 || raw.actions.length > 20) {
    return { ok: false, error: 'actions must be an array of 1-20 entries' };
  }
  const conditions: ConditionConfig[] = [];
  for (const entry of raw.conditions) {
    const result = validateCondition(entry);
    if (!result.ok) return result;
    conditions.push(result.condition);
  }
  const actions: ActionSpec[] = [];
  for (const entry of raw.actions) {
    const result = validateAction(entry);
    if (!result.ok) return result;
    actions.push(result.action);
  }
  return { ok: true, definition: { conditions, actions } };
}

const TEMPLATE_TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function renderTemplate(template: string, context: AutomationContext): string {
  return template.replace(TEMPLATE_TOKEN, (_match, path: string) => {
    const value = getContextField(context, path);
    if (value === undefined || value === null) {
      throw new Error(`Template references missing context field "${path}"`);
    }
    return String(value);
  });
}

export function getContextField(context: AutomationContext, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
