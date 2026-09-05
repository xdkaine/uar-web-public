import crypto from 'crypto';
import { localCredentialVersion, LocalCredentialChangedError } from '@/lib/auth/local-credential-version';
import { isLocalBreakGlassSessionProvider } from '@/lib/auth/session-provider';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';
import {
  clearSessionCookiesOnResponse,
  getSessionMaxIdleSeconds,
  getSessionMaxAgeSeconds,
  SESSION_COOKIE_NAME,
  setSessionCookieOnResponse,
} from './session-cookie-policy';

type PrismaTransactionClient = Omit<
  typeof prisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface SessionInfo {
  id: string;
  username: string;
  isAdmin: boolean;
  expiresAt: Date;
  lastActivity: Date;
  authProvider: string;
}

function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function calculateExpiryDate(
  isAdmin: boolean = false,
  authProvider: string = 'ad',
  providerSessionExpiresAt?: Date,
): Date {
  const portalExpiry = new Date(Date.now() + getSessionMaxAgeSeconds(isAdmin, authProvider) * 1000);
  if (authProvider !== 'oidc' || !providerSessionExpiresAt) return portalExpiry;
  return providerSessionExpiresAt < portalExpiry ? providerSessionExpiresAt : portalExpiry;
}

async function loadSessionByToken(
  token: string | undefined | null
): Promise<SessionInfo | null> {
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const record = await prisma.session.findUnique({
    where: { tokenHash },
  });

  if (!record) {
    return null;
  }

  const now = new Date();

  if (record.revokedAt || record.expiresAt <= now) {
    await prisma.session
      .delete({
        where: { id: record.id },
      })
      .catch(() => {});
    return null;
  }

  const idleTimeMs = now.getTime() - record.lastActivity.getTime();
  const maxIdleMs = getSessionMaxIdleSeconds(record.authProvider) * 1000;
  
  if (idleTimeMs > maxIdleMs) {
    await prisma.session
      .delete({
        where: { id: record.id },
      })
      .catch(() => {});
    return null;
  }

  await prisma.session
    .update({
      where: { id: record.id },
      data: { lastActivity: now },
    })
    .catch(() => {});

  return {
    id: record.id,
    username: record.username,
    isAdmin: record.isAdmin,
    expiresAt: record.expiresAt,
    lastActivity: now,
    authProvider: record.authProvider,
  };
}

function attachSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date
) {
  setSessionCookieOnResponse(response, token, expiresAt);
}

function clearSessionCookie(response: NextResponse) {
  clearSessionCookiesOnResponse(response);
}

