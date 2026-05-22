interface EnvConfig {
  // Database
  DATABASE_URL: string;

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
  LDAP_ALLOW_INVALID_CERTS?: string; // Optional: only for trusted dev environments

  // Application
  NEXT_PUBLIC_APP_URL: string;
  NEXTAUTH_SECRET: string;
  NODE_ENV?: string;
  TRUST_PROXY_HEADERS?: string;
  SESSION_COOKIE_ALLOW_INSECURE?: string;

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

  // Email Configuration
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'EMAIL_FROM',
  'ADMIN_EMAIL',

  // LDAP Configuration (Critical Security Requirements)
  'LDAP_URL',
  'LDAP_BIND_DN',
  'LDAP_BIND_PASSWORD',
  'LDAP_SEARCH_BASE',
  'LDAP_DOMAIN',
  'LDAP_ADMIN_GROUPS',
  'LDAP_GROUP2ADD',
  'LDAP_KAMINO_INTERNAL_GROUP',
  'LDAP_KAMINO_EXTERNAL_GROUP',
  'LDAP_GROUPSEARCH',

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

  // Additional validation for specific formats
  validateSpecificFormats();
}

/**
 * Validates specific environment variable formats
 */
function validateSpecificFormats(): void {
  // Validate SMTP_PORT is a number
  const smtpPort = parseInt(process.env.SMTP_PORT || '', 10);
  if (isNaN(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error('CRITICAL: SMTP_PORT must be a valid port number (1-65535)');
  }

  // Validate LDAP_TIMEOUT if provided
  if (process.env.LDAP_TIMEOUT) {
    const ldapTimeout = parseInt(process.env.LDAP_TIMEOUT, 10);
    if (isNaN(ldapTimeout) || ldapTimeout < 1000 || ldapTimeout > 60000) {
      throw new Error('CRITICAL: LDAP_TIMEOUT must be between 1000ms (1s) and 60000ms (60s)');
    }
  }

  // Validate LDAP_URL format
  const ldapUrl = process.env.LDAP_URL || '';
  if (!ldapUrl.toLowerCase().startsWith('ldaps://')) {
    throw new Error('CRITICAL: LDAP_URL must use ldaps:// for encrypted transport');
  }

  // Validate DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.startsWith('prisma+postgres://') && !dbUrl.startsWith('postgresql://')) {
    throw new Error('CRITICAL: DATABASE_URL must be a valid PostgreSQL connection string');
  }

  if (!dbUrl.includes('sslmode=require')) {
    throw new Error('CRITICAL: DATABASE_URL must include sslmode=require to enforce TLS to PostgreSQL');
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
