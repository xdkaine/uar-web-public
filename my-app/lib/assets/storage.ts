import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const ALLOWED_ATTACHMENT_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedAttachmentContentType = (typeof ALLOWED_ATTACHMENT_CONTENT_TYPES)[number];

const EXTENSION_BY_CONTENT_TYPE: Record<AllowedAttachmentContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function isAllowedAttachmentContentType(
  value: string
): value is AllowedAttachmentContentType {
  return (ALLOWED_ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(value);
}

export function extensionForContentType(contentType: AllowedAttachmentContentType): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType];
}

export function detectAttachmentContentType(bytes: Uint8Array): AllowedAttachmentContentType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  const pdfMagic = [0x25, 0x50, 0x44, 0x46];
  if (bytes.length >= 4 && pdfMagic.every((byte, index) => bytes[index] === byte)) {
    return 'application/pdf';
  }
  return null;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function assetServiceUrl(): string | null {
  const raw = process.env.ASSET_SERVICE_URL?.trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

function assetSharedSecret(): string | null {
  const raw = process.env.ASSET_SHARED_SECRET?.trim();
  return raw || null;
}

function localAssetDir(): string {
  return process.env.ASSET_STORAGE_DIR?.trim() || path.join(process.cwd(), 'asset-store');
}

function assertStorageKey(storageKey: string): void {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(storageKey)) {
    throw new Error('Invalid storage key');
  }
}

export async function putAssetBytes(
  storageKey: string,
  bytes: Uint8Array
): Promise<{ location: 'remote' | 'local' }> {
  const remoteBase = assetServiceUrl();
  if (remoteBase) {
    const secret = assetSharedSecret();
    if (!secret) {
      throw new Error('ASSET_SHARED_SECRET is required when ASSET_SERVICE_URL is configured');
    }
    const response = await fetch(`${remoteBase}/ingest/${encodeURIComponent(storageKey)}`, {
      method: 'PUT',
      headers: {
        'x-asset-token': secret,
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.byteLength),
      },
      body: bytes as unknown as BodyInit,
    });
    if (!response.ok) {
      throw new Error(`Asset store rejected upload (status ${response.status})`);
    }
    return { location: 'remote' };
  }

  const dir = localAssetDir();
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, storageKey);
  if (!target.startsWith(dir)) {
    throw new Error('Resolved asset path escaped the storage directory');
  }
  await fs.writeFile(target, bytes, { mode: 0o600 });
  return { location: 'local' };
}

export async function getAssetBytes(storageKey: string): Promise<Uint8Array> {
  assertStorageKey(storageKey);

  const remoteBase = assetServiceUrl();
  if (remoteBase) {
    const secret = assetSharedSecret();
    if (!secret) {
      throw new Error('ASSET_SHARED_SECRET is required when ASSET_SERVICE_URL is configured');
    }
    const response = await fetch(
      `${remoteBase}/assets/${encodeURIComponent(storageKey)}`,
      { headers: { 'x-asset-token': secret } }
    );
    if (!response.ok) {
      throw new Error(`Asset store read failed (status ${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  const dir = localAssetDir();
  const target = path.join(dir, storageKey);
  if (!target.startsWith(dir)) {
    throw new Error('Resolved asset path escaped the storage directory');
  }
  const buffer = await fs.readFile(target);
  return new Uint8Array(buffer);
}

export async function deleteAssetBytes(storageKey: string): Promise<void> {
  assertStorageKey(storageKey);
  const remoteBase = assetServiceUrl();
  if (remoteBase) {
    const secret = assetSharedSecret();
    if (!secret) throw new Error('ASSET_SHARED_SECRET is required when ASSET_SERVICE_URL is configured');
    const response = await fetch(`${remoteBase}/ingest/${encodeURIComponent(storageKey)}`, {
      method: 'DELETE',
      headers: { 'x-asset-token': secret },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Asset store delete failed (status ${response.status})`);
    }
    return;
  }

  const dir = localAssetDir();
  const target = path.join(dir, storageKey);
  if (!target.startsWith(dir)) throw new Error('Resolved asset path escaped the storage directory');
  await fs.rm(target, { force: true });
}
