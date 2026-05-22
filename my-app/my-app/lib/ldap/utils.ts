import { ldapLogger } from '../logger';
import { getOptionalEnv } from '../env-validator';

// Configuration from environment
export const LDAP_TIMEOUT = parseInt(getOptionalEnv('LDAP_TIMEOUT', '30000'), 10);
export const LDAP_MAX_RETRIES = parseInt(getOptionalEnv('LDAP_MAX_RETRIES', '3'), 10);
export const LDAP_RETRY_DELAY = parseInt(getOptionalEnv('LDAP_RETRY_DELAY', '1000'), 10);

// UAR description prefix for tracking accounts
export const UAR_DESCRIPTION_PREFIX = 'UAR | Request ID:';

/**
 * Format request description for LDAP account tracking
 */
export function formatRequestDescription(identifier?: string | number | null): string {
  const normalized = identifier === undefined || identifier === null
    ? 'UNKNOWN'
    : String(identifier).trim() || 'UNKNOWN';
  return `${UAR_DESCRIPTION_PREFIX} ${normalized}`;
}

/**
 * Check if description matches a specific request tag
 */
export function descriptionMatchesRequestTag(
  description: string,
  identifier?: string | number | null
): boolean {
  if (!description || !description.includes(UAR_DESCRIPTION_PREFIX)) {
    return false;
  }

  if (identifier === undefined || identifier === null) {
    return true;
  }

  return description.trim().startsWith(formatRequestDescription(identifier));
}

/**
 * Sanitize LDAP errors to prevent information disclosure
 * Removes sensitive directory structure information from error messages
 * 
 * @param error - Error object to sanitize
 * @returns Sanitized error object safe for logging
 */
export function sanitizeLdapError(error: unknown): { message: string; code?: string; stack?: string } {
  if (error instanceof Error) {
    const message = error.message
      .replace(/CN=[^,]+/g, 'CN=***')
      .replace(/OU=[^,]+/g, 'OU=***')
      .replace(/DC=[^,]+/g, 'DC=***')
      .replace(/distinguishedName="[^"]+"/g, 'distinguishedName="***"')
      .replace(/dn="[^"]+"/g, 'dn="***"');

    const ldapError = error as { code?: string };
    return {
      message,
      code: ldapError.code,
      ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    };
  }
  return { message: 'LDAP operation failed' };
}

/**
 * Wraps an LDAP operation with a timeout to prevent resource exhaustion
 * @param operation - The LDAP operation to execute
 * @param timeoutMs - Timeout in milliseconds
 * @returns Promise that resolves with the operation result or rejects on timeout
 */
export async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`LDAP operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

/**
 * Retry an LDAP operation with exponential backoff
 * @param operation - The LDAP operation to execute
 * @param operationName - Name of the operation for logging
 * @param maxRetries - Maximum number of retries
 * @param retryDelay - Initial delay between retries in milliseconds
 * @returns Promise that resolves with the operation result
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = LDAP_MAX_RETRIES,
  retryDelay: number = LDAP_RETRY_DELAY
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on certain errors (authentication, invalid credentials, etc.)
      const errorMessage = lastError.message.toLowerCase();
      const nonRetryableErrors = [
        'invalid credentials',
        'authentication failed',
        'already exists',
        'entry not found',
        'no such object',
        'will_not_perform',
        'deletion blocked'
      ];

      const isNonRetryable = nonRetryableErrors.some(msg => errorMessage.includes(msg));

      if (isNonRetryable) {
        ldapLogger.error(`${operationName} failed with non-retryable error`, {
          error: lastError.message,
          attempt
        });
        throw lastError;
      }

      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        ldapLogger.warn(`${operationName} failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`, {
          error: lastError.message
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  ldapLogger.error(`${operationName} failed after ${maxRetries} attempts`, {
    error: lastError?.message
  });
  throw new Error(`${operationName} failed after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Escape special characters in LDAP filter strings to prevent LDAP injection
 * 
 * LDAP filters use special characters that need to be escaped:
 * - * (asterisk) - wildcard
 * - ( ) (parentheses) - grouping
 * - \ (backslash) - escape character
 * - NUL (null character)
 * - / (forward slash)
 * 
 * @param str - The string to escape
 * @returns The escaped string safe for use in LDAP filters
 * @throws {Error} If input is not a string or is null/undefined
 */
export function escapeLDAPFilter(str: string): string {
  if (str == null || typeof str !== 'string') {
    throw new Error('escapeLDAPFilter requires a valid string input');
  }

  return str
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00')
    .replace(/\//g, '\\2f');
}

/**
 * Escape special characters in LDAP Distinguished Names (DNs)
 * 
 * DNs have different escaping rules than filters
 * 
 * @param str - The string to escape
 * @returns The escaped string safe for use in DNs
 * @throws {Error} If input is not a string or is null/undefined
 */
export function escapeLDAPDN(str: string): string {
  if (str == null || typeof str !== 'string') {
    throw new Error('escapeLDAPDN requires a valid string input');
  }

  return str
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\+/g, '\\+')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/;/g, '\\;')
    .replace(/=/g, '\\=')
    .replace(/\0/g, '\\00')
    .replace(/^#/, '\\#')
    .replace(/^ /, '\\ ')
    .replace(/ $/, '\\ ');
}

/**
 * Validate password for LDAP operations to prevent injection attacks
 * 
 * Active Directory passwords should not contain:
 * - Null bytes (\x00)
 * - Control characters (ASCII 0-31 and 127)
 * - Quotes that could break out of UTF-16LE encoding
 * 
 * @param password - The password to validate
 * @returns True if password is safe for LDAP operations
 * @throws {Error} If password contains dangerous characters
 */
export function validatePasswordForLDAP(password: string): boolean {
  if (password == null || typeof password !== 'string') {
    throw new Error('Password must be a valid string');
  }

  if (password.includes('\x00')) {
    throw new Error('Password cannot contain null bytes');
  }

  const controlCharRegex = /[\x00-\x1F\x7F]/;
  if (controlCharRegex.test(password)) {
    throw new Error('Password cannot contain control characters');
  }

  const consecutiveQuotes = /"{2,}/;
  if (consecutiveQuotes.test(password)) {
    throw new Error('Password cannot contain consecutive quote characters');
  }

  return true;
}

/**
 * Parse LDAP GeneralizedTime format (YYYYMMDDHHMMSS.0Z) to ISO string
 * @param dateStr - The GeneralizedTime string
 * @returns ISO date string or null if invalid
 */
export function parseLDAPDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;

  // Format: YYYYMMDDHHMMSS.0Z or YYYYMMDDHHMMSSZ
  // Example: 20240125123456.0Z
  const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.0)?Z$/);

  if (match) {
    const [_, year, month, day, hour, minute, second] = match;
    const date = new Date(Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second, 10)
    ));
    return date.toISOString();
  }

  return null;
}
