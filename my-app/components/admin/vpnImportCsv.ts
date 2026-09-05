export type CsvDelimiter = "," | ";" | "\t";

export interface ParsedVpnImportRecord {
  sourceRow: number;
  vpnUsername: string;
  fullName?: string;
  email?: string;
  notes?: string;
  rawData: Record<string, string>;
}

export interface VpnImportColumnMapping {
  vpnUsername: number;
  fullName?: number;
  email?: number;
  notes?: number;
}

function cleanCsvCell(value: string) {
  return value.trim().replace(/^["']|["']$/g, "");
}

export function parseVpnImportCsv(
  text: string,
  delimiter: CsvDelimiter,
  existingMapping?: VpnImportColumnMapping,
) {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return null;

  const headers = lines[0].split(delimiter).map(cleanCsvCell);
  const mapping = existingMapping ?? detectVpnImportColumns(headers);
  const records: ParsedVpnImportRecord[] = [];
  for (let sourceRow = 1; sourceRow < lines.length; sourceRow += 1) {
    const values = lines[sourceRow].trim().split(delimiter).map(cleanCsvCell);
    const record: ParsedVpnImportRecord = {
      sourceRow,
      vpnUsername: values[mapping.vpnUsername] || "",
      fullName:
        mapping.fullName === undefined ? undefined : values[mapping.fullName],
      email: mapping.email === undefined ? undefined : values[mapping.email],
      notes: mapping.notes === undefined ? undefined : values[mapping.notes],
      rawData: Object.fromEntries(
        headers.map((header, index) => [header, values[index]]),
      ),
    };
    if (record.vpnUsername) records.push(record);
  }
  return { headers, mapping, records };
}

function detectVpnImportColumns(headers: string[]): VpnImportColumnMapping {
  const mapping: VpnImportColumnMapping = { vpnUsername: 0 };
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index].toLowerCase();
    if (
      header.includes("username") ||
      header.includes("user") ||
      header.includes("member")
    )
      mapping.vpnUsername = index;
    else if (header.includes("name") && !header.includes("username"))
      mapping.fullName = index;
    else if (header.includes("email") || header.includes("mail"))
      mapping.email = index;
    else if (header.includes("note") || header.includes("comment"))
      mapping.notes = index;
  }
  return mapping;
}
