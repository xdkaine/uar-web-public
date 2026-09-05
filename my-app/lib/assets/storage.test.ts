import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  detectAttachmentContentType,
  getAssetBytes,
  putAssetBytes,
  sha256Hex,
} from './storage';

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const PDF_MAGIC = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const WEBP_MAGIC = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe('detectAttachmentContentType', () => {
  it('recognizes allowed magic bytes and rejects everything else', () => {
    expect(detectAttachmentContentType(PNG_MAGIC)).toBe('image/png');
    expect(detectAttachmentContentType(JPEG_MAGIC)).toBe('image/jpeg');
    expect(detectAttachmentContentType(WEBP_MAGIC)).toBe('image/webp');
    expect(detectAttachmentContentType(PDF_MAGIC)).toBe('application/pdf');
    expect(detectAttachmentContentType(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
  });
});

describe('local asset driver', () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      delete process.env.ASSET_STORAGE_DIR;
      delete process.env.ASSET_SERVICE_URL;
    }
  });

  it('writes and reads bytes inside the configured directory', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'uar-assets-'));
    process.env.ASSET_STORAGE_DIR = tempDir;
    delete process.env.ASSET_SERVICE_URL;

    const key = 'abc123.png';
    const bytes = PNG_MAGIC;
    const put = await putAssetBytes(key, bytes);
    expect(put.location).toBe('local');

    const stored = await readFile(path.join(tempDir, key));
    expect(stored.byteLength).toBe(bytes.byteLength);
    expect(await getAssetBytes(key)).toEqual(bytes);
  });

  it('rejects storage keys that do not match the safe pattern', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'uar-assets-'));
    process.env.ASSET_STORAGE_DIR = tempDir;
    await expect(getAssetBytes('../escape.png')).rejects.toThrow(/Invalid storage key/);
    await expect(getAssetBytes('no-extension')).rejects.toThrow(/Invalid storage key/);
  });

  it('requires a shared secret when a remote asset service is configured', async () => {
    process.env.ASSET_SERVICE_URL = 'http://asset-store:8090';
    delete process.env.ASSET_SHARED_SECRET;
    await expect(putAssetBytes('k.png', PNG_MAGIC)).rejects.toThrow(/ASSET_SHARED_SECRET/);
  });
});

describe('sha256Hex', () => {
  it('matches the known digest for fixed input', () => {
    const empty = new Uint8Array(0);
    expect(sha256Hex(empty)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
