import { describe, expect, it } from 'vitest';

import { parseVpnImportCsv } from './vpnImportCsv';

describe('parseVpnImportCsv', () => {
  it('detects columns and retains the source row used only for preview identity', () => {
    const parsed = parseVpnImportCsv('Email,VPN Username,Notes\na@example.test,ada,first\nb@example.test,grace,second', ',');
    expect(parsed).toMatchObject({
      mapping: { vpnUsername: 1, email: 0, notes: 2 },
      records: [
        { sourceRow: 1, vpnUsername: 'ada', email: 'a@example.test', notes: 'first' },
        { sourceRow: 2, vpnUsername: 'grace', email: 'b@example.test', notes: 'second' },
      ],
    });
  });

  it('uses a reviewed mapping on reparse instead of auto-detecting a different column', () => {
    const parsed = parseVpnImportCsv('User,Email\nportal-user,ada@example.test', ',', { vpnUsername: 1 });
    expect(parsed?.records).toEqual([{ sourceRow: 1, vpnUsername: 'ada@example.test', fullName: undefined, email: undefined, notes: undefined, rawData: { User: 'portal-user', Email: 'ada@example.test' } }]);
  });
});
