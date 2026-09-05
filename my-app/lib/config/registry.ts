/**
 * Typed registry for persisted, non-secret operational configuration
 * (ADR-0005). A configuration key exists only if it is defined here; the
 * registry records the environment variable each key migrates away from and
 * the value the code uses today when nothing is configured.
 *
 * Operator-managed bind/SMTP passwords use the separate encrypted secret
 * registry with environment fallback. Platform keys, session/CSRF/Turnstile/
 * cron secrets, database credentials, and TLS trust material remain
 * deployment-owned security boundaries.
 */

import {
  validateNavLinks,
  validateRequestInternalContent,
  validateRequestExternalContent,
  validateAppearanceTheme,
} from '@/lib/appearance';

export type ConfigValueType = 'string' | 'integer' | 'stringList' | 'secret';

export type ConfigSource = 'database' | 'environment' | 'default';

export interface SecretConfigDefinition {
  key: string;
  valueType: 'secret';
  description: string;
  /** Legacy environment variable holding the plaintext secret. */
  envFallback: string;
  /** Whether operations fail loudly when neither storage nor env provides one. */
  required: boolean;
}

export interface ConfigDefinition<T = unknown> {
  key: string;
  valueType: ConfigValueType;
  description: string;
  /** Legacy environment variable this key migrates away from. */
  envFallback?: string;
  /** The value used today when neither database nor environment provides one. */
  safeDefault: T;
  /** Validates raw values from write requests or stored rows. */
  validate(value: unknown): T;
  /** Parses the legacy environment string into the typed value. */
  parseEnv(raw: string): T;
}

function stringDefinition(options: {
  key: string;
  description: string;
  envFallback?: string;
  safeDefault?: string;
  required?: boolean;
  pattern?: RegExp;
  patternError?: string;
}): ConfigDefinition<string> {
  return {
    key: options.key,
    valueType: 'string',
    description: options.description,
    envFallback: options.envFallback,
    safeDefault: options.safeDefault ?? '',
    validate(value: unknown) {
      if (typeof value !== 'string') {
        throw new Error(`${options.key} must be a string`);
      }
      const trimmed = value.trim();
      if ((options.required ?? false) && !trimmed) {
        throw new Error(`${options.key} must not be empty`);
      }
      if (options.pattern && trimmed && !options.pattern.test(trimmed)) {
        throw new Error(options.patternError ?? `${options.key} has an invalid format`);
      }
      return trimmed;
    },
    parseEnv(raw: string) {
      return this.validate(raw);
    },
  };
}

function integerDefinition(options: {
  key: string;
  description: string;
  envFallback?: string;
  safeDefault: number;
  min: number;
  max: number;
}): ConfigDefinition<number> {
  return {
    key: options.key,
    valueType: 'integer',
    description: options.description,
    envFallback: options.envFallback,
    safeDefault: options.safeDefault,
    validate(value: unknown) {
      const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
      if (!Number.isInteger(parsed)) {
        throw new Error(`${options.key} must be an integer`);
      }
      if (parsed < options.min || parsed > options.max) {
        throw new Error(`${options.key} must be between ${options.min} and ${options.max}`);
      }
      return parsed;
    },
    parseEnv(raw: string) {
      return this.validate(raw);
    },
  };
}

function stringListDefinition(options: {
  key: string;
  description: string;
  envFallback?: string;
  /**
   * Legacy environment variables such as STUDENT_DIRECTOR_EMAILS hold
   * comma-separated lists; when set, parseEnv splits on commas instead of
   * treating the whole variable as one entry.
   */
  commaSplitEnv?: boolean;
  /** Plain text input represents one complete item (for comma-bearing values such as LDAP DNs). */
  preserveCommas?: boolean;
}): ConfigDefinition<string[]> {
  return {
    key: options.key,
    valueType: 'stringList',
    description: options.description,
    envFallback: options.envFallback,
    safeDefault: [],
    validate(value: unknown) {
      let entries: unknown[];
      if (Array.isArray(value)) {
        entries = value;
      } else if (typeof value === 'string') {
        // Stored as JSON array; also accept comma-separated for operator convenience.
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
          try {
            entries = JSON.parse(trimmed) as unknown[];
          } catch {
            throw new Error(`${options.key} contains invalid JSON`);
          }
        } else if (options.preserveCommas) {
          entries = [trimmed];
        } else {
          entries = trimmed.split(',');
        }
      } else {
        throw new Error(`${options.key} must be a list of strings`);
      }
      const cleaned = entries.map((entry) => String(entry).trim()).filter(Boolean);
      if (cleaned.some((entry) => entry.length > 400)) {
        throw new Error(`${options.key} entries must not exceed 400 characters`);
      }
      return Array.from(new Set(cleaned));
    },
    parseEnv(raw: string) {
      // Mirrors legacy list parsing (e.g. LDAP_ADMIN_GROUPS): a JSON array is
      // a list; anything else is a single value. Splitting on commas would
      // shred comma-containing entries such as distinguished names.
      const trimmed = raw.trim();
      if (trimmed.startsWith('[')) {
        return this.validate(trimmed);
      }
      if (options.commaSplitEnv) {
        return this.validate(trimmed.split(','));
      }
      return this.validate([trimmed]);
    },
  };
}

