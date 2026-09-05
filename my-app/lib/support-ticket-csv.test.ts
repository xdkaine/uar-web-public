import { describe, expect, it } from 'vitest';
import { generateSupportTicketsCsv, type SupportTicketCsvRecord } from './support-ticket-csv';

function ticket(subject: string): SupportTicketCsvRecord {
  return {
    id: 'ticket-1',
    subject,
    username: 'ordinary-user',
    category: 'SOC',
    severity: 'high',
    status: 'open',
    responses: [],
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    closedAt: null,
  };
}

describe('support ticket CSV export', () => {
  it.each([
    '=HYPERLINK("https://attacker.test")',
    '+SUM(1,1)',
    '-2+3',
    '@SUM(1,1)',
    '|calc',
    '\\formula',
    '\t=SUM(1,1)',
    '\r=SUM(1,1)',
    '\n=SUM(1,1)',
    '  =SUM(1,1)',
    '＝SUM(1,1)',
    '＋SUM(1,1)',
    '－2+3',
    '＠SUM(1,1)',
  ])('neutralizes a subject beginning with %j', (subject) => {
    const csv = generateSupportTicketsCsv([ticket(subject)]);
    const expectedCell = `"'${subject.replace(/"/g, '""')}"`;

    expect(csv).toContain(expectedCell);
  });

  it('quotes delimiters, quotes, and newlines without losing neutralization', () => {
    const subject = '=SUM(1,1), "quoted"\nnext line';
    const csv = generateSupportTicketsCsv([ticket(subject)]);

    expect(csv).toContain(
      '"\'=SUM(1,1), ""quoted""\nnext line"'
    );
  });
});
