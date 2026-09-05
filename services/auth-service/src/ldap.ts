import tls from 'tls';
import { Attribute, Change, Client } from 'ldapts';
import type { AuthConfig } from './config';
import { isProductionCloneReadOnly } from './clone-safety';

/**
 * Active Directory credential checks for the OIDC login interaction.
 * Ported from the portal's lib/ldap discipline (ADR-0009/0012):
 *  - ldaps:// enforced, certificate verification ON unless the explicit
 *    lab-only escape hatch is set,
 *  - user-bind authentication with AD sub-error diagnostics preserved,
 *  - callers receive explicit transport failures; OIDC never switches to a
 *    second credential authority.
 */

export type LdapAuthStatus =
  | 'authenticated'
  | 'invalid_credentials'
  | 'password_change_required'
  | 'password_expired'
  | 'account_disabled'
  | 'account_locked'
  | 'account_expired'
  | 'account_restricted'
  | 'timeout'
  | 'unknown_error';

export interface LdapAuthResult {
  success: boolean;
  status: LdapAuthStatus;
  error?: string;
}

const LDAP_TIMEOUT_MS = 15_000;

export function tlsOptions(config: AuthConfig): { rejectUnauthorized: boolean } {
  if (config.allowInvalidCertificates) {
    console.warn(
      '[auth] LDAP certificate verification is DISABLED (LDAP_ALLOW_INVALID_CERTS=true); connections are vulnerable to interception'
    );
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

async function probeTlsReachable(config: AuthConfig): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(config.ldapUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 636;
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, ...tlsOptions(config), timeout: 2500 });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('secureConnect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

function diagnosticCode(message: string): string | null {
  const match = message.match(/data\s+([0-9a-f]{3,})/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Authenticate a user principal against AD by binding AS the user. */
export async function authenticateAd(
  config: AuthConfig,
  username: string,
  password: string,
  options?: { withProfile?: boolean }
): Promise<LdapAuthResult & { profile?: AdAccountProfile }> {
  if (!username || !password) {
    return { success: false, status: 'invalid_credentials', error: 'Username and password are required' };
  }

  const upn = username.includes('@') ? username : `${username}@${config.ldapDomain}`;
  const client = new Client({ url: config.ldapUrl, tlsOptions: tlsOptions(config) });

  try {
    await withTimeout(client.bind(upn, password));
    // Optional same-connection profile read (ADR-0012 amendment): one bind,
    // one extra search - no second credential round-trip.
    let profile: AdAccountProfile | undefined;
    if (options?.withProfile) {
      profile = await readSelfProfile(client, config, username);
    }
    return { success: true, status: 'authenticated', ...(profile ? { profile } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timed out')) {
      return { success: false, status: 'timeout', error: 'LDAP authentication timeout' };
    }
    const code = diagnosticCode(message);
    switch (code) {
      case '52e':
        return { success: false, status: 'invalid_credentials', error: 'Invalid credentials' };
      case '773':
        return { success: false, status: 'password_change_required', error: 'Password change required' };
      case '532':
        return { success: false, status: 'password_expired', error: 'Password expired' };
      case '533':
        return { success: false, status: 'account_disabled', error: 'Account disabled' };
      case '775':
        return { success: false, status: 'account_locked', error: 'Account locked' };
      case '701':
        return { success: false, status: 'account_expired', error: 'Account expired' };
      case '531':
        return { success: false, status: 'account_restricted', error: 'Account logon restricted' };
      default:
        // Distinguish transport failure for accurate operational reporting.
        const reachable = await probeTlsReachable(config);
        if (!reachable) {
          return { success: false, status: 'timeout', error: 'Directory unreachable' };
        }
        return { success: false, status: 'unknown_error', error: 'Authentication failed' };
    }
  } finally {
    try {
      await client.unbind();
    } catch {
      // ignore
    }
  }
}

/**
 * Self-service password change using the CURRENT password (delete+add on
 * unicodePwd), then a confirmation bind with the NEW password.
 *
 * The `error` field is USER-FACING (rendered verbatim by the interaction
 * page) and stays generic for unexpected failures; `detail` preserves the
 * raw directory message for server-side audit logging only.
 */
export async function changeAdPasswordWithCurrent(
  config: AuthConfig,
  username: string,
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; error?: string; detail?: string }> {
  if (isProductionCloneReadOnly()) {
    return {
      ok: false,
      error: 'Password changes are disabled in this production-clone environment.',
    };
  }
  const upn = username.includes('@') ? username : `${username}@${config.ldapDomain}`;
  const client = new Client({ url: config.ldapUrl, tlsOptions: tlsOptions(config) });
  let stage: 'bind' | 'modify' = 'bind';
  try {
    await withTimeout(client.bind(upn, currentPassword));

    // Resolve the user's DN via the rootDSE naming context + sAMAccountName search
    const root = await withTimeout(
      client.search('', { scope: 'base', filter: '(objectClass=*)', attributes: ['defaultNamingContext'] })
    );
    const namingContext = root.searchEntries?.[0]?.defaultNamingContext as string | undefined;
    if (!namingContext) {
      return { ok: false, error: 'Could not resolve directory naming context' };
    }

    const sanitizedUser = username.replace(/[^a-zA-Z0-9 _.-]/g, '');
    const search = await withTimeout(
      client.search(namingContext, {
        scope: 'sub',
        filter: `(sAMAccountName=${sanitizedUser})`,
        attributes: ['dn'],
        sizeLimit: 1,
      })
    );
    const dn = search.searchEntries?.[0]?.dn as string | undefined;
    if (!dn) {
      return { ok: false, error: 'User not found in directory' };
    }

    stage = 'modify';
    const changes = [
      new Change({
        operation: 'delete',
        modification: new Attribute({
          type: 'unicodePwd',
          values: [Buffer.from(`"${currentPassword}"`, 'utf16le')],
        }),
      }),
      new Change({
        operation: 'add',
        modification: new Attribute({
          type: 'unicodePwd',
          values: [Buffer.from(`"${newPassword}"`, 'utf16le')],
        }),
      }),
    ];
    await withTimeout(client.modify(dn, changes));
    return { ok: true };
  } catch (error) {
    const err = error as { code?: number; message?: string };
    const message = err.message || '';
    if (stage === 'bind' || message.includes('data 52e')) {
      return { ok: false, error: 'Current password was not accepted by Active Directory.' };
    }
    if (
      err.code === 19 ||
      err.code === 53 ||
      message.includes('WILL_NOT_PERFORM') ||
      message.includes('constraint violation')
    ) {
      return {
        ok: false,
        error:
          'Active Directory rejected the new password. It may not meet complexity requirements or may match a previous password.',
      };
    }
    // Generic user-facing copy: raw directory messages must never reach the
    // browser. The structured detail rides along for audit logging only.
    const detail = message || 'Unknown error';
    return {
      ok: false,
      error: 'Unable to complete password change. Contact your administrator.',
      detail,
    };
  } finally {
    try {
      await client.unbind();
    } catch {
      // ignore
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms = LDAP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export interface AdAccountProfile {
  displayName?: string;
  mail?: string;
  memberOf: string[];
}

/** Same-connection self search used by authenticateAd({ withProfile }). */
async function readSelfProfile(
  client: Client,
  config: AuthConfig,
  username: string
): Promise<AdAccountProfile | undefined> {
  try {
    const { searchEntries } = await withTimeout(
      client.search(config.ldapSearchBase, {
        scope: 'sub',
        filter: `(sAMAccountName=${username.replace(/[()*\\]/g, '')})`,
        attributes: ['displayName', 'mail', 'memberOf'],
        sizeLimit: 1,
      })
    );
    const entry = searchEntries[0] as Record<string, string | string[]> | undefined;
    if (!entry) return undefined;
    const memberOfRaw = entry.memberOf;
    const memberOf = Array.isArray(memberOfRaw)
      ? (memberOfRaw as string[])
      : typeof memberOfRaw === 'string'
        ? [memberOfRaw]
        : [];
    return {
      displayName:
        typeof entry.displayName === 'string' && entry.displayName.trim()
          ? entry.displayName.trim()
          : undefined,
      mail:
        typeof entry.mail === 'string' && entry.mail.includes('@')
          ? entry.mail.trim()
          : undefined,
      memberOf,
    };
  } catch {
    return undefined;
  }
}

/**
 * Group-membership probe for the admin console (ADR-0014). Binds AS the user
 * with the same TLS policy as sign-in, then reads memberOf from the user's
 * directory entry. Transport failures surface as 'timeout' so callers can
 * retain exact failure semantics.
 */
export async function loadAdGroupMembership(
  config: AuthConfig,
  username: string,
  password: string
): Promise<{ ok: true; memberOf: string[] } | { ok: false; reason: 'invalid' | 'timeout' }> {
  const upn = username.includes('@') ? username : `${username}@${config.ldapDomain}`;
  const client = new Client({ url: config.ldapUrl, tlsOptions: tlsOptions(config) });
  try {
    await client.bind(upn, password);
    const { searchEntries } = await client.search(config.ldapSearchBase, {
      scope: 'sub',
      filter: `(sAMAccountName=${username.replace(/[()*\\]/g, '')})`,
      attributes: ['memberOf'],
    });
    const raw = searchEntries[0]?.memberOf;
    const memberOf = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
    return { ok: true, memberOf };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid credential|data 532|data 773|data 775/i.test(message)) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: false, reason: 'timeout' };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export type AdAdminState =
  | { ok: true; disabled: boolean; locked: boolean; memberOf: string[] }
  | { ok: false; reason: 'unconfigured' | 'not_found' | 'unavailable' };

function escapeFilterValue(value: string): string {
  return value
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

/** Live privileged-request check using the read-only directory service bind. */
export async function loadAdAdminState(config: AuthConfig, username: string): Promise<AdAdminState> {
  if (!config.ldapBindDn || !config.ldapBindPassword || !config.ldapSearchBase) {
    return { ok: false, reason: 'unconfigured' };
  }
  const client = new Client({ url: config.ldapUrl, tlsOptions: tlsOptions(config) });
  try {
    await withTimeout(client.bind(config.ldapBindDn, config.ldapBindPassword));
    const { searchEntries } = await withTimeout(client.search(config.ldapSearchBase, {
      scope: 'sub',
      filter: `(&(objectCategory=person)(sAMAccountName=${escapeFilterValue(username)}))`,
      attributes: ['memberOf', 'userAccountControl', 'lockoutTime'],
      sizeLimit: 1,
    }));
    const entry = searchEntries[0] as Record<string, string | string[]> | undefined;
    if (!entry) return { ok: false, reason: 'not_found' };
    const rawGroups = entry.memberOf;
    const memberOf = Array.isArray(rawGroups)
      ? rawGroups as string[]
      : typeof rawGroups === 'string' ? [rawGroups] : [];
    const uac = Number.parseInt(String(entry.userAccountControl ?? '0'), 10) || 0;
    const lockoutTime = Number.parseInt(String(entry.lockoutTime ?? '0'), 10) || 0;
    return {
      ok: true,
      disabled: (uac & 0x2) !== 0,
      locked: (uac & 0x10) !== 0 || lockoutTime > 0,
      memberOf,
    };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    await client.unbind().catch(() => {});
  }
}
