import { describe, expect, it } from 'vitest';

import { isDirectoryTransportError } from './client';

describe('isDirectoryTransportError', () => {
  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'])(
    'accepts the narrow reachability code %s',
    (code) => {
      expect(isDirectoryTransportError(Object.assign(new Error('connect failed'), { code }))).toBe(true);
    }
  );

  it('reads nested fetch/socket causes', () => {
    expect(isDirectoryTransportError(new Error('bind failed', {
      cause: Object.assign(new Error('socket'), { code: 'EHOSTUNREACH' }),
    }))).toBe(true);
  });

  it.each(['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'])(
    'does not downgrade on TLS validation error %s',
    (code) => {
      expect(isDirectoryTransportError(Object.assign(new Error('TLS failed'), { code }))).toBe(false);
    }
  );

  it('does not treat an unclassified LDAP error as transport failure', () => {
    expect(isDirectoryTransportError(new Error('operations error'))).toBe(false);
  });
});
