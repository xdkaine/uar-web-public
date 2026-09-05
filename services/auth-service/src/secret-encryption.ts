import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope encryption for relying-party client secrets at rest.
 * Mirrors the portal's my-app/lib/encryption.ts pattern (versioned envelope,
 * per-record IV, GCM auth tag) but takes the raw 32-byte key directly from a
 * 64-char lowercase hex env var (ASSET_SHARED_SECRET convention).
 *
 * Envelope format: v1:<iv hex>:<authTag hex>:<ciphertext hex>
 * Registry rows predating this module hold bare plaintext and are detected
 * by the envelope shape, then re-encrypted lazily on their next touch.
 */

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 'v1';
export const CLIENT_SECRET_ENC_KEY_ENV = 'AUTH_CLIENT_SECRET_ENC_KEY';

/** Strict envelope shape; ':' never appears in base64url-generated secrets. */
const ENVELOPE_PATTERN = /^v1:[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/;
const KEY_PATTERN = /^[0-9a-f]{64}$/;

export function isEncryptedClientSecret(value: unknown): value is string {
  return typeof value === 'string' && ENVELOPE_PATTERN.test(value);
}

function loadKey(): Buffer | null {
  const raw = process.env[CLIENT_SECRET_ENC_KEY_ENV];
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!KEY_PATTERN.test(trimmed)) return null;
  return Buffer.from(trimmed, 'hex');
}

/** True when a usable encryption key is configured (boot re-encryption gate). */
export function isClientSecretEncryptionConfigured(): boolean {
  return loadKey() !== null;
}

export function encryptClientSecret(plaintext: string): string {
  const key = loadKey();
  if (!key) {
    throw new Error(
      `${CLIENT_SECRET_ENC_KEY_ENV} must be set to exactly 64 lowercase hex characters to store client secrets. Generate with: openssl rand -hex 32`
    );
  }
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    ENVELOPE_VERSION,
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

/** Returns null on wrong/missing key, tampering, or malformed input - never throws. */
export function decryptClientSecret(envelope: string): string | null {
  const key = loadKey();
  if (!key || !isEncryptedClientSecret(envelope)) return null;
  const parts = envelope.split(':');
  const ivHex = parts[1];
  const tagHex = parts[2];
  const ctHex = parts[3];
  if (!ivHex || !tagHex || !ctHex) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