export async function createUserSession(
  username: string,
  isAdmin: boolean,
  ipAddress?: string,
  userAgent?: string,
  authProvider: string = 'ad',
  providerSid?: string,
  verifiedLocalCredentialVersion?: string,
  localCredentialSource: 'direct' | 'oidc_verified' = 'direct',
  providerSessionExpiresAt?: Date,
): Promise<{ token: string; session: SessionInfo }> {
  const token = generateSessionToken();
  const now = new Date();
  const expiresAt = calculateExpiryDate(isAdmin, authProvider, providerSessionExpiresAt);
  const sessionLockIdentity = username.trim().toLowerCase();

  const record = await prisma.$transaction(async (tx: PrismaTransactionClient) => {
    // Serialize login and revoke-all for one identity. Without the shared lock,
    // a login can commit immediately after revoke-all snapshots its rows and
    // survive an operation reported as complete.
    await tx.$queryRaw<Array<{ lock_acquired: string }>>`
      SELECT 'locked'::text AS lock_acquired
      FROM pg_advisory_xact_lock(hashtextextended(${sessionLockIdentity}, 771921))
    `;
    if (isLocalBreakGlassSessionProvider(authProvider) && localCredentialSource === 'direct') {
      // Serialize against password rotation/disablement's LocalAccount UPDATE.
      // If rotation won, the version differs; if mint wins, the later rotation
      // revokes this session after the row lock is released at commit.
      const accounts = await tx.$queryRaw<Array<{
        passwordHash: string; isActive: boolean; purpose: string;
      }>>`
        SELECT "passwordHash", "isActive", "purpose" FROM "LocalAccount"
        WHERE "username" = ${sessionLockIdentity} FOR UPDATE
      `;
      const account = accounts[0];
      if (!verifiedLocalCredentialVersion || !account || !account.isActive
        || account.purpose !== 'break_glass'
        || localCredentialVersion(account.passwordHash) !== verifiedLocalCredentialVersion) {
        throw new LocalCredentialChangedError();
      }
    }
    const governedOwners = await tx.accessRequest.findMany({
      where: {
        status: { in: ['approved', 'offboarded'] },
        OR: [
          { ldapUsername: { equals: username, mode: 'insensitive' } },
          { linkedAdUsername: { equals: username, mode: 'insensitive' } },
        ],
      },
      select: { id: true, status: true, adAccountStatus: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
    const batchOwners = await tx.batchAccountItem.findMany({
      where: {
        lifecycleOwnerKind: 'batch_item',
        accessRequestId: null,
        accountType: { in: ['AD', 'BOTH'] },
        status: 'completed',
        ldapUsername: { equals: username, mode: 'insensitive' },
      },
      select: { id: true, adAccountStatus: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
    });
    const approvedOwners = governedOwners.filter((owner) => owner.status === 'approved');
    if (approvedOwners.length > 1) {
      throw new Error('Portal session creation is blocked because more than one approved request owns this directory username.');
    }
    const governingOwner = approvedOwners[0] ?? governedOwners[0];
    if (batchOwners.length > 1 || (governingOwner && batchOwners.length > 0)) {
      throw new Error('Portal session creation is blocked because lifecycle ownership for this directory username is ambiguous.');
    }
    if (
      governingOwner
      && (governingOwner.status === 'offboarded' || ['disabled', 'deleted'].includes(governingOwner.adAccountStatus ?? ''))
    ) {
      throw new Error('Portal session creation is blocked because this governed directory account is disabled or deleted.');
    }
    if (batchOwners[0] && ['disabled', 'deleted'].includes(batchOwners[0].adAccountStatus ?? '')) {
      throw new Error('Portal session creation is blocked because this batch-governed directory account is disabled or deleted.');
    }
    const replacedSessions = await tx.session.findMany({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { providerSid: true },
    });
    const replacedProviderSids = [...new Set(
      replacedSessions
        .map((session) => session.providerSid)
        .filter((providerSid): providerSid is string => Boolean(providerSid))
    )];
    if (replacedProviderSids.length > 0) {
      await tx.providerLogoutTask.createMany({
        data: replacedProviderSids.map((replacedProviderSid) => ({
          username,
          providerSid: replacedProviderSid,
          providerSidHash: crypto.createHash('sha256').update(replacedProviderSid).digest('hex'),
          reason: 'session_replaced_by_login',
        })),
        skipDuplicates: true,
      });
    }
    await tx.session.deleteMany({
      where: { username: { equals: username, mode: 'insensitive' } },
    });

    return await tx.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        username,
        isAdmin,
        expiresAt,
        lastActivity: now,
        ipAddress,
        userAgent,
        authProvider,
        providerSid,
      },
    });
  });

  return {
    token,
    session: {
      id: record.id,
      username: record.username,
      isAdmin: record.isAdmin,
      expiresAt: record.expiresAt,
      lastActivity: record.lastActivity,
      authProvider: record.authProvider,
    },
  };
}

export async function establishSessionOnResponse(
  response: NextResponse,
  username: string,
  isAdmin: boolean,
  ipAddress?: string,
  userAgent?: string,
  authProvider: string = 'ad',
  providerSid?: string,
  verifiedLocalCredentialVersion?: string,
  localCredentialSource: 'direct' | 'oidc_verified' = 'direct',
  providerSessionExpiresAt?: Date,
): Promise<SessionInfo> {
  const { token, session } = await createUserSession(
    username,
    isAdmin,
    ipAddress,
    userAgent,
    authProvider,
    providerSid,
    verifiedLocalCredentialVersion,
    localCredentialSource,
    providerSessionExpiresAt,
  );
  attachSessionCookie(response, token, session.expiresAt);
  return session;
}

export async function getSessionFromRequest(
  request: NextRequest
): Promise<SessionInfo | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return loadSessionByToken(token);
}

export async function getSessionFromCookies(): Promise<SessionInfo | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return loadSessionByToken(token);
}

