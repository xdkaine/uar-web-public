import { describe, expect, it, vi } from 'vitest';
import { parseAdminJson } from './admin-json-parser';

type AdminJsonRequest = Parameters<typeof parseAdminJson>[0];

function requestWithBody(body: unknown): AdminJsonRequest {
  return {
    headers: { get: () => null },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as AdminJsonRequest;
}

describe('parseAdminJson', () => {
  it('uses the small admin body limit by default', async () => {
    await expect(parseAdminJson(requestWithBody({ payload: 'x'.repeat(11 * 1024) }))).rejects.toMatchObject({
      statusCode: 413,
    });
  });

  it('allows callers to override the body limit', async () => {
    await expect(parseAdminJson(requestWithBody({ payload: 'x'.repeat(11 * 1024) }), 20 * 1024)).resolves.toEqual({
      payload: 'x'.repeat(11 * 1024),
    });
  });
});