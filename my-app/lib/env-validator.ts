import { parseLDAPCACertificate } from './ldap/ca-certificate';
import { isProductionCloneReadOnly } from './clone-safety';

interface EnvConfig {
  // Database
  DATABASE_URL: string;
  DATABASE_SSL_ALLOW_INSECURE?: string;

  // Email Configuration
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  EMAIL_FROM: string;
  ADMIN_EMAIL: string;

  // LDAP Configuration
  LDAP_URL: string;
  LDAP_BIND_DN: string;
  LDAP_BIND_PASSWORD: string;
  LDAP_SEARCH_BASE: string;
  LDAP_DOMAIN: string;
  LDAP_ADMIN_GROUPS: string;
  LDAP_GROUP2ADD: string;
  LDAP_KAMINO_INTERNAL_GROUP: string;
  LDAP_KAMINO_EXTERNAL_GROUP: string;
  LDAP_GROUPSEARCH: string;
  LDAP_TIMEOUT?: string; // Optional timeout in milliseconds, defaults to 30000 (30s)
  LDAP_MAX_RETRIES?: string; // Optional max retries for LDAP operations, defaults to 3
  LDAP_RETRY_DELAY?: string; // Optional delay between retries in milliseconds, defaults to 1000 (1s)
  LDAP_ALLOW_INVALID_CERTS?: string; // Optional; true disables LDAPS certificate verification (lab use only)
  LDAP_CA_CERT_BASE64?: string; // Optional PEM CA certificate encoded as base64
  LDAP_DOMAIN_SEARCH_BASE?: string;
  PASSWORD_EXPIRATION_WARNING_DAYS?: string;
  PASSWORD_EXPIRATION_SCHEDULER_ENABLED?: string;
  PASSWORD_CLEANUP_SCHEDULER_ENABLED?: string;
  PASSWORD_CREDENTIAL_RETENTION_DAYS?: string;
  PASSWORD_CLEANUP_INTERVAL_SECONDS?: string;
  PASSWORD_CLEANUP_INITIAL_DELAY_SECONDS?: string;
  PASSWORD_CLEANUP_HEALTH_MAX_AGE_SECONDS?: string;

  // Application
  NEXT_PUBLIC_APP_URL: string;
  NEXTAUTH_SECRET: string;
  NODE_ENV?: string;
  TRUST_PROXY_HEADERS?: string;
  SESSION_COOKIE_ALLOW_INSECURE?: string;
  CRON_SECRET?: string;
  OFFBOARD_SCHEDULER_ENABLED?: string;
  OFFBOARD_SCHEDULER_GRACE_SECONDS?: string;
  LIFECYCLE_QUEUE_SCHEDULER_ENABLED?: string;
  LIFECYCLE_QUEUE_SCHEDULER_INTERVAL_SECONDS?: string;
  LIFECYCLE_QUEUE_SCHEDULER_INITIAL_DELAY_SECONDS?: string;
  LIFECYCLE_QUEUE_SCHEDULER_HEALTH_MAX_AGE_SECONDS?: string;
  TICKET_GROUP_SYNC_ENABLED?: string;
  DIRECTORY_PROBE_ENABLED?: string;
  WORKFLOW_TICK_ENABLED?: string;
  OPERATIONAL_DETECTOR_SCHEDULER_ENABLED?: string;
  OPERATIONAL_DETECTOR_INTERVAL_SECONDS?: string;
  OPERATIONAL_DETECTOR_HEALTH_MAX_AGE_SECONDS?: string;
  FLOW_OUTBOX_SCHEDULER_ENABLED?: string;
  FLOW_OUTBOX_INTERVAL_SECONDS?: string;
  FLOW_OUTBOX_HEALTH_MAX_AGE_SECONDS?: string;
  MONITORED_ENDPOINTS_SCHEDULER_ENABLED?: string;
  MONITORED_ENDPOINTS_INTERVAL_SECONDS?: string;
  MONITORED_ENDPOINTS_HEALTH_MAX_AGE_SECONDS?: string;
  MONITOR_PROBE_URL?: string;
  MONITOR_PROBE_SHARED_SECRET?: string;
  ATTACHMENT_QUARANTINE_PURGE_ENABLED?: string;
  ATTACHMENT_QUARANTINE_PURGE_INTERVAL_SECONDS?: string;
  ATTACHMENT_QUARANTINE_PURGE_HEALTH_MAX_AGE_SECONDS?: string;

