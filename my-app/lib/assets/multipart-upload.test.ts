import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  cleanupStagedUpload,
  MultipartUploadError,
  stageMultipartUpload,
} from './multipart-upload';

function multipartRequest(files: File[]): Request {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  return new Request('https://portal.example.test/upload', { method: 'POST', body: form });
}

describe('streaming multipart staging', () => {
  it('streams files into a private temporary directory and reports exact sizes', async () => {
    const staged = await stageMultipartUpload(
      multipartRequest([
        new File(['alpha'], 'first.txt', { type: 'text/plain' }),
        new File(['bravo'], 'second.txt', { type: 'text/plain' }),
      ]),
      { maxFiles: 5, maxFileBytes: 1024, maxRequestBytes: 4096 }
    );

    try {
      expect(staged.files.map(({ filename, sizeBytes }) => ({ filename, sizeBytes }))).toEqual([
        { filename: 'first.txt', sizeBytes: 5 },
        { filename: 'second.txt', sizeBytes: 5 },
      ]);
      await expect(fs.readFile(staged.files[0]!.path, 'utf8')).resolves.toBe('alpha');
    } finally {
      await cleanupStagedUpload(staged);
    }
    await expect(fs.access(staged.directory)).rejects.toThrow();
  });

  it('rejects a file at the streaming byte limit without leaving temp files', async () => {
    await expect(
      stageMultipartUpload(
        multipartRequest([new File(['12345'], 'too-big.txt', { type: 'text/plain' })]),
        { maxFiles: 1, maxFileBytes: 4, maxRequestBytes: 4096 }
      )
    ).rejects.toMatchObject({ statusCode: 413 } satisfies Partial<MultipartUploadError>);
  });
});
