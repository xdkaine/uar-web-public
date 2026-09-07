import type {
  BatchAdAccountDraft,
  BatchVpnAccountDraft,
} from "@/lib/batch-account-plan";

export const BATCH_AD_SHEET = "AD accounts";
export const BATCH_VPN_SHEET = "VPN accounts";
export const BATCH_AD_COLUMNS = [
  "Full name",
  "Email",
  "AD username",
  "Initial password",
  "Expiration",
  "Internal account",
] as const;
export const BATCH_VPN_COLUMNS = [
  "Full name",
  "Email",
  "VPN username",
  "Initial password",
  "Expiration",
  "Portal type",
] as const;

export class BatchAccountWorkbookError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors[0] || "The workbook could not be imported.");
    this.name = "BatchAccountWorkbookError";
    this.errors = errors;
  }
}

type Cell = { value?: unknown; type?: number };
type Row = { number: number; values?: unknown[]; getCell(column: number): Cell };
type Worksheet = {
  name: string;
  actualRowCount: number;
  getRow(row: number): Row;
  eachRow(callback: (row: Row, rowNumber: number) => void): void;
};
export type BatchWorkbook = { getWorksheet(name: string): Worksheet | undefined };

export interface ImportedBatchAccounts {
  adAccounts: BatchAdAccountDraft[];
  vpnAccounts: BatchVpnAccountDraft[];
}

function cellText(value: unknown): string | null {
  // Excel automatically turns typed email addresses into hyperlink cells.
  // Read only their displayed text; never follow or use the link destination.
  if (value && typeof value === "object" && "hyperlink" in value && "text" in value && !("formula" in value) && !("sharedFormula" in value)) {
    value = typeof value.text === "string" ? value.text : value;
  }
  if (value === null || value === undefined || value === "") return "";
  return typeof value === "string" ? value.trim() : null;
}

function hasFormula(cell: Cell) {
  return cell.type === 6 || (typeof cell.value === "object" && cell.value !== null && "formula" in cell.value);
}

function dateValue(cell: Cell, label: string, errors: string[]): string {
  if (hasFormula(cell)) {
    errors.push(`${label} cannot contain a formula.`);
    return "";
  }
  if (cell.value === null || cell.value === undefined || cell.value === "") return "";
  if (cell.value instanceof Date && !Number.isNaN(cell.value.getTime())) return cell.value.toISOString();
  const value = cellText(cell.value);
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) {
    errors.push(`${label} must be an Excel date or an ISO date and time.`);
    return "";
  }
  const parsed = new Date(value);
  const calendarDay = new Date(value.slice(0, 10));
  if (Number.isNaN(parsed.getTime()) || Number.isNaN(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    errors.push(`${label} must be an Excel date or an ISO date and time.`);
    return "";
  }
  return parsed.toISOString();
}

function requiredHeaders(sheet: Worksheet, expected: readonly string[], errors: string[]) {
  const header = sheet.getRow(1);
  const found = Array.from({ length: expected.length }, (_, index) => {
    const cell = header.getCell(index + 1);
    if (hasFormula(cell)) errors.push(`${sheet.name}!${index + 1} header cannot contain a formula.`);
    return cellText(cell.value);
  });
  const extra = (header.values || []).slice(expected.length + 1).filter((value) => value !== null && value !== undefined && value !== "");
  if (extra.length) errors.push(`${sheet.name} has unknown column headers.`);
  const duplicate = found.find((value, index) => value && found.indexOf(value) !== index);
  if (duplicate) errors.push(`${sheet.name} repeats the "${duplicate}" column.`);
  expected.forEach((label, index) => {
    if (found[index] !== label) errors.push(`${sheet.name} column ${index + 1} must be "${label}".`);
  });
}

function rowHasValues(row: Row, columns: number) {
  return Array.from({ length: columns }, (_, index) => row.getCell(index + 1).value).some((value) => value !== null && value !== undefined && value !== "");
}

function safeText(cell: Cell, label: string, errors: string[]) {
  if (hasFormula(cell)) {
    errors.push(`${label} cannot contain a formula.`);
    return "";
  }
  const value = cellText(cell.value);
  if (value === null) {
    errors.push(`${label} must be text.`);
    return "";
  }
  return value;
}

function passwordText(cell: Cell, label: string, errors: string[]) {
  if (hasFormula(cell)) { errors.push(`${label} cannot contain a formula.`); return ""; }
  if (cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value !== "string") { errors.push(`${label} must be text.`); return ""; }
  return cell.value;
}

function booleanValue(cell: Cell, label: string, errors: string[]) {
  if (typeof cell.value === "boolean") return cell.value;
  const value = safeText(cell, label, errors).toLowerCase();
  if (value === "true" || value === "yes") return true;
  if (value === "false" || value === "no") return false;
  errors.push(`${label} must be true/false or yes/no.`);
  return false;
}

