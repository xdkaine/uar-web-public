import type http from 'node:http';
import { validateBrandingDoc, defaultBrandingDoc, type BrandingDoc } from './branding';
import {
  validateRedirectUris,
  validateOptionalRedirectUris,
  validateBackchannelLogoutUri,
  validateRequestedIdTokenAlg,
  validateRequestedScope,
  CLIENT_ID_PATTERN,
  OidcClientInCatalogError,
} from './oidc-clients';
import { listBrandingRevisions, restoreBrandingRevision, saveBrandingDoc } from './branding-store';
import {
  createOidcClient,
  deleteOidcClient,
  listOidcClients,
  providerClientAdapter,
  rotateOidcClientSecret,
  updateOidcClient,
} from './oidc-clients';
import { clampSessionTtlSeconds, MAX_SESSION_TTL_SECONDS, MIN_SESSION_TTL_SECONDS } from './oidc-clients';

type MirrorRedis = ConstructorParameters<typeof RedisAdapter>[1];
import { prisma } from './db';
import { renderBrandingPage, type RenderKind } from './render';
import { backchannelLogoutUriFor } from './config';
import { sharedProviderKeys } from './jwks';
import {
  pushBackchannelLogouts,
  type DeliveryRecord,
  type DestroyedAuthorization,
} from './logout-token';
import { readRawBody } from './httputil';
import { sameOriginRequest, type AdminPrincipal } from './admin-auth';
import { revokeAdminSession } from './admin-sessions';
import { RedisAdapter } from './adapter';
import {
  destroySessionBySid,
  destroySessionsForClient,
  destroySessionsForUser,
  listActiveSessions,
  type DestroyOutcome,
} from './session-store';
import {
  buildDashboardData,
  loadDashboardLayout,
  saveDashboardLayout,
  validateDashboardLayout,
} from './admin-dashboard';
import { buildIdentityConfiguration } from './admin-identity';
import { createPreviewDraft } from './admin-preview';
import {
  DIRECTORY_SEARCH_LIMIT,
  directorySearchConfigured,
  loadDirectoryUser,
  recentSignInsFor,
  searchDirectoryUsers,
} from './admin-users';
import type { AuthConfig } from './config';
import {
  auditRowsToCsv,
  auditRowsToNdjson,
  exportAuditEvents,
  parseAuditFilters,
  queryAuditEvents,
} from './admin-audit';
import {
  createCatalogEntry,
  deleteCatalogEntry,
  listCatalogEntries,
  updateCatalogEntry,
  validateCatalogEntry,
} from './application-catalog';
import {
  createRecoveryAccount,
  listRecoveryAccounts,
  normalizeRecoveryUsername,
  rotateRecoveryPassword,
  setRecoveryAccountActive,
  validateRecoveryPassword,
} from './admin-recovery';

/**
 * Cookie-guarded JSON API behind the first-party /admin console. All state
 * changes require a valid admin session cookie (checked by the router in
 * index.ts), a matching Origin, and a JSON content type. Writes reuse
 * branding-store's validation + audit path.
 */

const MAX_JSON_BODY_BYTES = 128 * 1024;

function sendJson(res: http.ServerResponse, status: number, payload?: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Expected application/json');
  }
  const raw = await readRawBody(req, MAX_JSON_BODY_BYTES);
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid JSON body');
  }
  return parsed as Record<string, unknown>;
}

/** Enabled OIDC clients for the profile selector; falls back to configured client when the registry is empty/absent. */
async function listClients(configuredClientId: string): Promise<Array<{ clientId: string; name: string }>> {
  try {
    const rows = await prisma.oidcClient.findMany({
      where: { enabled: true },
      select: { clientId: true, name: true },
      orderBy: { clientId: 'asc' },
    });
    if (rows.length) return rows;
  } catch (error) {
    // Registry table may not exist yet (pre-migration deployments); the
    // configured client keeps the selector usable.
    console.error('[auth] oidc client listing failed', error);
  }
  return [{ clientId: configuredClientId, name: 'Configured relying party' }];
}

