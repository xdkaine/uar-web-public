import { describe, expect, it } from 'vitest';
import { hashAccessRequestVerificationToken } from './access-request-verification';

describe('hashAccessRequestVerificationToken', () => {
  it('produces a deterministic one-way token fingerprint', () => {
    const hash = hashAccessRequestVerificationToken('verification-token');

    expect(hash).toBe('46f6e828be35b9e2482ea7fc7a6a8f43f95a131098470486be3d137d408c8811');
    expect(hash).not.toContain('verification-token');
  });
});
