import { interactionPolicy, type Adapter } from 'oidc-provider';
import type { AuthConfig } from './config';
import { resolveSessionTtlSeconds } from './oidc-clients';
import { providerErrorRenderer } from './public-ui';

/**
 * oidc-provider construction options (extracted from index.ts so tests can
 * pin the security-critical knobs without booting Redis/Prisma).
 *
 * PKCE is pinned EXPLICITLY to required-for-every-client (including
 * confidential clients like the bootstrap portal client). The library
 * default happens to require PKCE today, but it is conditional and a
 * dependency upgrade could silently flip it; this pin cannot.
 */

export const CLAIM_TTL_SECONDS = 8 * 60 * 60; // matches provider session TTL

export function claimsKey(accountId: string): string {
  return `authsvc:claims:${accountId.toLowerCase()}`;
}

export interface ProviderDependencies {
  /** Minimal Redis read surface for the amr lookup in findAccount. */
  redis: { get(key: string): Promise<string | null> };
  createAdapter: (name: string) => Adapter;
}

/**
 * Profile claims cached at sign-in time (ADR-0012 amendment). Roles and
 * elevation stay OUT of tokens per the original decision - only descriptive
 * directory attributes (display name, real mail, group DNs) ride the opt-in
 * `groups` / `profile` scopes.
 */
export interface CachedAccountClaims {
  name?: string;
  email?: string;
  groups?: string[];
}

function providerInteractionPolicy(): Array<unknown> {
  const policy = interactionPolicy.base();
  const loginPrompt = policy.get('login');
  if (!loginPrompt) throw new Error('oidc-provider login policy is unavailable');

  loginPrompt.checks.add(new interactionPolicy.Check(
    'missing_authentication_authority',
    'The existing provider session has no verified AD authentication authority',
    (ctx: unknown) => {
      const session = (ctx as {
        oidc?: { session?: { accountId?: unknown; amr?: unknown } };
      })?.oidc?.session;
      // The built-in no_session check owns unauthenticated requests. This
      // extra check only upgrades legacy or malformed authenticated sessions
      // to a fresh credential interaction instead of issuing an authority-less
      // ID token that the portal must reject.
      if (typeof session?.accountId !== 'string') {
        return interactionPolicy.Check.NO_NEED_TO_PROMPT;
      }
      return Array.isArray(session.amr) && session.amr.includes('ad')
        ? interactionPolicy.Check.NO_NEED_TO_PROMPT
        : interactionPolicy.Check.REQUEST_PROMPT;
    },
  ));

  return policy;
}

export function parseCachedClaims(raw: string | null): CachedAccountClaims {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as CachedAccountClaims;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return {
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : undefined,
      email: typeof parsed.email === 'string' && parsed.email ? parsed.email : undefined,
      groups: Array.isArray(parsed.groups)
        ? parsed.groups.filter((e): e is string => typeof e === 'string')
        : undefined,
    };
  } catch {
    return {};
  }
}