  // Auth service (ADR-0012) login rate limiting; consumed by the auth-service
  // container but validated here too so a shared .env fails fast.
  AUTH_LOGIN_WINDOW_MS?: string;
  AUTH_LOGIN_MAX_ATTEMPTS?: string;
  AUTH_ACCOUNT_LOCK_WINDOW_MS?: string;
  AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS?: string;
  AUTH_OIDC_OUTAGE_FALLBACK?: string;
  AUTH_OIDC_ALTERNATE_SIGNIN?: string;
  AUTH_OIDC_DISPLAY_NAME?: string;
  AUTH_OIDC_DISPLAY_DESCRIPTION?: string;
  AUTH_ALLOW_INSECURE_OIDC?: string;
  AUTH_OIDC_SESSION_MAX_AGE?: string;
  OIDC_INTERNAL_ISSUER_URL?: string;

  // Internal asset store (ADR-0010)
  ASSET_SHARED_SECRET?: string;
  CLAMAV_HOST?: string;
  CLAMAV_PORT?: string;
  CLAMAV_TIMEOUT_MS?: string;

  // Auth-service registry client-secret encryption key (AES-256-GCM)
  AUTH_CLIENT_SECRET_ENC_KEY?: string;

  // Security / Encryption
  ENCRYPTION_SECRET: string;
  ENCRYPTION_SALT: string;

  // Cloudflare Turnstile
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
}

const REQUIRED_ENV_VARS: (keyof EnvConfig)[] = [
  // Database
  'DATABASE_URL',

  // Application
  'NEXT_PUBLIC_APP_URL',
  'NEXTAUTH_SECRET',

  // Security / Encryption (Critical Security Requirements)
  'ENCRYPTION_SECRET',
  'ENCRYPTION_SALT',

  // Cloudflare Turnstile
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
];

function isKnownPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized
    || normalized.includes('replace_with')
    || normalized.includes('replace-me')
    || normalized.includes('changeme')
    || normalized.includes('example-secret')
    || normalized === 'password'
    || normalized === 'secret';
}

/**
 * Validates that all required environment variables are set
 * @throws Error if any required environment variable is missing or empty
 */
export function validateEnvironment(): void {
  const missing: string[] = [];
  const empty: string[] = [];

  for (const envVar of REQUIRED_ENV_VARS) {
    const value = process.env[envVar];

    if (value === undefined) {
      missing.push(envVar);
    } else if (value.trim() === '') {
      empty.push(envVar);
    }
  }

  if (missing.length > 0 || empty.length > 0) {
    const errorMessages: string[] = [
      '❌ CRITICAL: Environment configuration error!',
      '',
    ];

    if (missing.length > 0) {
      errorMessages.push('Missing environment variables:');
      missing.forEach(v => errorMessages.push(`  - ${v}`));
      errorMessages.push('');
    }

    if (empty.length > 0) {
      errorMessages.push('Empty environment variables:');
      empty.forEach(v => errorMessages.push(`  - ${v}`));
      errorMessages.push('');
    }

    errorMessages.push('Please check your .env file and ensure all required variables are set.');
    errorMessages.push('See .env.example for reference.');

    throw new Error(errorMessages.join('\n'));
  }

  if (process.env.NODE_ENV === 'production') {
    const productionSecrets = [
      'NEXTAUTH_SECRET',
      'ENCRYPTION_SECRET',
      'ENCRYPTION_SALT',
      'CRON_SECRET',
      'SMTP_PASSWORD',
      'LDAP_BIND_PASSWORD',
      'TURNSTILE_SECRET_KEY',
      'AUTH_CLIENT_SECRET',
      'AUTH_COOKIE_KEYS',
      'ASSET_SHARED_SECRET',
    ];
    const placeholders = productionSecrets.filter((name) => {
      const value = process.env[name];
      return value !== undefined && isKnownPlaceholderSecret(value);
    });
    if (placeholders.length > 0) {
      throw new Error(
        `CRITICAL: Known-placeholder or empty production secrets are forbidden: ${placeholders.join(', ')}`
      );
    }
  }

  // Reject mistyped clone-mode values before any service can fail open.
  isProductionCloneReadOnly();

  // Additional validation for specific formats
  validateSpecificFormats();
}

