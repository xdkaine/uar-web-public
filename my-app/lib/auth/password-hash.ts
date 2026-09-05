import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH_BYTES = 64;

export const PASSWORD_HASH_PREFIX = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

interface ParsedHash {
  salt: Buffer;
  expectedKey: Buffer;
}

function parseStoredHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_PREFIX) {
    return null;
  }
  const [, nRaw, rRaw, pRaw, saltB64, keyB64] = parts;
  const n = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return null;
  }
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expectedKey = Buffer.from(keyB64, 'base64');
    if (salt.length < 8 || expectedKey.length < 32) {
      return null;
    }
    return { salt, expectedKey };
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) {
    return false;
  }
  try {
    const derived = await scrypt(password, parsed.salt, KEY_LENGTH_BYTES, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    return derived.length === parsed.expectedKey.length && timingSafeEqual(derived, parsed.expectedKey);
  } catch {
    return false;
  }
}

// Fixed decoy hash used to keep response timing similar when a username has
// no local account, so account existence is not observable from latency.
const DUMMY_HASH_SALT = createHash('sha256')
  .update('uar-local-account-enum-blinding')
  .digest();

export async function dummyVerifyForTiming(): Promise<void> {
  try {
    const derived = await scrypt('timing-blinding', DUMMY_HASH_SALT, KEY_LENGTH_BYTES, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    if (derived.length === 0) {
      throw new Error('unreachable');
    }
  } catch {
    // never propagates; only equalizes work
  }
}
