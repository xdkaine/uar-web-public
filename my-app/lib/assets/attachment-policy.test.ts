import { describe, expect, it } from 'vitest';

import { classifyAttachment } from './attachment-policy';

describe('attachment policy', () => {
  it('accepts common source code as forced-download text', () => {
    const result = classifyAttachment(
      'health-check.ts',
      'application/octet-stream',
      new TextEncoder().encode('export const healthy = true;'),
    );

    expect(result).toMatchObject({ ok: true, contentType: 'text/plain', extension: 'ts', forceDownload: true });
  });

  it('accepts macro-free Office documents but rejects macro-enabled variants', () => {
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

    expect(classifyAttachment('report.docx', '', zip)).toMatchObject({
      ok: true,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(classifyAttachment('report.docm', '', zip)).toMatchObject({ ok: false });
  });

  it('rejects executables and encrypted zip archives', () => {
    expect(classifyAttachment('tool.exe', '', Uint8Array.from([0x4d, 0x5a, 1, 2]))).toMatchObject({ ok: false });
    const encryptedZip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0x01, 0]);
    expect(classifyAttachment('archive.zip', '', encryptedZip)).toMatchObject({ ok: false });
  });
});
