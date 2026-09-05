import { describe, expect, it } from 'vitest';
import { isLocalBreakGlassSessionProvider } from './session-provider';

describe('isLocalBreakGlassSessionProvider', () => {
  it.each(['local', 'local_manual'])('recognizes %s as local break-glass provenance', (provider) => {
    expect(isLocalBreakGlassSessionProvider(provider)).toBe(true);
  });

  it.each(['ad', 'ad_manual', 'ad_outage_fallback', 'oidc', null, undefined])(
    'does not classify %s as local break-glass provenance',
    (provider) => {
      expect(isLocalBreakGlassSessionProvider(provider)).toBe(false);
    }
  );
});
