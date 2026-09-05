import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AUTH_JWKS generator', () => {
  it('writes one usable 3072-bit RSA private JWK Set to stdout', () => {
    const output = execFileSync(process.execPath, [resolve('scripts/generate-jwks.mjs')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output) as { keys?: Array<Record<string, unknown>> };
    expect(parsed.keys).toHaveLength(1);
    expect(parsed.keys?.[0]).toMatchObject({
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
    });
    expect(parsed.keys?.[0]?.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parsed.keys?.[0]?.d).toBeTypeOf('string');
    expect(parsed.keys?.[0]?.n).toBeTypeOf('string');
  });
});
