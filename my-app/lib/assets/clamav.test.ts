import { describe, expect, it } from 'vitest';

import { parseClamdResponse } from './clamav';

describe('ClamAV response parsing', () => {
  it('distinguishes clean, infected, and scanner errors', () => {
    expect(parseClamdResponse('stream: OK\0')).toEqual({ status: 'clean' });
    expect(parseClamdResponse('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      status: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    });
    expect(() => parseClamdResponse('stream: size limit exceeded. ERROR\0')).toThrow(/size limit/i);
  });
});