export async function revokeSessionByToken(
  token: string | undefined | null,
  reason: string = 'session_revocation'
): Promise<{ providerSid: string | null; providerLogoutTaskId: string | null } | null> {
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  return prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({ where: { tokenHash } });
    if (!session) return null;
    let providerLogoutTaskId: string | null = null;
    if (session.providerSid) {
      const providerSidHash = crypto.createHash('sha256').update(session.providerSid).digest('hex');
      await tx.providerLogoutTask.createMany({
        data: [{
          username: session.username,
          providerSid: session.providerSid,
          providerSidHash,
          reason,
        }],
        skipDuplicates: true,
      });
      providerLogoutTaskId = (await tx.providerLogoutTask.findUnique({
        where: { providerSidHash },
        select: { id: true },
      }))?.id ?? null;
    }
    await tx.session.delete({ where: { id: session.id } });
    return { providerSid: session.providerSid ?? null, providerLogoutTaskId };
  });
}

export async function revokeSessionById(
  sessionId: string,
  reason: string = 'session_revocation'
): Promise<{ providerSid: string | null; providerLogoutTaskId: string | null } | null> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.session.findUnique({ where: { id: sessionId } });
    if (!session) return null;
    let providerLogoutTaskId: string | null = null;
    if (session.providerSid) {
      const providerSidHash = crypto.createHash('sha256').update(session.providerSid).digest('hex');
      await tx.providerLogoutTask.createMany({
        data: [{
          username: session.username,
          providerSid: session.providerSid,
          providerSidHash,
          reason,
        }],
        skipDuplicates: true,
      });
      providerLogoutTaskId = (await tx.providerLogoutTask.findUnique({
        where: { providerSidHash },
        select: { id: true },
      }))?.id ?? null;
    }
    await tx.session.delete({ where: { id: session.id } });
    return { providerSid: session.providerSid ?? null, providerLogoutTaskId };
  });
}

export interface ProviderSidRevocation {
  sessionId: string;
  username: string;
}

export interface RevokedUserSession {
  id: string;
  username: string;
  providerSid: string | null;
}

/**
 * Deletes EVERY portal session row for a user and returns the deleted rows
 * so callers can fire IdP back-channel logouts per distinct providerSid.
 * Callers should prefer revokeUserSessionsEverywhere (provider-logout-audit)
 * which layers the backchannel + audit on top of this primitive.
 */
export async function revokeAllSessionsForUser(
  username: string,
  reason: string = 'bulk_session_revocation'
): Promise<RevokedUserSession[]> {
  if (!username) return [];
  const sessionLockIdentity = username.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ lock_acquired: string }>>`
      SELECT 'locked'::text AS lock_acquired
      FROM pg_advisory_xact_lock(hashtextextended(${sessionLockIdentity}, 771921))
    `;
    const records = await tx.session.findMany({
      where: { username },
      select: { id: true, username: true, providerSid: true },
    });
    if (records.length === 0) return [];

    const providerSids = [...new Set(records.map((record) => record.providerSid).filter((sid): sid is string => Boolean(sid)))];
    if (providerSids.length > 0) {
      await tx.providerLogoutTask.createMany({
        data: providerSids.map((providerSid) => ({
          username,
          providerSid,
          providerSidHash: crypto.createHash('sha256').update(providerSid).digest('hex'),
          reason,
        })),
        skipDuplicates: true,
      });
    }
    await tx.session.deleteMany({
      where: { id: { in: records.map((record) => record.id) } },
    });
    return records.map((record) => ({
      id: record.id,
      username: record.username,
      providerSid: record.providerSid ?? null,
    }));
  });
}

/**
 * Receiver side of IdP-initiated OIDC Back-Channel Logout (issue #36):
 * destroys every portal session linked to the provider session uid carried
 * in a validated logout_token. Returns the destroyed rows (empty when no
 * live session matched - an expected, tolerated outcome per spec).
 */
export async function revokeSessionsByProviderSid(
  providerSid: string
): Promise<ProviderSidRevocation[]> {
  const records = await prisma.session.findMany({
    where: { providerSid },
    select: { id: true, username: true },
  });

  if (records.length === 0) {
    return [];
  }

  await prisma.session
    .deleteMany({
      where: { id: { in: records.map((record) => record.id) } },
    })
    .catch(() => {
      /* already removed */
      return [];
    });

  return records.map((record) => ({
    sessionId: record.id,
    username: record.username,
  }));
}

export function clearSession(response: NextResponse) {
  clearSessionCookie(response);
}

export function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date
) {
  attachSessionCookie(response, token, expiresAt);
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}
