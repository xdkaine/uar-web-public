import { describe, expect, it } from 'vitest';
import {
  escapeCsvCell,
  generateCsvContent,
  parseCsvContent,
} from './csv-security';

describe('CSV export security', () => {
  it.each([
    '=HYPERLINK("https://attacker.example","Open")',
    '+SUM(1,1)',
    '-1+1',
    '@SUM(1,1)',
    '|calc',
    '\\payload',
    '\t=1+1',
    '\r=1+1',
    '\n=1+1',
    ' =1+1',
    '\t  =1+1',
    '＝HYPERLINK("https://attacker.example","Open")',
    '＋SUM(1,1)',
    '－1+1',
    '＠SUM(1,1)',
    '\u3000＝1+1',
  ])('forces formula-capable cell content to text: %j', (value) => {
    const escapedValue = value.replace(/"/g, '""');
    expect(escapeCsvCell(value)).toBe(`"'${escapedValue}"`);
  });

  it('keeps embedded commas, quotes, and newlines inside one quoted cell', () => {
    expect(
      generateCsvContent(
        ['Name', 'Institution'],
        [['Doe, "Jane"', 'Example\nUniversity']]
      )
    ).toBe(
      '"Name","Institution"\n"Doe, ""Jane""","Example\nUniversity"'
    );
  });

  it('neutralizes public request fields when generating an access-request row', () => {
    const csv = generateCsvContent(
      ['Name', 'Event', 'Institution'],
      [[
        '=HYPERLINK("https://attacker.example","Open")',
        ' +SUM(1,1)',
        '\t@malicious',
      ]]
    );

    expect(csv).toContain(
      '"\'=HYPERLINK(""https://attacker.example"",""Open"")"'
    );
    expect(csv).toContain('"\' +SUM(1,1)"');
    expect(csv).toContain('"\'\t@malicious"');
  });

  it('parses quoted commas, quotes, CRLF, and embedded newlines', () => {
    const csv = [
      'Name,Email,Institution,Event',
      '"Doe, ""Jane""",jane@example.test,"Example, University","Workshop',
      'Day 2"',
    ].join('\r\n');

    expect(parseCsvContent(csv)).toEqual([
      ['Name', 'Email', 'Institution', 'Event'],
      [
        'Doe, "Jane"',
        'jane@example.test',
        'Example, University',
        'Workshop\r\nDay 2',
      ],
    ]);
  });

  it('rejects malformed quoted input instead of misaligning batch columns', () => {
    expect(() => parseCsvContent('Name,Email\n"Unclosed,user@example.test')).toThrow(
      'Unterminated quoted CSV field'
    );
    expect(() => parseCsvContent('Name,Email\n"Doe"x,user@example.test')).toThrow(
      'Invalid character after a closing CSV quote'
    );
  });

  it('keeps imported batch fields inert and in their original result columns', () => {
    const imported = parseCsvContent([
      'Name,Email,Institution,Event',
      '"=HYPERLINK(""https://attacker.example"",""Open"")",user@example.test,"Example, University","Workshop',
      'Day 2"',
    ].join('\r\n'));

    const resultCsv = generateCsvContent(
      ['Name', 'Email', 'Institution', 'Event', 'Status', 'Error'],
      [[...imported[1], 'success', '']]
    );

    expect(resultCsv).toContain(
      '"\'=HYPERLINK(""https://attacker.example"",""Open"")"'
    );
    expect(resultCsv).toContain('"Example, University"');
    expect(resultCsv).toContain('"Workshop\r\nDay 2"');
  });
});
