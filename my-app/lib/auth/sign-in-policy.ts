import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getConfigValue, getRequiredSecretValue } from '@/lib/config/resolver';
import { getOidcRuntimeConfig } from '@/lib/auth/oidc';
import { getOidcSignInMethods } from '@/lib/auth/alternate-signin';

export const SIGN_IN_POLICY_KEY = 'auth.signInPolicy';

export const PORTAL_SIGN_IN_METHOD_IDS = [
  'oidc',
  'native_ad',
  'local_break_glass',
] as const;

export type PortalSignInMethodId = (typeof PORTAL_SIGN_IN_METHOD_IDS)[number];

export interface PortalSignInPolicy {
  version: 1;
  methods: {
    oidc: {
      enabled: boolean;
      displayName: string;
      description: string;
    };
    nativeAd: { enabled: boolean };
    local: { enabled: boolean };
  };
}

export interface SignInMethodState {
  id: PortalSignInMethodId;
  displayName: string;
  description: string;
  enabled: boolean;
  ready: boolean;
  readinessIssue: string | null;
}

export interface ResolvedSignInPolicy {
  policy: PortalSignInPolicy;
  source: 'database' | 'legacy';
  methods: SignInMethodState[];
  revision: string | null;
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

function oidcCopyFromEnvironment(): Pick<PortalSignInPolicy['methods']['oidc'], 'displayName' | 'description'> {
  const runtime = getOidcRuntimeConfig();
  let issuerHost = '';
  try {
    issuerHost = runtime?.issuer ? new URL(runtime.issuer).hostname : '';
  } catch {
    issuerHost = '';
  }
  const displayName = process.env.AUTH_OIDC_DISPLAY_NAME?.trim()
    || issuerHost
    || 'Auth service';
  const description = process.env.AUTH_OIDC_DISPLAY_DESCRIPTION?.trim()
    || (issuerHost ? `Continue to ${issuerHost} to sign in.` : 'Continue to the configured authentication service.');
  return { displayName, description };
}

function validatePlainText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be plain text`);
  if (CONTROL_CHARACTER.test(value)) {
    throw new Error(`${label} must not contain control characters`);
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new Error(`${label} must be between ${min} and ${max} characters`);
  }
  return normalized;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireEnabled(value: unknown, label: string): boolean {
  const record = requireRecord(value, label);
  if (typeof record.enabled !== 'boolean') throw new Error(`${label}.enabled must be a boolean`);
  return record.enabled;
}

export function validatePortalSignInPolicy(value: unknown): PortalSignInPolicy {
  const root = requireRecord(value, SIGN_IN_POLICY_KEY);
  if (root.version !== 1) throw new Error('auth.signInPolicy.version must be 1');
  const methods = requireRecord(root.methods, 'auth.signInPolicy.methods');
  const oidc = requireRecord(methods.oidc, 'auth.signInPolicy.methods.oidc');
  const policy: PortalSignInPolicy = {
    version: 1,
    methods: {
      oidc: {
        enabled: requireEnabled(oidc, 'auth.signInPolicy.methods.oidc'),
        displayName: validatePlainText(oidc.displayName, 'OIDC display name', 1, 80),
        description: validatePlainText(oidc.description ?? '', 'OIDC description', 0, 200),
      },
      nativeAd: {
        enabled: requireEnabled(methods.nativeAd, 'auth.signInPolicy.methods.nativeAd'),
      },
      local: {
        enabled: requireEnabled(methods.local, 'auth.signInPolicy.methods.local'),
      },
    },
  };
  if (!policy.methods.oidc.enabled && !policy.methods.nativeAd.enabled && !policy.methods.local.enabled) {
    throw new Error('Enable at least one sign-in method');
  }
  return policy;
}

async function legacyPolicy(): Promise<PortalSignInPolicy> {
  const copy = oidcCopyFromEnvironment();
  let persistedMode: string | null = null;
  try {
    persistedMode = (await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { authMode: true },
    }))?.authMode ?? null;
  } catch {
    // Legacy environment resolution remains available until the new policy is saved.
  }
  const mode = persistedMode || process.env.AUTH_MODE?.trim() || 'native';
  const legacyAlternates = mode === 'oidc' ? getOidcSignInMethods() : [];
  return validatePortalSignInPolicy({
    version: 1,
    methods: {
      oidc: {
        enabled: mode === 'oidc',
        ...copy,
      },
      nativeAd: {
        enabled: mode === 'native' || legacyAlternates.includes('native_ad'),
      },
      local: {
        enabled: mode === 'local' || legacyAlternates.includes('local_break_glass'),
      },
    },
  });
}

export async function getPortalSignInReadiness(): Promise<Record<PortalSignInMethodId, {
  ready: boolean;
  issue: string | null;
}>> {
  const runtime = getOidcRuntimeConfig();
  let oidcReady = Boolean(runtime?.issuer && runtime.clientId && runtime.clientSecret && runtime.redirectUri);
  if (oidcReady && runtime) {
    try {
      const issuer = new URL(runtime.issuer);
      const redirect = new URL(runtime.redirectUri);
      oidcReady = (issuer.protocol === 'https:' || process.env.AUTH_ALLOW_INSECURE_OIDC === 'true')
        && (redirect.protocol === 'https:' || process.env.AUTH_ALLOW_INSECURE_OIDC === 'true');
    } catch {
      oidcReady = false;
    }
  }

  let directoryReady = false;
  try {
    const [url, domain, bindDn, bindPassword, searchBase] = await Promise.all([
      getConfigValue<string>('ldap.url'),
      getConfigValue<string>('ldap.domain'),
      getConfigValue<string>('ldap.bindDn'),
      getRequiredSecretValue('ldap.bindPassword'),
      getConfigValue<string>('ldap.searchBase'),
    ]);
    directoryReady = url.trim().toLowerCase().startsWith('ldaps://')
      && Boolean(domain.trim())
      && Boolean(bindDn.trim())
      && Boolean(bindPassword.trim())
      && Boolean(searchBase.trim());
  } catch {
    directoryReady = false;
  }

  let localReady = false;
  try {
    localReady = await prisma.localAccount.count({ where: { isActive: true } }) > 0;
  } catch {
    localReady = false;
  }

  return {
    oidc: {
      ready: oidcReady,
      issue: oidcReady ? null : 'Configure AUTH_ISSUER, AUTH_CLIENT_ID, AUTH_CLIENT_SECRET, and AUTH_REDIRECT_URI.',
    },
    native_ad: {
      ready: directoryReady,
      issue: directoryReady ? null : 'Configure the portal LDAPS URL, domain, bind DN, bind password, and search base before enabling direct Active Directory sign-in.',
    },
    local_break_glass: {
      ready: localReady,
      issue: localReady ? null : 'Create and enable at least one portal local break-glass account before enabling local sign-in.',
    },
  };
}

export async function getPortalSignInPolicy(): Promise<ResolvedSignInPolicy> {
  // Legacy inputs apply only after a successful lookup proves that no policy
  // has been saved. A database failure must not re-authorize legacy methods.
  const row = await prisma.systemConfigEntry.findUnique({
    where: { key: SIGN_IN_POLICY_KEY },
    select: { value: true, updatedAt: true },
  });

  const source = row ? 'database' as const : 'legacy' as const;
  // A present but malformed database policy never falls back to legacy inputs.
  const policy = row ? validatePortalSignInPolicy(row.value) : await legacyPolicy();
  const readiness = await getPortalSignInReadiness();
  const methods: SignInMethodState[] = [
    {
      id: 'oidc',
      displayName: policy.methods.oidc.displayName,
      description: policy.methods.oidc.description,
      enabled: policy.methods.oidc.enabled,
      ready: readiness.oidc.ready,
      readinessIssue: readiness.oidc.issue,
    },
    {
      id: 'native_ad',
      displayName: 'Active Directory',
      description: 'Sign in directly with your directory account.',
      enabled: policy.methods.nativeAd.enabled,
      ready: readiness.native_ad.ready,
      readinessIssue: readiness.native_ad.issue,
    },
    {
      id: 'local_break_glass',
      displayName: 'Local break-glass',
      description: 'Sign in with a portal local account.',
      enabled: policy.methods.local.enabled,
      ready: readiness.local_break_glass.ready,
      readinessIssue: readiness.local_break_glass.issue,
    },
  ];
  return { policy, source, methods, revision: row?.updatedAt.toISOString() ?? null };
}

export async function assertPortalSignInMethodEnabled(methodId: PortalSignInMethodId): Promise<void> {
  const resolved = await getPortalSignInPolicy();
  const method = resolved.methods.find((candidate) => candidate.id === methodId);
  if (!method?.enabled || !method.ready) {
    throw new Error('SIGN_IN_METHOD_DISABLED');
  }
}

export async function validateUsablePortalSignInPolicy(value: unknown): Promise<PortalSignInPolicy> {
  const policy = validatePortalSignInPolicy(value);
  const readiness = await getPortalSignInReadiness();
  const unavailable: string[] = [];
  if (policy.methods.oidc.enabled && !readiness.oidc.ready) unavailable.push(readiness.oidc.issue!);
  if (policy.methods.nativeAd.enabled && !readiness.native_ad.ready) unavailable.push(readiness.native_ad.issue!);
  if (policy.methods.local.enabled && !readiness.local_break_glass.ready) unavailable.push(readiness.local_break_glass.issue!);
  if (unavailable.length > 0) throw new Error(unavailable.join(' '));
  return policy;
}

export function asInputJson(policy: PortalSignInPolicy): Prisma.InputJsonValue {
  return policy as unknown as Prisma.InputJsonValue;
}
