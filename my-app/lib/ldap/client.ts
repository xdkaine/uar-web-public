import { Client } from 'ldapts';
import { getRequiredEnv, getOptionalEnv } from '../env-validator';
import { ldapLogger, hashLogValue } from '../logger';
import { withTimeout, sanitizeLdapError, LDAP_TIMEOUT } from './utils';

export type LDAPAuthStatus =
  | 'authenticated'
  | 'invalid_credentials'
  | 'password_change_required'
  | 'password_expired'
  | 'account_disabled'
  | 'account_locked'
  | 'timeout'
  | 'unknown_error';

export interface LDAPAuthResult {
  success: boolean;
  status: LDAPAuthStatus;
  error?: string;
}

export function isPasswordChangeRequiredAuthStatus(status: LDAPAuthStatus): boolean {
  return status === 'password_change_required' || status === 'password_expired';
}

function getActiveDirectoryDiagnosticCode(message: string): string | null {
  const match = message.match(/data\s+([0-9a-f]{3,})/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Creates a new LDAP client instance
 * Enforces LDAPS (secure) connection
 */
export function createLDAPClient(): Client {
  const url = getRequiredEnv('LDAP_URL');

  if (!url.toLowerCase().startsWith('ldaps://')) {
    throw new Error('CRITICAL: LDAP_URL must use ldaps:// transport');
  }

  const allowInvalidCerts = getOptionalEnv('LDAP_ALLOW_INVALID_CERTS', 'true') === 'true';

  return new Client({
    url,
    tlsOptions: {
      rejectUnauthorized: !allowInvalidCerts,
    },
  });
}

/**
 * Authenticate a user against LDAP/Active Directory
 * 
 * @param username - The username or UPN to authenticate
 * @param password - The user's password
 * @returns Object with success/error status
 */
export async function authenticateLDAP(
  username: string,
  password: string
): Promise<LDAPAuthResult> {
  let client: Client | null = null;
  try {
    if (!username || !password) {
      return {
        success: false,
        status: 'invalid_credentials',
        error: 'Username and password are required',
      };
    }

    client = createLDAPClient();
    const ldapDomain = getRequiredEnv('LDAP_DOMAIN');

    // Determine the UPN (User Principal Name)
    // If username is already an email/UPN (contains @), use it as is
    // Otherwise, append the domain
    let userDN = username;
    if (!username.includes('@')) {
      userDN = `${username}@${ldapDomain}`;
    }

    await withTimeout(client.bind(userDN, password), LDAP_TIMEOUT);

    return { success: true, status: 'authenticated' };
  } catch (error) {
    let errorMessage = 'Authentication failed';
    let status: LDAPAuthStatus = 'unknown_error';
    if (error instanceof Error) {
      const diagnosticCode = getActiveDirectoryDiagnosticCode(error.message);
      if (error.message.includes('timed out')) {
        errorMessage = 'LDAP authentication timeout';
        status = 'timeout';
        ldapLogger.error(errorMessage, error);
      } else if (diagnosticCode === '52e') {
        errorMessage = 'Invalid credentials';
        status = 'invalid_credentials';
        ldapLogger.warn('LDAP authentication failed: Invalid credentials', { username: hashLogValue(username) });
      } else if (diagnosticCode === '773') {
        errorMessage = 'Password change required';
        status = 'password_change_required';
        ldapLogger.warn('LDAP authentication requires password change', { username: hashLogValue(username) });
      } else if (diagnosticCode === '532') {
        errorMessage = 'Password expired';
        status = 'password_expired';
        ldapLogger.warn('LDAP authentication failed: Password expired', { username: hashLogValue(username) });
      } else if (diagnosticCode === '533') {
        errorMessage = 'Account disabled';
        status = 'account_disabled';
        ldapLogger.warn('LDAP authentication failed: Account disabled', { username: hashLogValue(username) });
      } else if (diagnosticCode === '775') {
        errorMessage = 'Account locked';
        status = 'account_locked';
        ldapLogger.warn('LDAP authentication failed: Account locked', { username: hashLogValue(username) });
      } else {
        errorMessage = error.message;
        ldapLogger.error('LDAP authentication failed', sanitizeLdapError(error));
      }
    }
    return { success: false, status, error: errorMessage };
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch {
      }
    }
  }
}