/**
 * Back-channel logout target for a destroyed authorization: the registered
 * backchannel_logout_uri from the provider's Redis Client mirror (covers
 * registry apps), else derived from its redirect URIs; the bootstrap client
 * falls back to static config. Undefined => reported as unreachable.
 */
async function backchannelUriFor(
  redis: MirrorRedis,
  config: AuthConfig,
  clientId: string
): Promise<string | undefined> {
  try {
    const raw = await redis.get(`oidc:Client:${clientId}`);
    if (raw) {
      const payload = JSON.parse(raw) as {
        backchannel_logout_uri?: unknown;
        redirect_uris?: unknown;
      };
      if (typeof payload.backchannel_logout_uri === 'string' && payload.backchannel_logout_uri) {
        return payload.backchannel_logout_uri;
      }
      const uris = Array.isArray(payload.redirect_uris)
        ? payload.redirect_uris.filter((uri): uri is string => typeof uri === 'string')
        : [];
      const derived = backchannelLogoutUriFor(uris);
      if (derived) return derived;
    }
  } catch {
    // Fall through to static bootstrap resolution.
  }
  if (clientId === config.clientId) return config.backchannelLogoutUri || undefined;
  return undefined;
}

/**
 * Best-effort IdP-initiated pushes for one destroy result. Never throws:
 * destruction already succeeded and must complete even when every RP is down.
 */
async function emitBackchannelLogouts(
  redis: MirrorRedis,
  config: AuthConfig,
  pairs: readonly DestroyedAuthorization[]
): Promise<DeliveryRecord[]> {
  if (!pairs.length) return [];
  try {
    return await pushBackchannelLogouts({
      pairs,
      issuer: config.issuer,
      signing: sharedProviderKeys().logout,
      resolveUri: (clientId) => backchannelUriFor(redis, config, clientId),
    });
  } catch (error) {
    console.error('[auth] back-channel logout emission failed', error);
    return [];
  }
}

