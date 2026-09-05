import { Client } from 'ldapts';
import type { AuthConfig } from './config';
import { tlsOptions } from './ldap';
import { prisma } from './db';

/**
 * Read-only directory facade for the Auth Manager console (ADR-0012
 * follow-up). Operators get AD lookups WITHOUT the portal: profile, groups,
 * lockout state, and sign-in history over the shared AuditLog.
 *
 * Posture: reads only; bounded result sets; LDAP filter escaping; the
 * configured service bind (LDAP_BIND_DN + LDAP_BIND_PASSWORD), never an
 * anonymous bind or an end-user password; identical TLS discipline to
 * sign-in (ldaps://, verification on unless the explicit escape hatch). No
 * attribute is ever written.
 */

export const DIRECTORY_SEARCH_LIMIT = 20;
const MIN_QUERY_LENGTH = 2;
const LDAP_TIMEOUT_MS = 10_000;

export interface DirectoryUserView {
  username: string;
  displayName?: string;
  mail?: string;
  disabled: boolean;
  lockedOut: boolean;
  /** Group CNs (not full DNs) for compact display, capped. */
  groups: string[];
  groupCount: number;
}

/** RFC 4515 filter escaping for user-supplied search input. */
export function escapeLdapFilter(value: string): string {
  return value
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

export function directorySearchConfigured(config: AuthConfig): boolean {
  return Boolean(config.ldapBindDn && config.ldapBindPassword && config.ldapSearchBase);
}

const USER_ACCOUNT_CONTROL_DISABLED = 0x2;
const USER_ACCOUNT_CONTROL_LOCKOUT = 0x10;

function groupCn(dn: string): string {
  const match = /^CN=([^,]+)/i.exec(dn);
  return match?.[1] ?? dn;
}

function toView(entry: Record<string, string | string[]>): DirectoryUserView | null {
  const username = typeof entry.sAMAccountName === 'string' ? entry.sAMAccountName : '';
  if (!username) return null;
  const uacRaw = entry.userAccountControl;
  const uac = typeof uacRaw === 'string'
    ? Number.parseInt(uacRaw, 10)
    : typeof uacRaw === 'number'
      ? uacRaw
      : 0;
  const memberOfRaw = entry.memberOf;
  const memberOf = Array.isArray(memberOfRaw)
    ? (memberOfRaw as string[])
    : typeof memberOfRaw === 'string'
      ? [memberOfRaw]
      : [];
  return {
    username,
    displayName: typeof entry.displayName === 'string' ? entry.displayName : undefined,
    mail: typeof entry.mail === 'string' ? entry.mail : undefined,
    disabled: (uac & USER_ACCOUNT_CONTROL_DISABLED) !== 0,
    lockedOut: (uac & USER_ACCOUNT_CONTROL_LOCKOUT) !== 0,
    groups: memberOf.slice(0, 8).map(groupCn),
    groupCount: memberOf.length,
  };
}

async function withSearchClient<T>(
  config: AuthConfig,
  fn: (client: Client) => Promise<T>
): Promise<T | null> {
  const client = new Client({ url: config.ldapUrl, tlsOptions: tlsOptions(config) });
  try {
    if (!directorySearchConfigured(config)) return null;
    await client.bind(config.ldapBindDn, config.ldapBindPassword);
    return await fn(client);
  } catch (error) {
    console.error('[auth] directory search failed', error);
    return null;
  } finally {
    await client.unbind().catch(() => {});
  }
}

const USER_ATTRIBUTES = ['sAMAccountName', 'displayName', 'mail', 'memberOf', 'userAccountControl'];

export async function searchDirectoryUsers(
  config: AuthConfig,
  rawQuery: string
): Promise<DirectoryUserView[] | null> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY_LENGTH) return [];
  const safe = escapeLdapFilter(query);
  return withSearchClient(config, async (client) => {
    const { searchEntries } = await withTimeout(
      client.search(config.ldapSearchBase, {
        scope: 'sub',
        filter:
          `(&(objectCategory=person)(|(sAMAccountName=${safe}*)` +
          `(displayName=${safe}*)(mail=${safe}*)))`,
        attributes: USER_ATTRIBUTES,
        sizeLimit: DIRECTORY_SEARCH_LIMIT,
      })
    );
    return searchEntries
      .map((entry) => toView(entry as Record<string, string | string[]>))
      .filter((entry): entry is DirectoryUserView => entry !== null);
  });
}

export async function loadDirectoryUser(
  config: AuthConfig,
  rawUsername: string
): Promise<DirectoryUserView | null> {
  const username = rawUsername.trim();
  if (!username || username.length > 104) return null;
  const safe = escapeLdapFilter(username);
  return withSearchClient(config, async (client) => {
    const { searchEntries } = await withTimeout(
      client.search(config.ldapSearchBase, {
        scope: 'sub',
        filter: `(&(objectCategory=person)(sAMAccountName=${safe}))`,
        attributes: USER_ATTRIBUTES,
        sizeLimit: 1,
      })
    );
    const entry = searchEntries[0] as Record<string, string | string[]> | undefined;
    return entry ? toView(entry) : null;
  });
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

export interface DirectoryUserSignInRow {
  action: string;
  outcome: string | null;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

/** Durable sign-in trail over the shared AuditLog (ADR-0014 posture). */
export async function recentSignInsFor(
  username: string,
  take = 20
): Promise<DirectoryUserSignInRow[]> {
  if (!username || take < 1 || take > 100) return [];
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { in: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_FORCE_LOGOUT'] },
      OR: [{ username }, { subjectUsername: username }],
    },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      action: true,
      outcome: true,
      success: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    action: row.action,
    outcome: row.outcome,
    success: row.success,
    ip: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  }));
}

export interface RecentAuditRow {
  id: string;
  action: string;
  username: string;
  actorType: string | null;
  outcome: string | null;
  category: string;
  createdAt: Date;
}

/** Console audit feed over the shared AuditLog. */
export async function recentAuditEvents(take = 50): Promise<RecentAuditRow[]> {
  const bounded = Math.min(Math.max(take, 1), 100);
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: bounded,
    select: {
      id: true,
      action: true,
      username: true,
      actorType: true,
      outcome: true,
      category: true,
      createdAt: true,
    },
  });
  return rows;
}