/**
 * Validates specific environment variable formats
 */
function validateSpecificFormats(): void {
  // Validate LDAP_TIMEOUT if provided
  if (process.env.LDAP_TIMEOUT) {
    const ldapTimeout = parseInt(process.env.LDAP_TIMEOUT, 10);
    if (isNaN(ldapTimeout) || ldapTimeout < 1000 || ldapTimeout > 60000) {
      throw new Error('CRITICAL: LDAP_TIMEOUT must be between 1000ms (1s) and 60000ms (60s)');
    }
  }

  // Validate DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.startsWith('prisma+postgres://') && !dbUrl.startsWith('postgresql://')) {
    throw new Error('CRITICAL: DATABASE_URL must be a valid PostgreSQL connection string');
  }
  if (process.env.NODE_ENV === 'production' && dbUrl.startsWith('postgresql://')) {
    let parsedDatabaseUrl: URL;
    try {
      parsedDatabaseUrl = new URL(dbUrl);
    } catch {
      throw new Error('CRITICAL: DATABASE_URL must be a valid PostgreSQL connection string');
    }
    const password = decodeURIComponent(parsedDatabaseUrl.password).trim().toLowerCase();
    const knownPlaceholders = new Set([
      'changeme',
      'password',
      'postgres',
      'replace_with_a_strong_database_password',
      'replace_with_a_url_encoded_database_password',
      'replace_with_database_password',
      'replace_me',
    ]);
    if (!password || knownPlaceholders.has(password)) {
      throw new Error('CRITICAL: DATABASE_URL contains a missing or known-placeholder database password');
    }
    if (password === 'dummy' && !['localhost', '127.0.0.1'].includes(parsedDatabaseUrl.hostname)) {
      throw new Error('CRITICAL: DATABASE_URL contains a build-only database password for a non-local host');
    }
  }

  if (
    process.env.DATABASE_SSL_ALLOW_INSECURE &&
    !['true', 'false'].includes(process.env.DATABASE_SSL_ALLOW_INSECURE)
  ) {
    throw new Error('CRITICAL: DATABASE_SSL_ALLOW_INSECURE must be either true or false');
  }

  const allowInsecureDatabase = process.env.DATABASE_SSL_ALLOW_INSECURE === 'true';
  if (!dbUrl.includes('sslmode=require') && !allowInsecureDatabase) {
    throw new Error(
      'CRITICAL: DATABASE_URL must include sslmode=require to enforce TLS to PostgreSQL. ' +
      'Set DATABASE_SSL_ALLOW_INSECURE=true only for a trusted private container network.'
    );
  }

  // Validate NEXT_PUBLIC_APP_URL format
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  if (!appUrl.startsWith('http://') && !appUrl.startsWith('https://')) {
    throw new Error('CRITICAL: NEXT_PUBLIC_APP_URL must start with http:// or https://');
  }

  if (
    process.env.TRUST_PROXY_HEADERS &&
    !['true', 'false'].includes(process.env.TRUST_PROXY_HEADERS)
  ) {
    throw new Error('CRITICAL: TRUST_PROXY_HEADERS must be either true or false');
  }

  if (
    process.env.SESSION_COOKIE_ALLOW_INSECURE &&
    !['true', 'false'].includes(process.env.SESSION_COOKIE_ALLOW_INSECURE)
  ) {
    throw new Error('CRITICAL: SESSION_COOKIE_ALLOW_INSECURE must be either true or false');
  }

  if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 32) {
    throw new Error('CRITICAL: CRON_SECRET must be at least 32 characters long');
  }

  if (process.env.AUTH_MODE && !['native', 'oidc'].includes(process.env.AUTH_MODE)) {
    throw new Error('CRITICAL: AUTH_MODE must be either native or oidc');
  }

  if (
    process.env.AUTH_MODE === 'oidc' &&
    (!process.env.AUTH_ISSUER || !process.env.AUTH_CLIENT_SECRET)
  ) {
    throw new Error(
      'CRITICAL: AUTH_ISSUER and AUTH_CLIENT_SECRET are required when AUTH_MODE=oidc'
    );
  }

  // Redirect construction for OIDC round-trips must never fall back to the
  // request Host header; require an explicit browser-facing base URL.
  if (
    process.env.AUTH_MODE === 'oidc' &&
    !process.env.NEXT_PUBLIC_APP_URL &&
    !process.env.OIDC_BROWSER_BASE_URL
  ) {
    throw new Error(
      'CRITICAL: NEXT_PUBLIC_APP_URL or OIDC_BROWSER_BASE_URL is required when AUTH_MODE=oidc'
    );
  }

  if (
    process.env.AUTH_ALLOW_INSECURE_OIDC &&
    !['true', 'false'].includes(process.env.AUTH_ALLOW_INSECURE_OIDC)
  ) {
    throw new Error('CRITICAL: AUTH_ALLOW_INSECURE_OIDC must be either true or false');
  }

  if (process.env.AUTH_ALLOW_INSECURE_OIDC === 'true') {
    console.warn(
      'WARNING: AUTH_ALLOW_INSECURE_OIDC=true permits plain-HTTP OIDC issuer endpoints. ' +
        'Intended only for isolated lab networks or loopback-only compose deployments.'
    );
  }

  if (process.env.AUTH_OIDC_SESSION_MAX_AGE) {
    const seconds = Number(process.env.AUTH_OIDC_SESSION_MAX_AGE);
    if (!Number.isFinite(seconds) || seconds < 300 || seconds > 1_209_600) {
      throw new Error('CRITICAL: AUTH_OIDC_SESSION_MAX_AGE must be between 300 and 1209600');
    }
  }

  if (process.env.OIDC_INTERNAL_ISSUER_URL) {
    const internalIssuerUrl = process.env.OIDC_INTERNAL_ISSUER_URL;
    if (!internalIssuerUrl.startsWith('http://') && !internalIssuerUrl.startsWith('https://')) {
      throw new Error(
        'CRITICAL: OIDC_INTERNAL_ISSUER_URL must start with http:// or https://'
      );
    }
  }

  // Auth service login rate limiting knobs; validated so a shared .env fails
  // fast at portal boot instead of misconfiguring the auth service silently.
  if (process.env.AUTH_LOGIN_WINDOW_MS) {
    const windowMs = Number(process.env.AUTH_LOGIN_WINDOW_MS);
    if (!Number.isFinite(windowMs) || windowMs < 1000 || windowMs > 3600000) {
      throw new Error('CRITICAL: AUTH_LOGIN_WINDOW_MS must be between 1000 and 3600000');
    }
  }

  if (process.env.AUTH_LOGIN_MAX_ATTEMPTS) {
    const maxAttempts = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1000) {
      throw new Error('CRITICAL: AUTH_LOGIN_MAX_ATTEMPTS must be between 1 and 1000');
    }
  }

  if (process.env.AUTH_ACCOUNT_LOCK_WINDOW_MS) {
    const windowMs = Number(process.env.AUTH_ACCOUNT_LOCK_WINDOW_MS);
    if (!Number.isFinite(windowMs) || windowMs < 1000 || windowMs > 3600000) {
      throw new Error('CRITICAL: AUTH_ACCOUNT_LOCK_WINDOW_MS must be between 1000 and 3600000');
    }
  }

  if (process.env.AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS) {
    const maxAttempts = Number(process.env.AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
      throw new Error('CRITICAL: AUTH_ACCOUNT_LOCK_MAX_ATTEMPTS must be between 1 and 100');
    }
  }

  if (
    process.env.AUTH_OIDC_OUTAGE_FALLBACK
    && !['off', 'native_and_local'].includes(process.env.AUTH_OIDC_OUTAGE_FALLBACK)
  ) {
    throw new Error('CRITICAL: AUTH_OIDC_OUTAGE_FALLBACK must be off or native_and_local');
  }

  if (
    process.env.AUTH_OIDC_ALTERNATE_SIGNIN
    && !['off', 'native', 'local', 'native_and_local'].includes(process.env.AUTH_OIDC_ALTERNATE_SIGNIN)
  ) {
    throw new Error(
      'CRITICAL: AUTH_OIDC_ALTERNATE_SIGNIN must be off, native, local, or native_and_local'
    );
  }

  const oidcDisplayName = process.env.AUTH_OIDC_DISPLAY_NAME ?? '';
  if (oidcDisplayName && (
    oidcDisplayName.trim().length < 1
    || oidcDisplayName.trim().length > 80
    || /[\u0000-\u001f\u007f-\u009f]/u.test(oidcDisplayName)
  )) {
    throw new Error('CRITICAL: AUTH_OIDC_DISPLAY_NAME must be 1-80 plain-text characters without controls');
  }
  const oidcDisplayDescription = process.env.AUTH_OIDC_DISPLAY_DESCRIPTION ?? '';
  if (
    oidcDisplayDescription.trim().length > 200
    || /[\u0000-\u001f\u007f-\u009f]/u.test(oidcDisplayDescription)
  ) {
    throw new Error('CRITICAL: AUTH_OIDC_DISPLAY_DESCRIPTION must be at most 200 plain-text characters without controls');
  }

  if (
    process.env.AUTH_MODE === 'oidc'
    && process.env.AUTH_OIDC_OUTAGE_FALLBACK === 'native_and_local'
    && !process.env.OIDC_INTERNAL_ISSUER_URL
  ) {
    throw new Error(
      'CRITICAL: OIDC_INTERNAL_ISSUER_URL is required when OIDC outage fallback is enabled'
    );
  }

  // Strict lowercase hex of exactly 64 characters: safe to interpolate into
  // the asset-store nginx template via sed and unambiguous in comparisons.
  const assetSharedSecret = process.env.ASSET_SHARED_SECRET || '';
  if (assetSharedSecret && !/^[0-9a-f]{64}$/.test(assetSharedSecret)) {
    throw new Error(
      'CRITICAL: ASSET_SHARED_SECRET must be exactly 64 lowercase hex characters. Generate with: openssl rand -hex 32'
    );
  }

  // Same hex-64 convention as ASSET_SHARED_SECRET; consumed by the auth
  // service to encrypt relying-party client secrets at rest (AES-256-GCM).
  const clientSecretEncKey = process.env.AUTH_CLIENT_SECRET_ENC_KEY || '';
  if (clientSecretEncKey && !/^[0-9a-f]{64}$/.test(clientSecretEncKey)) {
    throw new Error(
      'CRITICAL: AUTH_CLIENT_SECRET_ENC_KEY must be exactly 64 lowercase hex characters. Generate with: openssl rand -hex 32'
    );
  }

  if (
    process.env.OFFBOARD_SCHEDULER_ENABLED &&
    !['true', 'false'].includes(process.env.OFFBOARD_SCHEDULER_ENABLED)
  ) {
    throw new Error('CRITICAL: OFFBOARD_SCHEDULER_ENABLED must be either true or false');
  }

  if (process.env.OFFBOARD_SCHEDULER_ENABLED === 'true' && !process.env.CRON_SECRET) {
    throw new Error(
      'CRITICAL: CRON_SECRET is required when OFFBOARD_SCHEDULER_ENABLED=true'
    );
  }

  if (process.env.OFFBOARD_SCHEDULER_GRACE_SECONDS) {
    const graceSeconds = Number.parseInt(process.env.OFFBOARD_SCHEDULER_GRACE_SECONDS, 10);
    if (!Number.isFinite(graceSeconds) || graceSeconds < 60 || graceSeconds > 86_400) {
      throw new Error('CRITICAL: OFFBOARD_SCHEDULER_GRACE_SECONDS must be between 60 and 86400');
    }
  }

  if (
    process.env.PASSWORD_EXPIRATION_SCHEDULER_ENABLED &&
    !['true', 'false'].includes(process.env.PASSWORD_EXPIRATION_SCHEDULER_ENABLED)
  ) {
    throw new Error('CRITICAL: PASSWORD_EXPIRATION_SCHEDULER_ENABLED must be either true or false');
  }

  if (process.env.PASSWORD_EXPIRATION_WARNING_DAYS) {
    const warningDays = Number.parseInt(process.env.PASSWORD_EXPIRATION_WARNING_DAYS, 10);
    if (!Number.isFinite(warningDays) || warningDays < 1 || warningDays > 90) {
      throw new Error('CRITICAL: PASSWORD_EXPIRATION_WARNING_DAYS must be between 1 and 90');
    }
  }

  if (
    process.env.PASSWORD_CLEANUP_SCHEDULER_ENABLED &&
    !['true', 'false'].includes(process.env.PASSWORD_CLEANUP_SCHEDULER_ENABLED)
  ) {
    throw new Error('CRITICAL: PASSWORD_CLEANUP_SCHEDULER_ENABLED must be either true or false');
  }

  if (process.env.PASSWORD_CLEANUP_SCHEDULER_ENABLED === 'true' && !process.env.CRON_SECRET) {
    throw new Error('CRITICAL: CRON_SECRET is required when PASSWORD_CLEANUP_SCHEDULER_ENABLED=true');
  }

  if (
    process.env.TICKET_GROUP_SYNC_ENABLED &&
    !['true', 'false'].includes(process.env.TICKET_GROUP_SYNC_ENABLED)
  ) {
    throw new Error('CRITICAL: TICKET_GROUP_SYNC_ENABLED must be either true or false');
  }

  if (process.env.TICKET_GROUP_SYNC_ENABLED === 'true' && !process.env.CRON_SECRET) {
    throw new Error(
      'CRITICAL: CRON_SECRET is required when TICKET_GROUP_SYNC_ENABLED=true'
    );
  }

  if (process.env.TICKET_GROUP_SYNC_INTERVAL_SECONDS) {
    const intervalSeconds = Number(process.env.TICKET_GROUP_SYNC_INTERVAL_SECONDS);
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 300 || intervalSeconds > 86400) {
      throw new Error('CRITICAL: TICKET_GROUP_SYNC_INTERVAL_SECONDS must be between 300 and 86400');
    }
  }

  if (
    process.env.LIFECYCLE_QUEUE_SCHEDULER_ENABLED &&
    !['true', 'false'].includes(process.env.LIFECYCLE_QUEUE_SCHEDULER_ENABLED)
  ) {
    throw new Error('CRITICAL: LIFECYCLE_QUEUE_SCHEDULER_ENABLED must be either true or false');
  }

  if (process.env.LIFECYCLE_QUEUE_SCHEDULER_ENABLED === 'true' && !process.env.CRON_SECRET) {
    throw new Error(
      'CRITICAL: CRON_SECRET is required when LIFECYCLE_QUEUE_SCHEDULER_ENABLED=true'
    );
  }

  if (process.env.LIFECYCLE_QUEUE_SCHEDULER_INTERVAL_SECONDS) {
    const intervalSeconds = Number(process.env.LIFECYCLE_QUEUE_SCHEDULER_INTERVAL_SECONDS);
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 300 || intervalSeconds > 86400) {
      throw new Error(
        'CRITICAL: LIFECYCLE_QUEUE_SCHEDULER_INTERVAL_SECONDS must be between 300 and 86400'
      );
    }
  }

  if (process.env.LIFECYCLE_QUEUE_SCHEDULER_INITIAL_DELAY_SECONDS) {
    const delaySeconds = Number(process.env.LIFECYCLE_QUEUE_SCHEDULER_INITIAL_DELAY_SECONDS);
    if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 3600) {
      throw new Error(
        'CRITICAL: LIFECYCLE_QUEUE_SCHEDULER_INITIAL_DELAY_SECONDS must be between 0 and 3600'
      );
    }
  }

  if (process.env.LIFECYCLE_QUEUE_SCHEDULER_HEALTH_MAX_AGE_SECONDS) {
    const maxAgeSeconds = Number(process.env.LIFECYCLE_QUEUE_SCHEDULER_HEALTH_MAX_AGE_SECONDS);
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 600 || maxAgeSeconds > 604800) {
      throw new Error(
        'CRITICAL: LIFECYCLE_QUEUE_SCHEDULER_HEALTH_MAX_AGE_SECONDS must be between 600 and 604800'
      );
    }
  }

  if (
    process.env.DIRECTORY_PROBE_ENABLED &&
    !['true', 'false'].includes(process.env.DIRECTORY_PROBE_ENABLED)
  ) {
    throw new Error('CRITICAL: DIRECTORY_PROBE_ENABLED must be either true or false');
  }

  if (process.env.DIRECTORY_PROBE_ENABLED === 'true' && !process.env.CRON_SECRET) {
    throw new Error('CRITICAL: CRON_SECRET is required when DIRECTORY_PROBE_ENABLED=true');
  }

  if (
    process.env.WORKFLOW_TICK_ENABLED &&
    !['true', 'false'].includes(process.env.WORKFLOW_TICK_ENABLED)
  ) {
    throw new Error('CRITICAL: WORKFLOW_TICK_ENABLED must be either true or false');
  }

  if (process.env.WORKFLOW_TICK_ENABLED === 'true' && !process.env.CRON_SECRET) {
    throw new Error('CRITICAL: CRON_SECRET is required when WORKFLOW_TICK_ENABLED=true');
  }

  for (const flag of ['MONITORED_ENDPOINTS_SCHEDULER_ENABLED', 'ATTACHMENT_QUARANTINE_PURGE_ENABLED', 'FLOW_OUTBOX_SCHEDULER_ENABLED', 'OPERATIONAL_DETECTOR_SCHEDULER_ENABLED'] as const) {
    const value = process.env[flag];
    if (value && !['true', 'false'].includes(value)) throw new Error(`CRITICAL: ${flag} must be either true or false`);
    if (value === 'true' && !process.env.CRON_SECRET) throw new Error(`CRITICAL: CRON_SECRET is required when ${flag}=true`);
  }

  const boundedEnv = (name: string, min: number, max: number) => {
    const raw = process.env[name];
    if (!raw) return;
    const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`CRITICAL: ${name} must be between ${min} and ${max}`);
    }
  };
  boundedEnv('MONITORED_ENDPOINTS_INTERVAL_SECONDS', 30, 3600);
  boundedEnv('MONITORED_ENDPOINTS_HEALTH_MAX_AGE_SECONDS', 60, 86400);
  boundedEnv('ATTACHMENT_QUARANTINE_PURGE_INTERVAL_SECONDS', 300, 604800);
  boundedEnv('ATTACHMENT_QUARANTINE_PURGE_HEALTH_MAX_AGE_SECONDS', 600, 1209600);
  boundedEnv('CLAMAV_PORT', 1, 65535);
  boundedEnv('CLAMAV_TIMEOUT_MS', 1000, 60000);
  boundedEnv('FLOW_OUTBOX_INTERVAL_SECONDS', 30, 3600);
  boundedEnv('FLOW_OUTBOX_HEALTH_MAX_AGE_SECONDS', 60, 86400);
  boundedEnv('OPERATIONAL_DETECTOR_INTERVAL_SECONDS', 30, 3600);
  boundedEnv('OPERATIONAL_DETECTOR_HEALTH_MAX_AGE_SECONDS', 60, 86400);
  if (process.env.CLAMAV_HOST !== undefined && !process.env.CLAMAV_HOST.trim()) {
    throw new Error('CRITICAL: CLAMAV_HOST cannot be empty when provided');
  }
  if (!process.env.MONITOR_PROBE_SHARED_SECRET || process.env.MONITOR_PROBE_SHARED_SECRET.length < 32) {
    throw new Error('CRITICAL: MONITOR_PROBE_SHARED_SECRET must be at least 32 characters long');
  }
  if (process.env.MONITOR_PROBE_URL) {
    let probeUrl: URL;
    try {
      probeUrl = new URL(process.env.MONITOR_PROBE_URL);
    } catch {
      throw new Error('CRITICAL: MONITOR_PROBE_URL must be a valid URL');
    }
    if (probeUrl.protocol !== 'http:' || probeUrl.hostname !== 'monitor-probe' || probeUrl.port !== '8091') {
      throw new Error('CRITICAL: MONITOR_PROBE_URL must be http://monitor-probe:8091');
    }
  }

  if (process.env.PASSWORD_CREDENTIAL_RETENTION_DAYS) {
    const retentionDays = Number(process.env.PASSWORD_CREDENTIAL_RETENTION_DAYS);
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 30) {
      throw new Error('CRITICAL: PASSWORD_CREDENTIAL_RETENTION_DAYS must be between 1 and 30');
    }
  }

  if (process.env.PASSWORD_CLEANUP_INTERVAL_SECONDS) {
    const intervalSeconds = Number(process.env.PASSWORD_CLEANUP_INTERVAL_SECONDS);
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 300 || intervalSeconds > 86400) {
      throw new Error('CRITICAL: PASSWORD_CLEANUP_INTERVAL_SECONDS must be between 300 and 86400');
    }
  }

  if (process.env.PASSWORD_CLEANUP_INITIAL_DELAY_SECONDS) {
    const delaySeconds = Number(process.env.PASSWORD_CLEANUP_INITIAL_DELAY_SECONDS);
    if (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 3600) {
      throw new Error('CRITICAL: PASSWORD_CLEANUP_INITIAL_DELAY_SECONDS must be between 0 and 3600');
    }
  }

  if (process.env.PASSWORD_CLEANUP_HEALTH_MAX_AGE_SECONDS) {
    const maxAgeSeconds = Number(process.env.PASSWORD_CLEANUP_HEALTH_MAX_AGE_SECONDS);
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 600 || maxAgeSeconds > 604800) {
      throw new Error('CRITICAL: PASSWORD_CLEANUP_HEALTH_MAX_AGE_SECONDS must be between 600 and 604800');
    }
  }

  if (
    process.env.LDAP_ALLOW_INVALID_CERTS &&
    !['true', 'false'].includes(process.env.LDAP_ALLOW_INVALID_CERTS)
  ) {
    throw new Error('CRITICAL: LDAP_ALLOW_INVALID_CERTS must be either true or false');
  }

  if (process.env.LDAP_ALLOW_INVALID_CERTS === 'true') {
    console.warn(
      'WARNING: LDAP_ALLOW_INVALID_CERTS=true disables LDAPS certificate verification. ' +
        'LDAP credentials become interceptable by anyone controlling the network path. ' +
        'Intended only for isolated lab environments with untrusted or expired directory certificates.'
    );
  }

  try {
    parseLDAPCACertificate(process.env.LDAP_CA_CERT_BASE64);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid certificate';
    throw new Error(`CRITICAL: ${message}`);
  }

  // Validate NEXTAUTH_SECRET length (should be at least 32 characters)
  const authSecret = process.env.NEXTAUTH_SECRET || '';
  if (authSecret.length < 32) {
    throw new Error('CRITICAL: NEXTAUTH_SECRET must be at least 32 characters long for security');
  }

  // Validate ENCRYPTION_SECRET length
  const encryptionSecret = process.env.ENCRYPTION_SECRET || '';
  if (encryptionSecret.length < 32) {
    throw new Error('CRITICAL: ENCRYPTION_SECRET must be at least 32 characters long for security. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }

  // Validate ENCRYPTION_SALT length and entropy
  const encryptionSalt = process.env.ENCRYPTION_SALT || '';
  if (encryptionSalt.length < 32) {
    throw new Error('CRITICAL: ENCRYPTION_SALT must be at least 32 characters long (64 hex characters recommended). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }

  // Check for basic entropy in salt
  const uniqueChars = new Set(encryptionSalt.split(''));
  if (uniqueChars.size < 8) {
    throw new Error('CRITICAL: ENCRYPTION_SALT has insufficient entropy. Use a cryptographically random value. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
}

/**
 * Gets a validated environment variable
 * @param key - Environment variable name
 * @returns The environment variable value
 * @throws Error if the variable is not set or empty
 */
export function getRequiredEnv(key: keyof EnvConfig): string {
  const value = process.env[key];

  if (!value || value.trim() === '') {
    throw new Error(`CRITICAL: Required environment variable ${key} is not set or empty`);
  }

  return value;
}

/**
 * Check if the application is running in production
 * Verifies both NODE_ENV and that the app URL uses HTTPS
 * 
 * @returns True if running in production environment
 */
export function isProduction(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  // Must have NODE_ENV=production AND use HTTPS
  return nodeEnv === 'production' && !!appUrl?.startsWith('https://');
}

/**
 * Check if the application is running in development
 * 
 * @returns True if running in development environment
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Gets an optional environment variable with a default value
 * @param key - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The environment variable value or default
 */
export function getOptionalEnv(key: keyof EnvConfig, defaultValue: string): string {
  const value = process.env[key];
  return value && value.trim() !== '' ? value : defaultValue;
}

/**
 * Logs environment configuration status (without revealing sensitive values)
 */
export function logEnvironmentStatus(): void {
  console.log('✅ Environment configuration validated successfully');
  console.log(`   - Database: ${process.env.DATABASE_URL?.split('@')[1] || 'configured'}`);
  console.log(`   - LDAP Server: ${process.env.LDAP_URL || 'not set'}`);
  console.log(`   - SMTP Server: ${process.env.SMTP_HOST || 'not set'}`);
  console.log(`   - Application URL: ${process.env.NEXT_PUBLIC_APP_URL || 'not set'}`);
  console.log(`   - Node Environment: ${process.env.NODE_ENV || 'development'}`);
}
