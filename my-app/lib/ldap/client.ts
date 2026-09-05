import { Client } from 'ldapts';
import { getConfigValue } from '../config/resolver';
import { ldapLogger, hashLogValue } from '../logger';
import { withTimeout, sanitizeLdapError, LDAP_TIMEOUT } from './utils';
import { parseLDAPCACertificate } from './ca-certificate';
import { buildCandidateUrls, selectHealthyLdapUrl } from './url-health';
import { assertExternalSideEffectAllowed, isProductionCloneReadOnly } from '../clone-safety';

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

export interface LDAPTLSOptions {
  rejectUnauthorized: boolean;
  ca?: string;
}

const LDAP_MUTATION_METHODS = new Set<PropertyKey>(['add', 'del', 'modify', 'modifyDN']);

/**
 * Keep directory reads and user binds available in a production-clone lab,
 * while making every ldapts mutation fail before a network request is sent.
 */
export function protectLDAPClientForProductionClone(client: Client): Client {
  if (!isProductionCloneReadOnly()) return client;

  return new Proxy(client, {
    get(target, property, receiver) {
      if (LDAP_MUTATION_METHODS.has(property)) {
        return () => {
          assertExternalSideEffectAllowed('ldap-write');
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * Resolves LDAPS TLS options. Certificate verification is on unless
 * LDAP_ALLOW_INVALID_CERTS=true, an explicit lab-only override for directories
 * whose certificates are expired or issued by an untrusted internal CA.
 * The ldaps:// transport requirement is enforced independently in
 * createLDAPClient, so traffic stays encrypted either way.
 */
export function getLDAPTLSOptions(): LDAPTLSOptions {
  if (process.env.LDAP_ALLOW_INVALID_CERTS === 'true') {
    ldapLogger.warn(
      'LDAP certificate verification is DISABLED (LDAP_ALLOW_INVALID_CERTS=true); connections are vulnerable to interception'
    );
    return { rejectUnauthorized: false };
  }

  const ca = parseLDAPCACertificate(process.env.LDAP_CA_CERT_BASE64);
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

export function isPasswordChangeRequiredAuthStatus(status: LDAPAuthStatus): boolean {
  return status === 'password_change_required' || status === 'password_expired';
}

function getActiveDirectoryDiagnosticCode(message: string): string | null {
  const match = message.match(/data\s+([0-9a-f]{3,})/i);
  return match?.[1]?.toLowerCase() ?? null;
}

const DIRECTORY_TRANSPORT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  if ('code' in error && typeof error.code === 'string') return error.code.toUpperCase();
  const cause = 'cause' in error ? error.cause : null;
  return cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code.toUpperCase()
    : null;
}

/** Narrow reachability classification shared with break-glass decisions. */
export function isDirectoryTransportError(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('timed out')) return true;
  const code = errorCode(error);
  return code !== null && DIRECTORY_TRANSPORT_ERROR_CODES.has(code);
}

/**
 * Creates a new LDAP client instance.
 * Enforces LDAPS (secure) connection. When ldap.failoverUrls is configured,
 * endpoints are probed in order (primary first) and the first reachable TLS
 * endpoint wins; a single configured URL skips probing entirely so behavior
 * is unchanged without explicit failover configuration.
 */
export async function createLDAPClient(): Promise<Client> {
  const url = await selectHealthyLdapUrl(await collectCandidateLdapUrls(), getLDAPTLSOptions());

  if (!url.toLowerCase().startsWith('ldaps://')) {
    throw new Error('CRITICAL: LDAP_URL must use ldaps:// transport');
  }

  return protectLDAPClientForProductionClone(new Client({
    url,
    tlsOptions: getLDAPTLSOptions(),
  }));
}

async function collectCandidateLdapUrls(): Promise<string[]> {
  const primaryUrl = await getConfigValue<string>('ldap.url');
  let failoverUrls: string[] = [];
  try {
    const resolved = await getConfigValue<string[]>('ldap.failoverUrls');
    if (Array.isArray(resolved)) {
      failoverUrls = resolved;
    }
  } catch {
    // Failover list is optional; resolution problems must not block connectivity.
  }
  return buildCandidateUrls(primaryUrl, failoverUrls);
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

    client = await createLDAPClient();
    const ldapDomain = await getConfigValue<string>('ldap.domain');

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
      if (isDirectoryTransportError(error)) {
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
