import { Client } from 'ldapts';
import { getLDAPTLSOptions } from './client';
import { parseLdapUrl } from './url-health';
import { getConfigValue, getRequiredSecretValue } from '@/lib/config/resolver';
import { sanitizeLdapError, withTimeout, LDAP_TIMEOUT } from './utils';
import { appLogger } from '@/lib/logger';

/**
 * Operator-facing directory connectivity tests backing System Configuration.
 * These run REAL connections against a specific server so an administrator
 * can verify (A) the domain controller is reachable and usable before it is
 * saved, and (B) the configured bind account can authenticate and read the
 * directory. Results are sanitized; no credential material is returned.
 */

export interface DirectoryConnectionTestResult {
  ok: boolean;
  url: string;
  latencyMs?: number;
  /** False when LDAP_ALLOW_INVALID_CERTS disabled verification for this probe. */
  tlsVerified: boolean;
  dnsHostName?: string | null;
  namingContext?: string | null;
  error?: string;
}

export interface DirectoryBindTestResult {
  ok: boolean;
  url: string;
  bindOk: boolean;
  searchOk: boolean;
  latencyMs?: number;
  searchedBase?: string | null;
  error?: string;
}

function sanitizeError(error: unknown): string {
  try {
    const sanitized = sanitizeLdapError(error);
    if (sanitized && typeof sanitized.message === 'string' && sanitized.message) {
      return sanitized.message;
    }
  } catch {
    // fall through to a direct message below
  }
  return error instanceof Error && error.message ? error.message : 'Connection failed';
}

/**
 * Verify one ldaps:// endpoint answers TLS + LDAP by reading the rootDSE.
 * No credentials are used: this proves the SERVER is detected and usable.
 */
export async function testDirectoryConnection(rawUrl: string): Promise<DirectoryConnectionTestResult> {
  const trimmed = rawUrl.trim();
  const endpoint = parseLdapUrl(trimmed);
  const tlsOptions = getLDAPTLSOptions();

  if (!endpoint) {
    return {
      ok: false,
      url: trimmed,
      tlsVerified: tlsOptions.rejectUnauthorized,
      error: 'URL must be a valid ldaps://host[:port] endpoint',
    };
  }

  let client: Client | null = null;
  const startedAt = Date.now();
  try {
    client = new Client({ url: endpoint.url, tlsOptions });
    const result = await withTimeout(
      client.search('', {
        filter: '(objectClass=*)',
        scope: 'base' as const,
        attributes: ['dnsHostName', 'defaultNamingContext', 'rootDomainNamingContext'],
      }),
      LDAP_TIMEOUT
    );
    const entry = result.searchEntries?.[0];
    const record: DirectoryConnectionTestResult = {
      ok: true,
      url: endpoint.url,
      latencyMs: Date.now() - startedAt,
      tlsVerified: tlsOptions.rejectUnauthorized,
      dnsHostName: typeof entry?.dnsHostName === 'string' ? entry.dnsHostName : null,
      namingContext:
        typeof entry?.rootDomainNamingContext === 'string'
          ? entry.rootDomainNamingContext
          : typeof entry?.defaultNamingContext === 'string'
            ? entry.defaultNamingContext
            : null,
    };
    return record;
  } catch (error) {
    appLogger.warn('Directory connection test failed', { error: sanitizeError(error) });
    return {
      ok: false,
      url: endpoint.url,
      latencyMs: Date.now() - startedAt,
      tlsVerified: tlsOptions.rejectUnauthorized,
      error: sanitizeError(error),
    };
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch {
        // unbind failures must not mask the test outcome
      }
    }
  }
}

/**
 * Verify the configured service bind account against one endpoint (or the
 * saved primary when none given), then prove READ capability with a bounded
 * sample search under the configured user search base.
 */
export async function testDirectoryBindAccount(options: { url?: string } = {}): Promise<DirectoryBindTestResult> {
  const tlsOptions = getLDAPTLSOptions();

  let targetUrl = options.url?.trim() ?? '';
  if (!targetUrl) {
    targetUrl = await getConfigValue<string>('ldap.url').catch(() => '');
  }
  const endpoint = parseLdapUrl(targetUrl);
  if (!endpoint) {
    return {
      ok: false,
      url: targetUrl,
      bindOk: false,
      searchOk: false,
      searchedBase: null,
      error: 'Target must be a valid ldaps://host[:port] endpoint',
    };
  }

  const failure = (partial: Partial<DirectoryBindTestResult> & { error: string }): DirectoryBindTestResult => ({
    ok: false,
    url: endpoint.url,
    bindOk: partial.bindOk ?? false,
    searchOk: partial.searchOk ?? false,
    latencyMs: partial.latencyMs,
    searchedBase: partial.searchedBase ?? null,
    error: partial.error,
  });

  let bindDn: string;
  let bindPassword: string;
  try {
    bindDn = await getConfigValue<string>('ldap.bindDn');
    bindPassword = await getRequiredSecretValue('ldap.bindPassword');
  } catch {
    return failure({ error: 'Bind account is not configured (set ldap.bindDn and its password first)' });
  }
  if (!bindDn.trim()) {
    return failure({ error: 'Bind account DN is not configured (ldap.bindDn)' });
  }

  let client: Client | null = null;
  const startedAt = Date.now();
  try {
    client = new Client({ url: endpoint.url, tlsOptions });
    await withTimeout(client.bind(bindDn, bindPassword), LDAP_TIMEOUT);
  } catch (error) {
    appLogger.warn('Directory bind-account test failed at bind', { error: sanitizeError(error) });
    const message = sanitizeError(error);
    const timedOut = message.toLowerCase().includes('timed out');
    return failure({
      latencyMs: Date.now() - startedAt,
      error: timedOut ? `Bind timed out after ${Math.round(LDAP_TIMEOUT / 1000)}s` : `Bind failed: ${message}`,
    });
  }

  let searchBase: string | null = null;
  try {
    searchBase = (await getConfigValue<string>('ldap.searchBase')) || null;
  } catch {
    searchBase = null;
  }
  if (!searchBase) {
    return {
      ok: true,
      url: endpoint.url,
      bindOk: true,
      searchOk: false,
      latencyMs: Date.now() - startedAt,
      searchedBase: null,
      error: 'Bind succeeded, but ldap.searchBase is not configured so read access was not verified',
    };
  }

  try {
    await withTimeout(
      client.search(searchBase, {
        scope: 'sub' as const,
        filter: '(objectClass=*)',
        sizeLimit: 1,
        attributes: ['dn'],
      }),
      LDAP_TIMEOUT
    );
    return {
      ok: true,
      url: endpoint.url,
      bindOk: true,
      searchOk: true,
      latencyMs: Date.now() - startedAt,
      searchedBase: searchBase,
    };
  } catch (error) {
    appLogger.warn('Directory bind-account test failed at search', { error: sanitizeError(error) });
    return failure({
      bindOk: true,
      latencyMs: Date.now() - startedAt,
      searchedBase: searchBase,
      error: `Bind succeeded but the sample search failed: ${sanitizeError(error)}`,
    });
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch {
        // ignore
      }
    }
  }
}
