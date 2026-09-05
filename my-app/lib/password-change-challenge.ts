import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { shouldUseSecureCookies } from './cookie-security';
import { prisma } from './prisma';

export const PASSWORD_CHANGE_CHALLENGE_COOKIE = 'password_change_challenge';
export const PASSWORD_CHANGE_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const PASSWORD_CHANGE_CHALLENGE_MAX_ATTEMPTS = 5;

export type PasswordChangeChallengeReason = 'password_change_required' | 'password_expired';

export interface PasswordChangeChallengeRecord {
  id: string;
  username: string;
  reason: PasswordChangeChallengeReason;
  authProvider: 'ad' | 'ad_manual' | 'ad_outage_fallback';
  correlationId: string | null;
  state: 'active' | 'processing' | 'directory_applied' | 'consumed';
  expiresAt: Date;
  attempts: number;
}

function hashChallengeToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateChallengeToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function toChallengeRecord(record: {
  id: string;
  username: string;
  reason: string;
  authProvider: string;
  correlationId: string | null;
  state: string;
  expiresAt: Date;
  attempts: number;
}): PasswordChangeChallengeRecord {
  return {
    id: record.id,
    username: record.username,
    reason: record.reason === 'password_expired' ? 'password_expired' : 'password_change_required',
    authProvider: record.authProvider === 'ad_outage_fallback'
      ? 'ad_outage_fallback'
      : record.authProvider === 'ad_manual'
        ? 'ad_manual'
        : 'ad',
    correlationId: record.correlationId,
    state: record.state === 'processing'
      ? 'processing'
      : record.state === 'directory_applied'
        ? 'directory_applied'
      : record.state === 'consumed'
        ? 'consumed'
        : 'active',
    expiresAt: record.expiresAt,
    attempts: record.attempts,
  };
}

export async function createPasswordChangeChallenge(input: {
  username: string;
  reason: PasswordChangeChallengeReason;
  authProvider?: 'ad' | 'ad_manual' | 'ad_outage_fallback';
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ token: string; expiresAt: Date; challenge: PasswordChangeChallengeRecord }> {
  const token = generateChallengeToken();
  const tokenHash = hashChallengeToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSWORD_CHANGE_CHALLENGE_TTL_MS);

  await prisma.passwordChangeChallenge.updateMany({
    where: {
      username: input.username,
      used: false,
      expiresAt: { gt: now },
    },
    data: {
      used: true,
      usedAt: now,
      state: 'consumed',
    },
  });

  const challenge = await prisma.passwordChangeChallenge.create({
    data: {
      username: input.username,
      tokenHash,
      reason: input.reason,
      authProvider: input.authProvider ?? 'ad',
      correlationId: input.correlationId,
      expiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });

  return {
    token,
    expiresAt,
    challenge: toChallengeRecord(challenge),
  };
}

export function attachPasswordChangeChallengeCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date
) {
  response.cookies.set(PASSWORD_CHANGE_CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: 'strict',
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
    path: '/',
  });
}

export function clearPasswordChangeChallengeCookie(response: NextResponse) {
  response.cookies.set(PASSWORD_CHANGE_CHALLENGE_COOKIE, '', {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
}

export async function getValidPasswordChangeChallenge(
  request: NextRequest
): Promise<PasswordChangeChallengeRecord | null> {
  const token = request.cookies.get(PASSWORD_CHANGE_CHALLENGE_COOKIE)?.value;
  if (!token) {
    return null;
  }

  const tokenHash = hashChallengeToken(token);
  const challenge = await prisma.passwordChangeChallenge.findUnique({
    where: { tokenHash },
  });

  if (!challenge || challenge.used || challenge.state !== 'active' || challenge.expiresAt <= new Date()) {
    return null;
  }

  if (challenge.attempts >= PASSWORD_CHANGE_CHALLENGE_MAX_ATTEMPTS) {
    return null;
  }

  return toChallengeRecord(challenge);
}

/** Atomically claim a still-valid challenge before the first AD mutation. */
export async function claimPasswordChangeChallenge(challengeId: string): Promise<boolean> {
  const now = new Date();
  const claimed = await prisma.passwordChangeChallenge.updateMany({
    where: {
      id: challengeId,
      state: 'active',
      used: false,
      expiresAt: { gt: now },
      attempts: { lt: PASSWORD_CHANGE_CHALLENGE_MAX_ATTEMPTS },
    },
    data: {
      state: 'processing',
      claimedAt: now,
    },
  });
  return claimed.count === 1;
}

/** Persist recovery evidence immediately after Active Directory changed. */
export async function markPasswordChangeChallengeDirectoryApplied(
  challengeId: string
): Promise<void> {
  const applied = await prisma.passwordChangeChallenge.updateMany({
    where: { id: challengeId, state: 'processing', used: false },
    data: {
      state: 'directory_applied',
      used: true,
      usedAt: new Date(),
    },
  });
  if (applied.count !== 1) {
    throw new Error('Password change challenge could not record the directory mutation');
  }
}

export async function incrementPasswordChangeChallengeAttempts(
  challengeId: string
): Promise<{ attempts: number; exhausted: boolean }> {
  const challenge = await prisma.passwordChangeChallenge.update({
    where: { id: challengeId },
    data: { attempts: { increment: 1 } },
  });

  const exhausted = challenge.attempts >= PASSWORD_CHANGE_CHALLENGE_MAX_ATTEMPTS;
  if (exhausted) {
    await prisma.passwordChangeChallenge.update({
      where: { id: challengeId },
      data: {
        used: true,
        usedAt: new Date(),
        state: 'consumed',
      },
    });
  }

  return {
    attempts: challenge.attempts,
    exhausted,
  };
}

export async function consumePasswordChangeChallenge(challengeId: string): Promise<void> {
  await prisma.passwordChangeChallenge.update({
    where: { id: challengeId },
    data: {
      used: true,
      usedAt: new Date(),
      state: 'consumed',
    },
  });
}