export function buildProviderOptions(
  config: AuthConfig,
  deps: ProviderDependencies,
  /** Shared signing JWK Set (jwks.ts) so logout tokens reuse the provider keys. */
  jwks?: { keys: Array<Record<string, unknown>> }
): Record<string, unknown> {
  return {
    ...(jwks ? { jwks } : {}),
    renderError: providerErrorRenderer,
    clients: [
      {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: config.redirectUris,
        post_logout_redirect_uris: config.postLogoutRedirects,
        // Required for Client.includeSid(): without these the provider omits
        // the `sid` claim from codes/ID tokens, the portal cannot record the
        // provider session, and its backchannel logout becomes a no-op
        // (silent SSO after portal logout). The provider only POSTs to this
        // URI from /session/end_session, which this deployment never uses.
        backchannel_logout_uri: config.backchannelLogoutUri,
        backchannel_logout_session_required: true,
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        // The provider signs with its RSA key only; pin the expected alg so
        // client-controlled metadata can never negotiate it down.
        id_token_signed_response_alg: 'RS256',
      },
    ],
    claims: {
      // Authorization-code ID tokens use the OpenID-only mask when userinfo
      // is enabled. Keep code-bound authentication evidence in that mask.
      openid: ['sub', 'provider_session_expires_at', 'amr'],
      email: ['email'],
      profile: ['name', 'preferred_username'],
      // amr is emitted by oidc-provider from the exact authenticated Session.
      // findAccount never synthesizes or defaults authentication authority.
      amr: ['amr'],
      // Opt-in directory group DNs (ADR-0012 amendment): lets relying parties
      // such as Proxmox map AD groups to local roles exactly as they would
      // against a direct LDAP bind. Still no roles/elevation in tokens.
      groups: ['groups'],
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: true },
      revocation: { enabled: true },
      // Recognizes backchannel_logout_uri / backchannel_logout_session_required
      // client metadata; without it Client.includeSid() is false and codes/ID
      // tokens omit the `sid` claim, breaking the portal's full logout.
      backchannelLogout: { enabled: true },
    },
    interactions: {
      policy: providerInteractionPolicy(),
    },
    pkce: {
      required: (): boolean => true,
    },
    ttl: {
      Interaction: 600,
      // Per-client session lifetime from the Auth Manager registry (synchronous
      // in-process mirror refreshed on boot + mutations), with the legacy env
      // override and 8h default as fallbacks. See oidc-clients.ts (ADR-0014).
      Session: (ctx: unknown) => resolveSessionTtlSeconds(
        (ctx as { oidc?: { client?: { clientId?: string } } })?.oidc?.client?.clientId,
      ),
      Grant: 8 * 60 * 60,
      AccessToken: 60 * 60,
      IdToken: 10 * 60,
      RefreshToken: 8 * 60 * 60,
    },
    cookies: {
      keys: config.cookieKeys,
      // Secure is pinned from the ISSUER scheme (the factory knows the
      // deployment's transport) rather than relying solely on runtime proto
      // detection: an https issuer must never mint non-Secure cookies even
      // if a misconfigured proxy reports plain http.
      long: { signed: true, sameSite: 'lax', secure: config.issuer.startsWith('https://') },
      short: { signed: true, sameSite: 'lax', secure: config.issuer.startsWith('https://') },
    },
    adapter: deps.createAdapter,
    findAccount: async (ctx: unknown, id: string, token?: unknown) => {
      let cached: CachedAccountClaims = {};
      try {
        cached = parseCachedClaims(await deps.redis.get(claimsKey(id)));
      } catch {
        // Descriptive profile claims fall back to safe synthesized values.
      }
      const oidcContext = (ctx as {
        oidc?: {
          session?: { exp?: unknown; accountId?: unknown };
          provider?: { Session?: { findByUid(uid: string): Promise<{ exp?: unknown; accountId?: unknown } | undefined> } };
        };
      })?.oidc;
      const tokenSessionUid = (token as { sessionUid?: unknown } | undefined)?.sessionUid;
      const providerSession = oidcContext?.session
        ?? (typeof tokenSessionUid === 'string' && oidcContext?.provider?.Session
          ? await oidcContext.provider.Session.findByUid(tokenSessionUid)
          : undefined);
      const candidateExpiry = providerSession?.exp;
      const providerSessionExpiresAt = providerSession?.accountId === id
        && typeof candidateExpiry === 'number'
        && Number.isSafeInteger(candidateExpiry)
        && candidateExpiry > 0
        ? candidateExpiry
        : undefined;
      const fallbackEmail = id.includes('@') ? id : `${id}@${config.ldapDomain}`;
      return {
        accountId: id,
        async claims() {
          return {
            sub: id,
            ...(providerSessionExpiresAt ? { provider_session_expires_at: providerSessionExpiresAt } : {}),
            preferred_username: id,
            email: cached.email ?? fallbackEmail,
            ...(cached.name ? { name: cached.name } : {}),
            ...(cached.groups?.length ? { groups: cached.groups } : {}),
          };
        },
      };
    },
  };
}
