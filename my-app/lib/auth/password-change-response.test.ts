import { describe, expect, it } from 'vitest';

import { classifyPasswordChangeResponse } from './password-change-response';

describe('classifyPasswordChangeResponse', () => {
  it('honors a non-2xx applied-password recovery response before generic errors', () => {
    expect(classifyPasswordChangeResponse(false, 500, {
      message: 'Password updated. Please sign in again with your new password.',
      requiresLogin: true,
    })).toEqual({
      kind: 'requires_login',
      message: 'Password updated. Please sign in again with your new password.',
    });
  });

  it('preserves central-sign-in recovery when no password mutation occurred', () => {
    expect(classifyPasswordChangeResponse(false, 409, {
      action: 'OIDC_REQUIRED',
    })).toEqual({ kind: 'oidc_required' });
  });
});
