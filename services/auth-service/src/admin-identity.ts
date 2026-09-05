import type { AuthConfig } from './config';
import { ALLOWED_SCOPES, DEFAULT_SESSION_TTL_SECONDS } from './oidc-clients';

/**
 * Redacted, read-only view of the effective IdP configuration. The admin
 * console needs to explain where authentication happens without exposing
 * bind identities, passwords, client secrets, cookie keys, or signing keys.
 */
export interface IdentityConfiguration {
  generatedAt: string;
  source: {
    name: 'Active Directory';
    role: 'primary';
    endpoint: string;
    domain: string;
    searchBase: string;
    transport: 'LDAPS' | 'LDAP';
    certificateVerification: 'required' | 'disabled' | 'not applicable';
    directorySearch: 'configured' | 'sign-in only';
    managedBy: 'deployment';
  };
  recovery: {
    name: 'Auth Manager local recovery';
    role: 'admin console recovery';
    activation: 'explicit Auth Manager sign-in only';
    oidcEligible: false;
    managedBy: 'Auth Manager';
    enabled: boolean;
    accountCount: number | null;
  };
  safeguards: {
    turnstile: 'required';
    ipRateLimit: { attempts: number; windowMs: number };
    accountLockout: { attempts: number; windowMs: number };
    trustedProxyHeaders: boolean;
    deviceEvidence: 'off' | 'shadow';
  };
  federation: {
    issuer: string;
    protocol: 'OpenID Connect';
    flow: 'Authorization code + PKCE';
    signingAlgorithm: 'RS256';
    defaultSessionTtlSeconds: number;
    allowedScopes: readonly string[];
    roleClaimsIncluded: false;
    backChannelLogout: true;
  };
  administration: {
    namedOperators: number;
    allowedGroups: number;
    directoryVerification: 'every protected request';
    localRecoveryEnabled: boolean;
    localRecoveryVerification: 'active state and credential version on every protected request';
  };
}

function safeDirectoryEndpoint(raw: string): string {
  try {
    const parsed = new URL(raw);
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${parsed.hostname}${port}`;
  } catch {
    return 'Invalid directory endpoint';
  }
}

export function buildIdentityConfiguration(
  config: AuthConfig,
  options: { now?: Date; recoveryAccountCount?: number | null } = {}
): IdentityConfiguration {
  const secureTransport = config.ldapUrl.toLowerCase().startsWith('ldaps://');
  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    source: {
      name: 'Active Directory',
      role: 'primary',
      endpoint: safeDirectoryEndpoint(config.ldapUrl),
      domain: config.ldapDomain,
      searchBase: config.ldapSearchBase,
      transport: secureTransport ? 'LDAPS' : 'LDAP',
      certificateVerification: secureTransport
        ? (config.allowInvalidCertificates ? 'disabled' : 'required')
        : 'not applicable',
      directorySearch:
        config.ldapBindDn && config.ldapBindPassword ? 'configured' : 'sign-in only',
      managedBy: 'deployment',
    },
    recovery: {
      name: 'Auth Manager local recovery',
      role: 'admin console recovery',
      activation: 'explicit Auth Manager sign-in only',
      oidcEligible: false,
      managedBy: 'Auth Manager',
      enabled: Boolean(config.adminLocalRecoveryEnabled),
      accountCount: options.recoveryAccountCount ?? null,
    },
    safeguards: {
      turnstile: 'required',
      ipRateLimit: {
        attempts: config.loginMaxAttempts,
        windowMs: config.loginWindowMs,
      },
      accountLockout: {
        attempts: config.accountLockMaxAttempts,
        windowMs: config.accountLockWindowMs,
      },
      trustedProxyHeaders: config.trustProxyHeaders,
      deviceEvidence: config.deviceRiskMode,
    },
    federation: {
      issuer: config.issuer,
      protocol: 'OpenID Connect',
      flow: 'Authorization code + PKCE',
      signingAlgorithm: 'RS256',
      defaultSessionTtlSeconds: DEFAULT_SESSION_TTL_SECONDS,
      allowedScopes: [...ALLOWED_SCOPES],
      roleClaimsIncluded: false,
      backChannelLogout: true,
    },
    administration: {
      namedOperators: config.adminUsernames.length,
      allowedGroups: config.adminGroups.length,
      directoryVerification: 'every protected request',
      localRecoveryEnabled: Boolean(config.adminLocalRecoveryEnabled),
      localRecoveryVerification: 'active state and credential version on every protected request',
    },
  };
}
