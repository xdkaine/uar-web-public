import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { prisma } from './db';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._@-]{2,103}$/;
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export interface RecoveryCredential {
  id: string;
  username: string;
  passwordHash: string;
  isActive: boolean;
  credentialVersion: number;
}

export function normalizeRecoveryUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const username = value.trim().toLowerCase();
  return USERNAME_PATTERN.test(username) ? username : null;
}

export function validateRecoveryPassword(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 16
    && value.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(value);
}

/** scrypt$16384$8$1$saltB64$keyB64 */
export function hashRecoveryPassword(password: string): string {
  if (!validateRecoveryPassword(password)) throw new Error('invalid_recovery_password');
  const salt = randomBytes(SALT_LENGTH);
  const key = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyRecoveryPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number.parseInt(parts[1] ?? '', 10);
    const r = Number.parseInt(parts[2] ?? '', 10);
    const p = Number.parseInt(parts[3] ?? '', 10);
    if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
    const salt = Buffer.from(parts[4] ?? '', 'base64');
    const expected = Buffer.from(parts[5] ?? '', 'base64');
    if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;
    const actual = scryptSync(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function findRecoveryCredential(username: string): Promise<RecoveryCredential | null> {
  return prisma.authAdminLocalAccount.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      isActive: true,
      credentialVersion: true,
    },
  });
}

export async function recoveryCredentialIsCurrent(input: {
  id: string;
  username: string;
  credentialVersion: number;
}): Promise<boolean> {
  const row = await prisma.authAdminLocalAccount.findUnique({
    where: { id: input.id },
    select: { username: true, isActive: true, credentialVersion: true },
  });
  return row?.isActive === true
    && row.username === input.username
    && row.credentialVersion === input.credentialVersion;
}

export async function recordRecoveryUse(
  id: string,
  credentialVersion: number,
  ip: string | null
): Promise<boolean> {
  const result = await prisma.authAdminLocalAccount.updateMany({
    where: { id, isActive: true, credentialVersion },
    data: { lastUsedAt: new Date(), lastUsedIp: ip },
  });
  return result.count === 1;
}

export async function listRecoveryAccounts() {
  return prisma.authAdminLocalAccount.findMany({
    orderBy: { username: 'asc' },
    select: {
      id: true,
      username: true,
      isActive: true,
      credentialVersion: true,
      createdAt: true,
      updatedAt: true,
      createdBy: true,
      updatedBy: true,
      passwordChangedAt: true,
      lastUsedAt: true,
      lastUsedIp: true,
    },
  });
}

export async function createRecoveryAccount(input: {
  username: string;
  password: string;
  actor: string;
}) {
  const passwordHash = hashRecoveryPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const account = await tx.authAdminLocalAccount.create({
      data: {
        username: input.username,
        passwordHash,
        createdBy: input.actor,
        updatedBy: input.actor,
      },
      select: { id: true, username: true, isActive: true, credentialVersion: true },
    });
    await tx.auditLog.create({ data: recoveryAudit(
      'AUTH_ADMIN_RECOVERY_CREATED', input.actor, account.username
    ) });
    return account;
  });
}

export async function rotateRecoveryPassword(input: {
  id: string;
  password: string;
  actor: string;
}) {
  const passwordHash = hashRecoveryPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const account = await tx.authAdminLocalAccount.update({
      where: { id: input.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        credentialVersion: { increment: 1 },
        updatedBy: input.actor,
      },
      select: { id: true, username: true, isActive: true, credentialVersion: true },
    });
    await tx.auditLog.create({ data: recoveryAudit(
      'AUTH_ADMIN_RECOVERY_PASSWORD_ROTATED', input.actor, account.username
    ) });
    return account;
  });
}

export async function setRecoveryAccountActive(input: {
  id: string;
  active: boolean;
  actor: string;
}) {
  return prisma.$transaction(async (tx) => {
    const account = await tx.authAdminLocalAccount.update({
      where: { id: input.id },
      data: {
        isActive: input.active,
        credentialVersion: { increment: 1 },
        updatedBy: input.actor,
      },
      select: { id: true, username: true, isActive: true, credentialVersion: true },
    });
    await tx.auditLog.create({ data: recoveryAudit(
      input.active ? 'AUTH_ADMIN_RECOVERY_ENABLED' : 'AUTH_ADMIN_RECOVERY_DISABLED',
      input.actor,
      account.username
    ) });
    return account;
  });
}

function recoveryAudit(action: string, actor: string, subject: string) {
  return {
    action,
    category: 'authentication',
    username: actor,
    actorType: 'admin',
    subjectUsername: subject,
    eventKind: 'security',
    outcome: 'success',
    details: JSON.stringify({ surface: 'admin_console', credential_store: 'auth_service' }),
    success: true,
  };
}