export function parseBatchAccountWorkbook(workbook: BatchWorkbook): ImportedBatchAccounts {
  const errors: string[] = [];
  const adSheet = workbook.getWorksheet(BATCH_AD_SHEET);
  const vpnSheet = workbook.getWorksheet(BATCH_VPN_SHEET);
  if (!adSheet) errors.push(`Missing required sheet "${BATCH_AD_SHEET}".`);
  if (!vpnSheet) errors.push(`Missing required sheet "${BATCH_VPN_SHEET}".`);
  if (!adSheet || !vpnSheet) throw new BatchAccountWorkbookError(errors);
  requiredHeaders(adSheet, BATCH_AD_COLUMNS, errors);
  requiredHeaders(vpnSheet, BATCH_VPN_COLUMNS, errors);
  if (adSheet.actualRowCount + vpnSheet.actualRowCount - 2 > 100) errors.push("The workbook contains more than 100 accounts.");
  if (errors.length) throw new BatchAccountWorkbookError(errors);
  const adAccounts: BatchAdAccountDraft[] = [];
  const vpnAccounts: BatchVpnAccountDraft[] = [];
  const readRows = (sheet: Worksheet, columns: number, onRow: (row: Row, prefix: string) => void) => {
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if ((row.values || []).slice(columns + 1).some((value) => value !== null && value !== undefined && value !== "")) {
        errors.push(`${sheet.name} row ${rowNumber} has data outside the defined columns.`);
        return;
      }
      if (!rowHasValues(row, columns)) return;
      onRow(row, `${sheet.name} row ${rowNumber}`);
    });
  };
  readRows(adSheet, BATCH_AD_COLUMNS.length, (row, prefix) => {
    const rowErrors: string[] = [];
    const account: BatchAdAccountDraft = {
      name: safeText(row.getCell(1), `${prefix}, Full name`, rowErrors),
      email: safeText(row.getCell(2), `${prefix}, Email`, rowErrors),
      ldapUsername: safeText(row.getCell(3), `${prefix}, AD username`, rowErrors),
      password: passwordText(row.getCell(4), `${prefix}, Initial password`, rowErrors),
      accountExpiresAt: dateValue(row.getCell(5), `${prefix}, Expiration`, rowErrors),
      isInternal: booleanValue(row.getCell(6), `${prefix}, Internal account`, rowErrors),
    };
    errors.push(...rowErrors);
    if (!rowErrors.length) adAccounts.push(account);
  });
  readRows(vpnSheet, BATCH_VPN_COLUMNS.length, (row, prefix) => {
    const rowErrors: string[] = [];
    const portalType = safeText(row.getCell(6), `${prefix}, Portal type`, rowErrors);
    if (portalType && !["Management", "Limited", "External"].includes(portalType)) rowErrors.push(`${prefix}, Portal type must be Management, Limited, or External.`);
    const account: BatchVpnAccountDraft = {
      name: safeText(row.getCell(1), `${prefix}, Full name`, rowErrors),
      email: safeText(row.getCell(2), `${prefix}, Email`, rowErrors),
      vpnUsername: safeText(row.getCell(3), `${prefix}, VPN username`, rowErrors),
      password: passwordText(row.getCell(4), `${prefix}, Initial password`, rowErrors),
      accountExpiresAt: dateValue(row.getCell(5), `${prefix}, Expiration`, rowErrors),
      portalType,
    };
    errors.push(...rowErrors);
    if (!rowErrors.length) vpnAccounts.push(account);
  });
  if (!adAccounts.length && !vpnAccounts.length && !errors.length) errors.push("The workbook must contain at least one account.");
  if (adAccounts.length + vpnAccounts.length > 100) errors.push("The workbook contains more than 100 accounts.");
  if (errors.length) throw new BatchAccountWorkbookError(errors);
  return { adAccounts, vpnAccounts };
}

async function excelJs() {
  // The runtime dependency is intentionally loaded only after an operator selects a file.
  const imported = await import("exceljs");
  return imported.default ?? imported;
}

export async function readBatchAccountWorkbook(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new BatchAccountWorkbookError(["Choose an .xlsx workbook."]);
  if (file.size > 2 * 1024 * 1024) throw new BatchAccountWorkbookError(["Choose an .xlsx workbook smaller than 2 MB."]);
  const ExcelJS = await excelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return parseBatchAccountWorkbook(workbook as unknown as BatchWorkbook);
}

export async function createBatchAccountWorkbookTemplate(): Promise<Blob> {
  const ExcelJS = await excelJs();
  const workbook = new ExcelJS.Workbook();
  const ad = workbook.addWorksheet(BATCH_AD_SHEET);
  const vpn = workbook.addWorksheet(BATCH_VPN_SHEET);
  ad.addRow(BATCH_AD_COLUMNS); vpn.addRow(BATCH_VPN_COLUMNS);
  [ad, vpn].forEach((sheet) => { sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.columns.forEach((column) => { column.width = 22; }); });
  [ad, vpn].forEach((sheet) => { sheet.getColumn(3).numFmt = "@"; sheet.getColumn(4).numFmt = "@"; });
  for (let row = 2; row <= 101; row++) {
    ad.getCell(`F${row}`).dataValidation = { type: "list", allowBlank: false, formulae: ['"true,false"'] };
    vpn.getCell(`F${row}`).dataValidation = { type: "list", allowBlank: false, formulae: ['"Management,Limited,External"'] };
  }
  const instructions = workbook.addWorksheet("Instructions");
  instructions.addRows([
    ["Batch account workbook"],
    ["Sheet 1: AD accounts. The full batch must include at least one AD account; VPN-only imports can be added to manual AD rows."],
    ["Sheet 2: VPN accounts. Leave it blank when no VPN accounts are needed."],
    ["Required AD columns: Full name, Email, AD username, Initial password, Expiration, Internal account."],
    ["Required VPN columns: Full name, Email may be blank, VPN username, Initial password, Expiration, Portal type."],
    ["Use text for usernames and passwords. Do not use formulas. Expiration accepts an Excel date or ISO date and time."],
    ["Internal account accepts true/false or yes/no. Portal type is Management, Limited, or External."],
  ]);
  instructions.getRow(1).font = { bold: true };
  return new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function downloadBatchAccountWorkbookTemplate() {
  const url = URL.createObjectURL(await createBatchAccountWorkbookTemplate());
  const link = document.createElement("a");
  link.href = url; link.download = "batch-account-template.xlsx"; link.click();
  URL.revokeObjectURL(url);
}