export const CONFIG_REGISTRY: Record<string, ConfigDefinition> = {
  'attachments.maxFiles': integerDefinition({
    key: 'attachments.maxFiles',
    description: 'Maximum attachment count per support ticket',
    safeDefault: 50,
    min: 1,
    max: 100,
  }),
  'attachments.maxFileBytes': integerDefinition({
    key: 'attachments.maxFileBytes',
    description: 'Maximum bytes allowed for one support-ticket attachment',
    safeDefault: 20 * 1024 * 1024,
    min: 1024,
    max: 20 * 1024 * 1024,
  }),
  'attachments.maxTicketBytes': integerDefinition({
    key: 'attachments.maxTicketBytes',
    description: 'Maximum aggregate attachment bytes allowed per support ticket',
    safeDefault: 1024 * 1024 * 1024,
    min: 1024,
    max: 2 * 1024 * 1024 * 1024,
  }),
  'ldap.url': stringDefinition({
    key: 'ldap.url',
    description: 'LDAP directory URL (ldaps:// strongly preferred; ldaps:// is enforced at client creation)',
    envFallback: 'LDAP_URL',
  }),
  'ldap.failoverUrls': stringListDefinition({
    key: 'ldap.failoverUrls',
    description:
      'Additional ldaps:// domain controller URLs tried in order when the primary is unreachable. Each must start with ldaps://.',
    envFallback: 'LDAP_FAILOVER_URLS',
  }),
  'ldap.searchBase': stringDefinition({
    key: 'ldap.searchBase',
    description: 'Default LDAP search base DN for user accounts',
    envFallback: 'LDAP_SEARCH_BASE',
  }),
  'ldap.groupSearchBase': stringDefinition({
    key: 'ldap.groupSearchBase',
    description: 'LDAP search base DN for group lookups',
    envFallback: 'LDAP_GROUPSEARCH',
  }),
  'ldap.bindDn': stringDefinition({
    key: 'ldap.bindDn',
    description: 'Bind account distinguished name; the password is stored separately as an encrypted secret.',
    envFallback: 'LDAP_BIND_DN',
  }),
  'ldap.domain': stringDefinition({
    key: 'ldap.domain',
    description: 'Directory domain used to build user principal names',
    envFallback: 'LDAP_DOMAIN',
  }),
  'ldap.adminGroups': stringListDefinition({
    key: 'ldap.adminGroups',
    description: 'Group DNs whose members are treated as domain administrators (legacy administrator gate)',
    envFallback: 'LDAP_ADMIN_GROUPS',
    preserveCommas: true,
  }),
  'ldap.kaminoInternalGroup': stringDefinition({
    key: 'ldap.kaminoInternalGroup',
    description: 'AD group DN for internal provisioning targets',
    envFallback: 'LDAP_KAMINO_INTERNAL_GROUP',
  }),
  'ldap.kaminoExternalGroup': stringDefinition({
    key: 'ldap.kaminoExternalGroup',
    description: 'AD group DN for external provisioning targets',
    envFallback: 'LDAP_KAMINO_EXTERNAL_GROUP',
  }),
  'ldap.group2Add': stringDefinition({
    key: 'ldap.group2Add',
    description: 'AD group DN used as the target when adding members via group management',
    envFallback: 'LDAP_GROUP2ADD',
  }),
  'smtp.host': stringDefinition({
    key: 'smtp.host',
    description: 'SMTP relay hostname; the password is stored separately as an encrypted secret.',
    envFallback: 'SMTP_HOST',
  }),
  'smtp.port': integerDefinition({
    key: 'smtp.port',
    description: 'SMTP relay port (465 implies implicit TLS)',
    envFallback: 'SMTP_PORT',
    safeDefault: 587,
    min: 1,
    max: 65535,
  }),
  'smtp.user': stringDefinition({
    key: 'smtp.user',
    description: 'SMTP authentication username; the password is stored separately as an encrypted secret.',
    envFallback: 'SMTP_USER',
  }),
  // Notification routing addresses migrated out of the legacy SystemSettings
  // row into the configuration registry (ADR-0005 incremental consumer
  // migration). Until operators save overrides, lib/email-config.ts falls
  // back to the old SystemSettings columns, then these env vars.
  'email.from': stringDefinition({
    key: 'email.from',
    description: 'From address used on portal-generated email',
    envFallback: 'EMAIL_FROM',
  }),
  'email.admin': stringDefinition({
    key: 'email.admin',
    description: 'Administrator mailbox receiving operational notifications and ticket queue mail',
    envFallback: 'ADMIN_EMAIL',
  }),
  'email.faculty': stringDefinition({
    key: 'email.faculty',
    description: 'Faculty reviewer mailbox receiving pending-review notifications',
    envFallback: 'FACULTY_EMAIL',
  }),
  'email.studentDirectors': stringListDefinition({
    key: 'email.studentDirectors',
    description: 'Student-director recipient list for pending-review notifications',
    envFallback: 'STUDENT_DIRECTOR_EMAILS',
    commaSplitEnv: true,
  }),
  // Operational policy knobs migrated from environment/code constants
  // (ADR-0005 incremental consumer migration). Bounds mirror the validation
  // that applied to the legacy source so behavior cannot silently widen.
  'password.cleanup.retentionDays': integerDefinition({
    key: 'password.cleanup.retentionDays',
    description:
      'How long revealed batch credentials are retained before the password cleanup job removes them (1-30 days, matching the legacy env validation)',
    envFallback: 'PASSWORD_CREDENTIAL_RETENTION_DAYS',
    safeDefault: 7,
    min: 1,
    max: 30,
  }),
  'governance.sodMode': stringDefinition({
    key: 'governance.sodMode',
    description:
      'Segregation-of-duties enforcement for access requests: "off" records nothing, "flag" annotates approvals where one actor performed an earlier stage, "block" rejects them. System administrators acting across stages are always flagged, never silently allowed.',
    safeDefault: 'off',
    pattern: /^(off|flag|block)$/,
    patternError: 'governance.sodMode must be one of: off, flag, block',
  }),
  // Appearance keys hold validated JSON documents (see lib/appearance.ts).
  // An empty stored value means "use the built-in defaults".
  'nav.links': {
    key: 'nav.links',
    valueType: 'string',
    description:
      'Navbar overrides as a JSON array of { label, href, section: "main"|"services", requiresAuth?, requiresAdmin? }. Empty value restores the built-in navigation.',
    safeDefault: '',
    validate(value: unknown) {
      return JSON.stringify(validateNavLinks(value));
    },
    parseEnv(raw: string) {
      return this.validate(raw);
    },
  } as ConfigDefinition<string>,
  'appearance.theme': {
    key: 'appearance.theme', valueType: 'string', description: 'Constrained portal theme tokens as JSON.', safeDefault: '',
    validate(value: unknown) { return JSON.stringify(validateAppearanceTheme(value)); },
    parseEnv(raw: string) { return this.validate(raw); },
  } as ConfigDefinition<string>,
  'pages.requestInternal': {
    key: 'pages.requestInternal',
    valueType: 'string',
    description:
      'Access-request internal page copy as JSON { title, subtitle, notice? }. Empty value restores built-in copy.',
    safeDefault: '',
    validate(value: unknown) {
      return JSON.stringify(validateRequestInternalContent(value));
    },
    parseEnv(raw: string) {
      return this.validate(raw);
    },
  } as ConfigDefinition<string>,
  'pages.requestExternal': {
    key: 'pages.requestExternal',
    valueType: 'string',
    description:
      'Access-request external page copy as JSON { title, subtitle, notice? }. Empty value restores built-in copy.',
    safeDefault: '',
    validate(value: unknown) {
      return JSON.stringify(validateRequestExternalContent(value));
    },
    parseEnv(raw: string) {
      return this.validate(raw);
    },
  } as ConfigDefinition<string>,
};

