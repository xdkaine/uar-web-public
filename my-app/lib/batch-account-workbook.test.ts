import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import {
  BATCH_AD_COLUMNS,
  BATCH_AD_SHEET,
  BATCH_VPN_COLUMNS,
  BATCH_VPN_SHEET,
  BatchAccountWorkbookError,
  createBatchAccountWorkbookTemplate,
  parseBatchAccountWorkbook,
  readBatchAccountWorkbook,
  type BatchWorkbook,
} from "./batch-account-workbook";

function sheet(name: string, rows: unknown[][]) {
  return {
    name, actualRowCount: rows.length,
    getRow(number: number) { const values = [undefined, ...(rows[number - 1] || [])]; return { number, values, getCell: (column: number) => ({ value: values[column] }) }; },
    eachRow(callback: (row: ReturnType<typeof this.getRow>, rowNumber: number) => void) { rows.forEach((_, index) => callback(this.getRow(index + 1), index + 1)); },
  };
}
function workbook(adRows: unknown[][], vpnRows: unknown[][]): BatchWorkbook {
  const sheets = [sheet(BATCH_AD_SHEET, adRows), sheet(BATCH_VPN_SHEET, vpnRows)];
  return { getWorksheet: (name) => sheets.find((item) => item.name === name) } as BatchWorkbook;
}
describe("parseBatchAccountWorkbook", () => {
  it('imports displayed AD and VPN email text from real XLSX hyperlink cells', async () => {
    const book = new ExcelJS.Workbook();
    const ad = book.addWorksheet(BATCH_AD_SHEET);
    const vpn = book.addWorksheet(BATCH_VPN_SHEET);
    ad.addRow([...BATCH_AD_COLUMNS]);
    vpn.addRow([...BATCH_VPN_COLUMNS]);
    for (let index = 0; index < 4; index++) {
      ad.addRow(['Person', { text: `person${index}@example.test`, hyperlink: 'mailto:different@example.test' }, `person${index}`, 'Example-Pass42!', '', true]);
    }
    vpn.addRow(['VPN person', { text: 'vpn@example.test', hyperlink: 'mailto:vpn@example.test' }, 'vpn', 'Example-Pass42!', '2030-01-01', 'External']);
    const bytes = await book.xlsx.writeBuffer();
    const parsed = await readBatchAccountWorkbook(new File([bytes], 'hyperlinks.xlsx'));
    expect(parsed.adAccounts.map(account => account.email)).toEqual(Array.from({ length: 4 }, (_, index) => `person${index}@example.test`));
    expect(parsed.vpnAccounts[0].email).toBe('vpn@example.test');
  });
  it('continues to reject email formulas and malformed hyperlink objects', () => {
    for (const email of [{ formula: 'HYPERLINK("mailto:a@b.test")', result: 'a@b.test' }, { hyperlink: 'mailto:a@b.test', text: 42 }]) {
      expect(() => parseBatchAccountWorkbook(workbook(
        [[...BATCH_AD_COLUMNS], ['Person', email, 'person', 'Example-Pass42!', '', true]], [[...BATCH_VPN_COLUMNS]],
      ))).toThrow(/Email/);
    }
  });
  it("returns typed AD and VPN drafts from the defined sheets", () => {
    const result = parseBatchAccountWorkbook(workbook(
      [BATCH_AD_COLUMNS as unknown as unknown[], ["Ada Lovelace", "ada@example.test", "ada", " literal-password ", new Date("2030-01-01T00:00:00Z"), true]],
      [BATCH_VPN_COLUMNS as unknown as unknown[], ["Ada Lovelace", "ada@example.test", "ada-vpn", "vpn-password", "2030-01-01T00:00:00Z", "External"]],
    ));
    expect(result.adAccounts[0]).toMatchObject({ ldapUsername: "ada", isInternal: true, password: " literal-password " });
    expect(result.vpnAccounts[0]).toMatchObject({ vpnUsername: "ada-vpn", portalType: "External" });
  });
  it("reports sheet, header, formula, and type errors with row evidence", () => {
    expect(() => parseBatchAccountWorkbook(workbook(
      [["Name"], [{ formula: "NOW()" }]],
      [BATCH_VPN_COLUMNS as unknown as unknown[]],
    ))).toThrow(BatchAccountWorkbookError);
    try { parseBatchAccountWorkbook(workbook([["Name"], [{ formula: "NOW()" }]], [BATCH_VPN_COLUMNS as unknown as unknown[]])); } catch (error) {
      expect((error as BatchAccountWorkbookError).errors.join(" ")).toMatch(/AD accounts column 1|AD accounts row 2/);
    }
  });
  it("rejects more than 100 combined rows", () => {
    const rows = Array.from({ length: 101 }, (_, index) => [`User ${index}`, `u${index}@example.test`, `u${index}`, "password", "", "true"]);
    expect(() => parseBatchAccountWorkbook(workbook([BATCH_AD_COLUMNS as unknown as unknown[], ...rows], [BATCH_VPN_COLUMNS as unknown as unknown[]]))).toThrow(/more than 100/);
  });
  it("creates a non-empty XLSX template", async () => {
    expect((await createBatchAccountWorkbookTemplate()).size).toBeGreaterThan(100);
  });
  it("ships a blank template matching runtime sheet headers and text formats", async () => {
    const template = new ExcelJS.Workbook();
    const bytes = await readFile(new URL('../public/templates/batch-account-template.xlsx', import.meta.url));
    await template.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(template.worksheets.map(sheet => sheet.name)).toEqual([BATCH_AD_SHEET, BATCH_VPN_SHEET, 'Instructions']);
    expect(template.getWorksheet(BATCH_AD_SHEET)!.getRow(1).values).toEqual([undefined, ...BATCH_AD_COLUMNS]);
    expect(template.getWorksheet(BATCH_VPN_SHEET)!.getRow(1).values).toEqual([undefined, ...BATCH_VPN_COLUMNS]);
    for (const sheet of template.worksheets.slice(0, 2)) {
      expect(sheet.actualRowCount).toBe(1);
      expect(sheet.getColumn(3).numFmt).toBe('@');
      expect(sheet.getColumn(4).numFmt).toBe('@');
      expect(sheet.getCell('F101').dataValidation.type).toBe('list');
    }
  });
  it.each(['1', '2030-02-30', '2030-02-30T12:00:00Z', 'not a date'])('rejects invalid expiration %s', expiration => {
    expect(() => parseBatchAccountWorkbook(workbook(
      [[...BATCH_AD_COLUMNS], ['Name', 'name@example.test', 'name', 'password', expiration, true]],
      [[...BATCH_VPN_COLUMNS]],
    ))).toThrow(/Expiration must be/);
  });
  it('allows a VPN-only import to join an existing manual AD draft', () => {
    const parsed = parseBatchAccountWorkbook(workbook(
      [[...BATCH_AD_COLUMNS]],
      [[...BATCH_VPN_COLUMNS], ['VPN Name', '', 'vpn', 'pw', '2030-01-01', 'External']],
    ));
    expect(parsed.adAccounts).toHaveLength(0);
    expect(parsed.vpnAccounts).toHaveLength(1);
  });
  it('rejects a row with data only outside configured columns', () => {
    expect(() => parseBatchAccountWorkbook(workbook(
      [[...BATCH_AD_COLUMNS], ['', '', '', '', '', '', 'unexpected']], [[...BATCH_VPN_COLUMNS]],
    ))).toThrow(/outside the defined columns/);
  });
  it('rejects formula credentials instead of using the cached formula result', () => {
    expect(() => parseBatchAccountWorkbook(workbook(
      [[...BATCH_AD_COLUMNS], ['Name', 'name@example.test', 'name', { formula: 'A1', result: 'cached' }, '', true]], [[...BATCH_VPN_COLUMNS]],
    ))).toThrow(/Initial password cannot contain a formula/);
  });
  it('rejects files above the size limit before parsing', async () => {
    const arrayBuffer = () => { throw new Error('must not parse'); };
    await expect(readBatchAccountWorkbook({ name: 'oversize.xlsx', size: 2 * 1024 * 1024 + 1, arrayBuffer } as unknown as File)).rejects.toThrow(/smaller than 2 MB/);
  });
});
