import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPreviewDraft,
  consumePreviewDraft,
  resetPreviewDrafts,
} from './admin-preview';
import {
  DEFAULT_DASHBOARD_LAYOUT,
  DASHBOARD_WIDGET_KEYS,
  validateDashboardLayout,
} from './admin-dashboard';
import { escapeLdapFilter } from './admin-users';

describe('preview draft store', () => {
  beforeEach(() => resetPreviewDrafts());
  afterEach(() => resetPreviewDrafts());

  it('round-trips a draft by token', () => {
    const token = createPreviewDraft('<html>preview</html>');
    expect(consumePreviewDraft(token)).toBe('<html>preview</html>');
  });

  it('rejects malformed tokens without throwing', () => {
    expect(consumePreviewDraft('')).toBeNull();
    expect(consumePreviewDraft('../etc/passwd')).toBeNull();
    expect(consumePreviewDraft('a'.repeat(200))).toBeNull();
    expect(consumePreviewDraft('missing-token-value')).toBeNull();
  });

  it('caps the number of live drafts (oldest evicted)', () => {
    const tokens: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      tokens.push(createPreviewDraft(`draft-${i}`));
    }
    // Oldest tokens evicted, newest survive.
    expect(consumePreviewDraft(tokens[0])).toBeNull();
    expect(consumePreviewDraft(tokens[tokens.length - 1])).not.toBeNull();
  });
});

describe('dashboard layout validation', () => {
  it('accepts a unique ordered subset of the registry', () => {
    const parsed = validateDashboardLayout(['signins_24h', 'active_sessions']);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.widgets).toEqual(['signins_24h', 'active_sessions']);
  });

  it('rejects unknown keys, duplicates, non-arrays, and oversize layouts', () => {
    expect(validateDashboardLayout(['not_a_widget']).ok).toBe(false);
    expect(validateDashboardLayout(['active_sessions', 'active_sessions']).ok).toBe(false);
    expect(validateDashboardLayout('active_sessions').ok).toBe(false);
    expect(validateDashboardLayout([]).ok).toBe(false);
    const tooMany = Array.from({ length: 13 }, () => 'active_sessions');
    expect(validateDashboardLayout(tooMany).ok).toBe(false);
  });

  it('registry and default layout agree', () => {
    for (const key of DEFAULT_DASHBOARD_LAYOUT) {
      expect(DASHBOARD_WIDGET_KEYS).toContain(key);
    }
  });
});

describe('ldap filter escaping', () => {
  it('escapes RFC 4515 special characters', () => {
    expect(escapeLdapFilter('ab*c')).toBe('ab\\2ac');
    expect(escapeLdapFilter('a(b')).toBe('a\\28b');
    expect(escapeLdapFilter('a\\b')).toBe('a\\5cb');
    expect(escapeLdapFilter('clean')).toBe('clean');
  });

  it('never lets filter metacharacters widen a search', () => {
    const escaped = escapeLdapFilter('*)(objectClass=*');
    expect(escaped).not.toContain('*)');
    expect(escaped).not.toContain('(!');
  });
});