export type ConfigKey = keyof typeof CONFIG_REGISTRY;

export const ALL_CONFIG_KEYS = Object.keys(CONFIG_REGISTRY);

/**
 * Secret keys are managed like configuration (editable, auditable) but stored
 * ENCRYPTED and never returned by read APIs. Until a dedicated secret
 * provider exists this is the sanctioned way to move service-account
 * credentials out of plain environment variables (ADR-0006).
 */
export const SECRET_CONFIG_REGISTRY: Record<string, SecretConfigDefinition> = {
  'ldap.bindPassword': {
    key: 'ldap.bindPassword',
    valueType: 'secret',
    description: 'Bind account password for the LDAP service account',
    envFallback: 'LDAP_BIND_PASSWORD',
    required: true,
  },
  'smtp.password': {
    key: 'smtp.password',
    valueType: 'secret',
    description: 'SMTP relay authentication password',
    envFallback: 'SMTP_PASSWORD',
    required: true,
  },
};

export function getSecretDefinition(key: string): SecretConfigDefinition | null {
  return (SECRET_CONFIG_REGISTRY as Record<string, SecretConfigDefinition>)[key] ?? null;
}

export function getConfigDefinition(key: string): ConfigDefinition | null {
  return (CONFIG_REGISTRY as Record<string, ConfigDefinition>)[key] ?? null;
}

/** True for value keys AND secret keys (both are writable configuration). */
export function isKnownConfigKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONFIG_REGISTRY, key) ||
    Object.prototype.hasOwnProperty.call(SECRET_CONFIG_REGISTRY, key);
}