export async function handleAdminApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  subPath: string,
  principalInput: AdminPrincipal | string,
  config: AuthConfig,
  redis?: MirrorRedis
): Promise<void> {
  const method = req.method ?? 'GET';
  const principal: AdminPrincipal = typeof principalInput === 'string'
    ? {
        username: principalInput,
        authMethod: 'ad',
        sessionId: 'compatibility-test-session',
        viaGroup: false,
      }
    : principalInput;
  const adminUsername = principal.username;

  if (method !== 'GET' && !sameOriginRequest(req, config)) {
    sendJson(res, 403, { error: 'cross_origin_blocked' });
    return;
  }

  try {
    if (method === 'GET' && subPath === 'session') {
      sendJson(res, 200, {
        username: adminUsername,
        issuer: config.issuer,
        authenticationMethod: principal.authMethod,
      });
      return;
    }

    // ---- Public application catalog ---------------------------------------
    const catalogMatch = /^catalog\/([A-Za-z0-9_-]{1,64})$/.exec(subPath);
    if (method === 'GET' && subPath === 'catalog') {
      sendJson(res, 200, { entries: await listCatalogEntries() });
      return;
    }
    if (method === 'POST' && subPath === 'catalog') {
      const input = validateCatalogEntry(await readJsonBody(req));
      const entry = await createCatalogEntry(input, adminUsername);
      sendJson(res, 201, { entry });
      return;
    }
    if (catalogMatch && method === 'PATCH') {
      const input = validateCatalogEntry(await readJsonBody(req));
      const entry = await updateCatalogEntry(catalogMatch[1], input, adminUsername);
      if (!entry) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      sendJson(res, 200, { entry });
      return;
    }
    if (catalogMatch && method === 'DELETE') {
      const removed = await deleteCatalogEntry(catalogMatch[1], adminUsername);
      if (!removed) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      sendJson(res, 204);
      return;
    }

    // ---- Client registry (Auth Manager) ------------------------------------
    const registryMatch = /^registry\/([A-Za-z0-9_-]+)$/.exec(subPath);
    if (subPath === 'registry' || registryMatch) {
      if (!redis) {
        sendJson(res, 503, { error: 'registry_unavailable' });
        return;
      }
      const mirror = providerClientAdapter(new RedisAdapter('Client', redis));
      const id = registryMatch?.[1];

      if (method === 'GET' && !id) {
        // ttlBounds exposes the EFFECTIVE session-lifetime ceiling so the
        // console can show/edit values the adapter will actually honor.
        sendJson(res, 200, {
          clients: await listOidcClients(),
          ttlBounds: { min: MIN_SESSION_TTL_SECONDS, max: MAX_SESSION_TTL_SECONDS },
        });
        return;
      }
      if (method === 'POST' && !id) {
        const body = await readJsonBody(req);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const uris = validateRedirectUris(body.redirectUris);
        const postLogoutUris = validateOptionalRedirectUris(body.postLogoutRedirectUris);
        const backchannelLogoutUri = validateBackchannelLogoutUri(body.backchannelLogoutUri);
        if (!name || !uris || postLogoutUris === null || backchannelLogoutUri === undefined) {
          sendJson(res, 400, { error: 'invalid_request', detail: 'name + valid redirectUris required' });
          return;
        }
        const scopeCheck = validateRequestedScope(body.scope);
        if (!scopeCheck.ok) {
          sendJson(res, 400, { error: 'invalid_request', detail: scopeCheck.reason });
          return;
        }
        if (!validateRequestedIdTokenAlg(body.id_token_signed_response_alg)) {
          sendJson(res, 400, {
            error: 'invalid_request',
            detail: 'id_token_signed_response_alg must be RS256',
          });
          return;
        }
        let sessionTtlSeconds: number | undefined;
        if (body.sessionTtlSeconds !== undefined && body.sessionTtlSeconds !== '') {
          const ttl = clampSessionTtlSeconds(Number(body.sessionTtlSeconds));
          if (ttl === null) {
            sendJson(res, 400, {
              error: 'invalid_request',
              detail: `sessionTtlSeconds must be ${MIN_SESSION_TTL_SECONDS}-${MAX_SESSION_TTL_SECONDS}`,
            });
            return;
          }
          sessionTtlSeconds = ttl;
        }
        const created = await createOidcClient(
          {
            name,
            redirectUris: uris,
            postLogoutRedirectUris: postLogoutUris,
            backchannelLogoutUri,
            scope: typeof body.scope === 'string' ? scopeCheck.scope : undefined,
            sessionTtlSeconds,
            createdBy: adminUsername,
          },
          mirror,
          {
            action: 'AUTH_CLIENT_CREATED', actor: adminUsername,
            details: { redirectUris: uris.length, scopes: scopeCheck.scope.split(' ') },
          }
        );
        sendJson(res, 201, {
          client: created.row,
          clientSecret: created.clientSecret,
          mirrorPending: created.mirrorPending,
        });
        return;
      }
      // The bootstrap client backs the provider's own configuration; it can
      // never be rotated, patched, or deleted through the console (same
      // guard as the internal API).
      if ((method === 'PATCH' || method === 'DELETE') && id && id === config.clientId) {
        sendJson(res, 400, { error: 'invalid_request', detail: 'bootstrap client is immutable' });
        return;
      }
      if (id && method === 'PATCH') {
        const body = await readJsonBody(req);
        const scopeCheck =
          body.scope !== undefined ? validateRequestedScope(body.scope) : undefined;
        if (scopeCheck && !scopeCheck.ok) {
          sendJson(res, 400, { error: 'invalid_request', detail: scopeCheck.reason });
          return;
        }
        if (!validateRequestedIdTokenAlg(body.id_token_signed_response_alg)) {
          sendJson(res, 400, {
            error: 'invalid_request',
            detail: 'id_token_signed_response_alg must be RS256',
          });
          return;
        }
        if (body.rotateSecret === true || body.rotateSecret === 'true') {
          const rotated = await rotateOidcClientSecret(id, mirror, {
            action: 'AUTH_CLIENT_SECRET_ROTATED', actor: adminUsername,
          });
          if (!rotated) {
            sendJson(res, 404, { error: 'not_found' });
            return;
          }
          sendJson(res, 200, {
            clientSecret: rotated.clientSecret,
            mirrorPending: rotated.mirrorPending,
          });
          return;
        }
        // null clears the override; a number sets it; junk is rejected.
        let ttlPatch: number | null | undefined;
        if (body.sessionTtlSeconds !== undefined) {
          if (body.sessionTtlSeconds === null || body.sessionTtlSeconds === '') {
            ttlPatch = null;
          } else {
            const clamped = clampSessionTtlSeconds(Number(body.sessionTtlSeconds));
            if (clamped === null) {
              sendJson(res, 400, {
                error: 'invalid_request',
                detail: `sessionTtlSeconds must be ${MIN_SESSION_TTL_SECONDS}-${MAX_SESSION_TTL_SECONDS} or null`,
              });
              return;
            }
            ttlPatch = clamped;
          }
        }
        const postLogoutUris = body.postLogoutRedirectUris === undefined
          ? undefined
          : validateOptionalRedirectUris(body.postLogoutRedirectUris);
        const backchannelLogoutUri = body.backchannelLogoutUri === undefined
          ? undefined
          : validateBackchannelLogoutUri(body.backchannelLogoutUri);
        if (
          postLogoutUris === null ||
          (body.backchannelLogoutUri !== undefined && backchannelLogoutUri === undefined)
        ) {
          sendJson(res, 400, { error: 'invalid_request', detail: 'logout URI metadata is invalid' });
          return;
        }
        let redirectUris: string[] | undefined;
        if (body.redirectUris !== undefined) {
          const parsedRedirectUris = validateRedirectUris(body.redirectUris);
          if (parsedRedirectUris === null) {
            sendJson(res, 400, { error: 'invalid_request', detail: 'redirectUris is invalid' });
            return;
          }
          redirectUris = parsedRedirectUris;
        }
        const updated = await updateOidcClient(
          id,
          {
            ...(body.enabled !== undefined
              ? { enabled: body.enabled === true || body.enabled === 'true' }
              : {}),
            ...(scopeCheck?.ok ? { scope: scopeCheck.scope } : {}),
            ...(ttlPatch !== undefined ? { sessionTtlSeconds: ttlPatch } : {}),
            ...(redirectUris !== undefined ? { redirectUris } : {}),
            ...(postLogoutUris !== undefined ? { postLogoutRedirectUris: postLogoutUris } : {}),
            ...(backchannelLogoutUri !== undefined ? { backchannelLogoutUri } : {}),
          },
          mirror,
          {
            action: 'AUTH_CLIENT_UPDATED', actor: adminUsername,
            details: { fields: Object.keys(body).filter((key) => key !== 'rotateSecret') },
          }
        );
        if (!updated) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        sendJson(res, 200, { client: updated });
        return;
      }
      if (id && method === 'DELETE') {
        const removed = await deleteOidcClient(id, mirror, {
          action: 'AUTH_CLIENT_DELETED', actor: adminUsername,
        });
        if (!removed) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        sendJson(res, 204);
        return;
      }
    }

    // ---- Live sign-in sessions (ADR-0014) ----------------------------------
    if (method === 'GET' && subPath === 'sessions') {
      if (!redis) {
        sendJson(res, 503, { error: 'sessions_unavailable' });
        return;
      }
      const { sessions, aggregates } = await listActiveSessions(redis);
      sendJson(res, 200, { sessions, aggregates });
      return;
    }

    // Revoke exactly ONE admin console session by its tracked identifier.
    const consoleRevokeMatch = /^sessions\/console\/([A-Za-z0-9_-]+)$/.exec(subPath);
    if (consoleRevokeMatch && method === 'DELETE') {
      if (!redis) {
        sendJson(res, 503, { error: 'sessions_unavailable' });
        return;
      }
      const sessionId = consoleRevokeMatch[1];
      await prisma.auditLog.create({
        data: {
          action: 'ADMIN_CONSOLE_SESSION_REVOKE_REQUESTED', category: 'authentication',
          username: adminUsername, actorType: 'admin', eventKind: 'security', outcome: 'requested',
          details: JSON.stringify({ sessionId }), success: true,
        },
      });
      const revoked = await revokeAdminSession(redis, sessionId);
      await prisma.auditLog.create({
          data: {
            action: 'ADMIN_CONSOLE_SESSION_REVOKED',
            category: 'authentication',
            username: adminUsername,
            actorType: 'admin',
            eventKind: 'security',
            outcome: revoked ? 'success' : 'no_match',
            details: JSON.stringify({ sessionId }),
            success: revoked,
          },
        });
      if (!revoked) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      sendJson(res, 200, { revoked: true });
      return;
    }

    const destroyMatch = /^sessions\/destroy$/.exec(subPath);
    if (destroyMatch && method === 'POST') {
      if (!redis) {
        sendJson(res, 503, { error: 'sessions_unavailable' });
        return;
      }
      const body = await readJsonBody(req);
      const scope = typeof body.scope === 'string' ? body.scope : '';
      const target = typeof body.target === 'string' ? body.target.trim() : '';
      const adapter = new RedisAdapter('Session', redis);

      if (scope !== 'sid' && scope !== 'user' && scope !== 'client') {
        sendJson(res, 400, { error: 'invalid_request', detail: 'scope must be sid|user|client' });
        return;
      }

      await prisma.auditLog.create({
        data: {
          action: 'SESSION_FORCE_LOGOUT_REQUESTED', category: 'authentication',
          username: adminUsername, actorType: 'admin', eventKind: 'security', outcome: 'requested',
          details: JSON.stringify({ scope, target }), success: true,
        },
      });

      let outcome: DestroyOutcome;
      if (scope === 'sid') {
        outcome = await destroySessionBySid(redis, adapter, target);
      } else if (scope === 'user') {
        outcome = await destroySessionsForUser(redis, adapter, target);
      } else {
        outcome = await destroySessionsForClient(redis, adapter, target);
      }

      // Always recorded - including partial failures (destroyed>0 with
      // failed>0) and no-match sweeps - per identity-governance invariant:
      // every cross-system mutation records its real result. Back-channel
      // logout outcomes ride on the same row so the console shows reality.
      const deliveries = await emitBackchannelLogouts(redis, config, outcome.authorizations);
      const delivered = deliveries.filter((delivery) => delivery.outcome === 'delivered').length;
      const matched = outcome.destroyed + outcome.failed > 0;
      await prisma.auditLog.create({
          data: {
            action: 'SESSION_FORCE_LOGOUT',
            category: 'authentication',
            username: adminUsername,
            actorType: 'admin',
            eventKind: 'security',
            outcome: !matched ? 'no_match' : outcome.failed > 0 ? 'partial' : 'success',
            details: JSON.stringify({
              scope,
              target,
              destroyed: outcome.destroyed,
              failed: outcome.failed,
              authorizations: outcome.authorizations,
              deliveries,
              backchannelPushes: { delivered, failed: deliveries.length - delivered },
            }),
            success: matched && outcome.failed === 0,
          },
        });

      sendJson(res, 200, {
        scope,
        target,
        destroyed: outcome.destroyed,
        failed: outcome.failed,
        deliveries,
        pushed: { delivered, failed: deliveries.length - delivered },
      });
      return;
    }

    if (method === 'GET' && subPath === 'clients') {
      const clients = await listClients(config.clientId);
      const profiles = await prisma.authBrandingProfile.findMany({
        select: { clientId: true },
        orderBy: { clientId: 'asc' },
      });
      sendJson(res, 200, {
        clients: ['default', ...clients.map((client) => client.clientId)],
        profiles: profiles.map((profile) => profile.clientId),
      });
      return;
    }

    if (method === 'GET' && subPath === 'identity-configuration') {
      let recoveryAccountCount: number | null = null;
      try {
        recoveryAccountCount = await prisma.authAdminLocalAccount.count();
      } catch (error) {
        console.error('[auth] Auth Manager recovery account count unavailable', error);
      }
      sendJson(res, 200, buildIdentityConfiguration(config, { recoveryAccountCount }));
      return;
    }

    if (method === 'GET' && subPath === 'dashboard') {
      if (!redis) {
        sendJson(res, 503, { error: 'dashboard_unavailable' });
        return;
      }
      sendJson(res, 200, {
        layout: await loadDashboardLayout(prisma, adminUsername),
        data: await buildDashboardData(redis),
      });
      return;
    }

    if (subPath === 'dashboard/layout') {
      if (method === 'GET') {
        sendJson(res, 200, { widgets: await loadDashboardLayout(prisma, adminUsername) });
        return;
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const parsed = validateDashboardLayout(body.widgets);
        if (!parsed.ok) {
          sendJson(res, 400, {
            error: 'invalid_request',
            detail: 'widgets must be a unique ordered subset of the widget registry',
          });
          return;
        }
        await saveDashboardLayout(prisma, adminUsername, parsed.widgets);
        sendJson(res, 200, { widgets: parsed.widgets });
        return;
      }
    }

    // ---- Directory users (read-only facade) --------------------------------
    if (method === 'GET' && subPath === 'users') {
      if (!directorySearchConfigured(config)) {
        sendJson(res, 503, {
          error: 'directory_bind_unconfigured',
          detail: 'LDAP_BIND_DN and LDAP_BIND_PASSWORD are required for directory search',
        });
        return;
      }
      const url = new URL(req.url ?? '/admin/api/users', config.issuer);
      const query = (url.searchParams.get('q') ?? '').slice(0, 64);
      const users = await searchDirectoryUsers(config, query);
      if (users === null) {
        sendJson(res, 503, { error: 'directory_unavailable' });
        return;
      }
      sendJson(res, 200, { users, limit: DIRECTORY_SEARCH_LIMIT });
      return;
    }

    const userMatch = /^users\/([A-Za-z0-9._@-]{1,104})$/.exec(subPath);
    if (userMatch && method === 'GET') {
      if (!directorySearchConfigured(config)) {
        sendJson(res, 503, {
          error: 'directory_bind_unconfigured',
          detail: 'LDAP_BIND_DN and LDAP_BIND_PASSWORD are required for directory search',
        });
        return;
      }
      const username = userMatch[1];
      const [user, signIns] = await Promise.all([
        loadDirectoryUser(config, username),
        recentSignInsFor(username).catch(() => []),
      ]);
      if (!user) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      sendJson(res, 200, { user, signIns });
      return;
    }

    if (method === 'GET' && subPath === 'recovery-accounts') {
      sendJson(res, 200, {
        enabled: config.adminLocalRecoveryEnabled,
        accounts: await listRecoveryAccounts(),
        capabilities: {
          manageRoster: principal.authMethod === 'ad',
          rotateOwn: principal.authMethod === 'local_recovery',
          ownAccountId: principal.localAccountId ?? null,
        },
      });
      return;
    }

    if (method === 'POST' && subPath === 'recovery-accounts') {
      if (principal.authMethod !== 'ad') {
        sendJson(res, 403, { error: 'ad_administrator_required' });
        return;
      }
      if (!config.adminLocalRecoveryEnabled) {
        sendJson(res, 409, { error: 'local_recovery_disabled' });
        return;
      }
      const body = await readJsonBody(req);
      const username = normalizeRecoveryUsername(body.username);
      if (!username || !validateRecoveryPassword(body.password)) {
        sendJson(res, 400, {
          error: 'invalid_request',
          detail: 'username must be 3-104 safe characters and password must be 16-256 characters without controls',
        });
        return;
      }
      const account = await createRecoveryAccount({
        username,
        password: body.password,
        actor: adminUsername,
      });
      sendJson(res, 201, { account });
      return;
    }

    const recoveryMatch = /^recovery-accounts\/([A-Za-z0-9_-]{1,64})$/.exec(subPath);
    if (recoveryMatch && method === 'PATCH') {
      const body = await readJsonBody(req);
      const action = body.action;
      const id = recoveryMatch[1];
      if (action === 'rotate_password') {
        if (!validateRecoveryPassword(body.password)) {
          sendJson(res, 400, { error: 'invalid_password' });
          return;
        }
        if (
          principal.authMethod === 'local_recovery'
          && principal.localAccountId !== id
        ) {
          sendJson(res, 403, { error: 'own_password_only' });
          return;
        }
        const account = await rotateRecoveryPassword({
          id,
          password: body.password,
          actor: adminUsername,
        });
        sendJson(res, 200, { account, sessionsInvalidated: true });
        return;
      }
      if (action === 'set_active') {
        if (principal.authMethod !== 'ad') {
          sendJson(res, 403, { error: 'ad_administrator_required' });
          return;
        }
        if (typeof body.active !== 'boolean') {
          sendJson(res, 400, { error: 'invalid_active_state' });
          return;
        }
        if (body.active && !config.adminLocalRecoveryEnabled) {
          sendJson(res, 409, { error: 'local_recovery_disabled' });
          return;
        }
        const account = await setRecoveryAccountActive({
          id,
          active: body.active,
          actor: adminUsername,
        });
        sendJson(res, 200, { account, sessionsInvalidated: true });
        return;
      }
      sendJson(res, 400, { error: 'invalid_action' });
      return;
    }

    if (method === 'GET' && subPath === 'audit') {
      const url = new URL(req.url ?? '/admin/api/audit', config.issuer);
      const limit = Number.parseInt(url.searchParams.get('limit') ?? url.searchParams.get('take') ?? '50', 10);
      const result = await queryAuditEvents(parseAuditFilters(url.searchParams), {
        limit: Number.isFinite(limit) ? limit : 50,
        cursor: url.searchParams.get('cursor') ?? undefined,
      });
      sendJson(res, 200, result);
      return;
    }

    if (method === 'POST' && subPath === 'audit/export') {
      const body = await readJsonBody(req);
      const format = body.format === 'ndjson' ? 'ndjson' : body.format === 'csv' ? 'csv' : null;
      if (!format) {
        sendJson(res, 400, { error: 'invalid_request', detail: 'format must be csv or ndjson' });
        return;
      }
      const filters = parseAuditFilters(
        typeof body.filters === 'object' && body.filters !== null && !Array.isArray(body.filters)
          ? body.filters as Record<string, unknown>
          : {}
      );
      const rows = await exportAuditEvents(filters);
      const payload = format === 'csv' ? auditRowsToCsv(rows) : auditRowsToNdjson(rows);
      await prisma.auditLog.create({
        data: {
          action: 'AUDIT_EXPORTED', category: 'security', username: adminUsername,
          actorType: 'admin', eventKind: 'security', outcome: 'success', success: true,
          details: JSON.stringify({ format, rows: rows.length, filters }),
        },
      });
      res.writeHead(200, {
        'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
        'Content-Disposition': `attachment; filename="cal-poly-soc-idp-audit.${format === 'csv' ? 'csv' : 'ndjson'}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(payload);
      return;
    }

    if (subPath === 'render' && method === 'POST') {
      const body = await readJsonBody(req);
      const parsed = validateBrandingDoc(body.doc);
      if (!parsed.ok) {
        sendJson(res, 400, { error: 'invalid_branding_document', issues: parsed.issues });
        return;
      }
      // The preview is served from a dedicated framed route: srcdoc would
      // inherit this console's frame-ancestors 'none' and render blank.
      const token = createPreviewDraft(
        renderBrandingPage(
          (body.kind === 'change-password' || body.kind === 'error' ? body.kind : 'login') as RenderKind,
          parsed.value,
          {
          uid: 'preview-interaction',
          turnstileSiteKey: config.turnstileSiteKey,
          preview: true,
          errorMessage: body.kind === 'error' ? 'The sign-in link is incomplete or expired.' : undefined,
          }
        )
      );
      sendJson(res, 200, { url: `/admin/preview/${token}` });
      return;
    }

    const profileMatch = /^profile\/([A-Za-z0-9_-]{1,64})$/.exec(subPath);
    const revisionListMatch = /^profile\/([A-Za-z0-9_-]{1,64})\/revisions$/.exec(subPath);
    const revisionRestoreMatch = /^profile\/([A-Za-z0-9_-]{1,64})\/revisions\/(\d+)\/restore$/.exec(subPath);
    if (revisionListMatch && method === 'GET') {
      sendJson(res, 200, { revisions: await listBrandingRevisions(revisionListMatch[1]) });
      return;
    }
    if (revisionRestoreMatch && method === 'POST') {
      const restored = await restoreBrandingRevision(
        revisionRestoreMatch[1], Number.parseInt(revisionRestoreMatch[2], 10), adminUsername
      );
      if (!restored) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      sendJson(res, 200, { restored: true });
      return;
    }
    if (profileMatch) {
      const clientId = decodeURIComponent(profileMatch[1]);
      if (clientId === 'render' || !CLIENT_ID_PATTERN.test(clientId)) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }

      if (method === 'GET') {
        try {
          const row = await prisma.authBrandingProfile.findUnique({
            where: { clientId },
            select: { doc: true },
          });
          if (!row) {
            sendJson(res, 404, { error: 'not_found' });
            return;
          }
          const parsed = validateBrandingDoc(row.doc);
          sendJson(res, 200, parsed.ok ? { doc: parsed.value } : { doc: defaultBrandingDoc(), degraded: true });
        } catch (error) {
          console.error('[auth] admin profile read failed', error);
          sendJson(res, 503, { error: 'storage_unavailable' });
        }
        return;
      }

      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const parsed = validateBrandingDoc(body.doc);
        if (!parsed.ok) {
          sendJson(res, 400, { error: 'invalid_branding_document', issues: parsed.issues });
          return;
        }
        const doc: BrandingDoc = parsed.value;
        await saveBrandingDoc(clientId, doc, adminUsername);
        sendJson(res, 200, { ok: true, clientId });
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  } catch (error) {
    if (error instanceof OidcClientInCatalogError) {
      sendJson(res, 409, { error: 'client_in_application_directory', detail: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : '';
    if (message === 'OIDC application must be enabled before it can be published') {
      sendJson(res, 409, { error: 'oidc_client_disabled', detail: message });
      return;
    }
    if (message.includes('body too large')) {
      sendJson(res, 413, { error: message });
      return;
    }
    if (message.includes('application/json') || message.includes('JSON')) {
      sendJson(res, 400, { error: message });
      return;
    }
    console.error('[auth] admin api failed', error);
    sendJson(res, 500, { error: 'server_error' });
  }
}
