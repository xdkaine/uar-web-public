/**
 * Sanitizes a single cell value for safe CSV export.
 * Prevents CSV injection by prefixing dangerous characters with a single quote.
 * 
 * @param value - The cell value to sanitize
 * @returns Sanitized cell value safe for CSV export
 */
export function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  // Normalize only for detection so full-width formula prefixes are caught
  // without changing the exported value.
  const comparisonValue = stringValue.normalize('NFKC');
  const startsWithControlCharacter = /^[\t\r\n]/u.test(comparisonValue);
  const startsWithFormula = /^\s*[=+\-@|\\]/u.test(comparisonValue);

  if (startsWithControlCharacter || startsWithFormula) {
    // Prefix with single quote to prevent formula interpretation
    // The single quote is the standard Excel/Sheets way to indicate "text, not formula"
    return `'${stringValue}`;
  }
  
  return stringValue;
}

/**
 * Escapes a cell value for CSV format (handles quotes and special characters).
 * Also applies CSV injection protection.
 * 
 * @param value - The cell value to escape
 * @returns Escaped and sanitized cell value wrapped in quotes
 */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const sanitized = sanitizeCsvCell(value);
  // Escape double quotes by doubling them, then wrap in quotes
  return `"${sanitized.replace(/"/g, '""')}"`;
}

/**
 * Converts a 2D array of data to a CSV string with proper escaping and sanitization.
 * 
 * @param headers - Array of column headers
 * @param data - 2D array of row data
 * @returns CSV formatted string
 */
export function generateCsvContent(
  headers: string[],
  data: (string | number | boolean | null | undefined)[][]
): string {
  const headerRow = headers.map(h => escapeCsvCell(h)).join(',');
  const dataRows = data.map(row => 
    row.map(cell => escapeCsvCell(cell)).join(',')
  );
  
  return [headerRow, ...dataRows].join('\n');
}

/**
 * Parses RFC 4180-style CSV, including quoted commas, escaped quotes, and
 * embedded CRLF/newline characters.
 */
export function parseCsvContent(content: string): string[][] {
  if (!content) {
    return [];
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterClosingQuote = false;

  const finishField = () => {
    row.push(field);
    field = '';
    afterClosingQuote = false;
  };

  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (afterClosingQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new Error('Invalid character after a closing CSV quote');
    }

    if (character === '"') {
      if (field) {
        throw new Error('Unexpected quote in an unquoted CSV field');
      }
      inQuotes = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\r' || character === '\n') {
      finishRow();
      if (character === '\r' && content[index + 1] === '\n') {
        index += 1;
      }
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error('Unterminated quoted CSV field');
  }

  if (field || row.length > 0 || afterClosingQuote) {
    finishRow();
  }

  return rows;
}

/**
 * Sanitizes data from CSV import to prevent formula injection when the data
 * might be re-exported or displayed.
 * 
 * @param value - The imported value to sanitize
 * @returns Sanitized value with dangerous prefixes removed
 */
export function sanitizeCsvImport(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  let result = String(value).trim();
  
  // Remove leading dangerous characters that could be formula injection
  const dangerousChars = ['=', '+', '@', '|', '\\'];
  while (result.length > 0 && dangerousChars.includes(result.charAt(0))) {
    result = result.substring(1).trim();
  }
  
  // Handle special case: leading minus followed by digit (negative number) is OK
  // But leading minus followed by non-digit should be stripped
  if (result.startsWith('-') && result.length > 1 && !/\d/.test(result.charAt(1))) {
    result = result.substring(1).trim();
  }
  
  return result;
}
