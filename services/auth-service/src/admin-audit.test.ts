import { describe, expect, it } from 'vitest';
import { auditRowsToCsv, auditRowsToNdjson, parseAuditFilters } from './admin-audit';

describe('audit filtering and export encoding', () => {
  it('bounds text inputs and parses valid dates', () => {
    const filters = parseAuditFilters(new URLSearchParams({
      from: '2026-08-01T00:00:00Z',
      action: ` ${'A'.repeat(140)} `,
      riskLevel: 'high',
    }));
    expect(filters.from?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(filters.action).toHaveLength(120);
    expect(filters.riskLevel).toBe('high');
  });

  it('neutralizes spreadsheet formulas and quotes CSV fields', () => {
    const rows = [{
      id: '1', createdAt: new Date('2026-08-27T00:00:00Z'), action: '=HYPERLINK("bad")',
      category: 'authentication', username: 'alice', actorType: 'user', subjectUsername: 'alice',
      eventKind: 'security', outcome: 'success', targetId: null, clientId: 'portal', providerSid: null,
      riskLevel: 'low', details: '{"safe":true}', ipAddress: '10.0.0.1', userAgent: 'UA', success: true,
    }];
    const csv = auditRowsToCsv(rows);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('"2026-08-27T00:00:00.000Z"');
    expect(auditRowsToNdjson(rows).trim()).toContain('"action":"=HYPERLINK');
  });

  it.each(['\t=CMD()', '\r+CMD()', '\n-CMD()', '  @CMD()'])(
    'neutralizes formula markers after leading whitespace (%j)',
    (action) => {
      const rows = [{
        id: '1', createdAt: new Date(0), action, category: 'authentication', username: 'u',
        actorType: null, subjectUsername: null, eventKind: null, outcome: null, targetId: null,
        clientId: null, providerSid: null, riskLevel: null, details: null, ipAddress: null,
        userAgent: null, success: true,
      }];
      expect(auditRowsToCsv(rows)).toContain(`"'${action.replaceAll('"', '""')}"`);
    }
  );
});
