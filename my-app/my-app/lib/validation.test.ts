import { describe, expect, it, vi } from 'vitest';
import {
  INTERNAL_EMAIL_DOMAIN,
  extractBronconame,
  isJsonBodyError,
  parseJsonWithLimit,
  sanitizeString,
  validateEmail,
  validateRequiredFields,
  validateStringLength,
  validateUsername,
} from './validation';

type JsonRequest = Parameters<typeof parseJsonWithLimit>[0];

function internalEmail(localPart: string): string {
  return `${localPart}${INTERNAL_EMAIL_DOMAIN}`;
}

function jsonRequest(body: unknown, contentLength?: string): { request: JsonRequest; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn().mockResolvedValue(body);
  const request = {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength ?? null : null),
    },
    json,
  } as unknown as JsonRequest;

  return { request, json };
}

describe('parseJsonWithLimit', () => {
  it('returns parsed JSON when the declared and actual sizes fit', async () => {
    const { request } = jsonRequest({ name: 'Ada' }, '14');

    await expect(parseJsonWithLimit(request, 100)).resolves.toEqual({ name: 'Ada' });
  });

  it('rejects oversized content-length before reading the body', async () => {
    const { request, json } = jsonRequest({ name: 'Ada' }, '101');

    await expect(parseJsonWithLimit(request, 100)).rejects.toMatchObject({
      name: 'JsonBodyError',
      statusCode: 413,
    });
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects bodies whose actual serialized size exceeds the limit', async () => {
    const { request } = jsonRequest({ payload: 'x'.repeat(25) });

    await expect(parseJsonWithLimit(request, 20)).rejects.toMatchObject({
      name: 'JsonBodyError',
      statusCode: 413,
    });
  });

  it('maps JSON syntax errors to JsonBodyError with status 400', async () => {
    const request = {
      headers: { get: () => null },
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    } as unknown as JsonRequest;

    try {
      await parseJsonWithLimit(request, 100);
      throw new Error('Expected parseJsonWithLimit to throw');
    } catch (error) {
      expect(isJsonBodyError(error)).toBe(true);
      expect(error).toMatchObject({ statusCode: 400, message: 'Invalid JSON in request body' });
    }
  });
});

describe('validation helpers', () => {
  it('validates string length boundaries', () => {
    expect(validateStringLength('abc', 'Name', 3)).toEqual({ valid: true });
    expect(validateStringLength('ab', 'Name', 10, 3)).toEqual({
      valid: false,
      error: 'Name must be at least 3 characters',
    });
    expect(validateStringLength('abcd', 'Name', 3)).toEqual({
      valid: false,
      error: 'Name must not exceed 3 characters',
    });
    expect(validateStringLength(42 as unknown as string, 'Name', 3)).toEqual({
      valid: false,
      error: 'Name must be a string',
    });
  });

  it('validates email and username formats', () => {
    expect(validateEmail('fixture.user@example.test')).toBe(true);
    expect(validateEmail('missing-at')).toBe(false);
    expect(validateUsername('fixture.name_1')).toBe(true);
    expect(validateUsername('no spaces')).toBe(false);
  });

  it('sanitizes control characters and trims strings', () => {
    expect(sanitizeString('  hello\0\x07 world  ', 20)).toBe('hello world');
    expect(sanitizeString('abcdef', 3)).toBe('abc');
  });

  it('reports missing required fields', () => {
    expect(validateRequiredFields({ name: 'Ada', email: '', reason: null }, ['name', 'email', 'reason'])).toEqual([
      'email',
      'reason',
    ]);
  });

  it('extracts bronconame only from the internal email domain', () => {
    expect(extractBronconame(internalEmail('Fixture.User'))).toBe('fixture.user');
    expect(extractBronconame('fixture.user@example.test')).toBeNull();
    expect(extractBronconame(internalEmail(''))).toBeNull();
  });
});