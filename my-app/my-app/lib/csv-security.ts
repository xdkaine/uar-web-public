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
  
  // Check if the cell starts with a potentially dangerous character
  const dangerousChars = ['=', '+', '-', '@', '|', '\\', '\t', '\r', '\n'];
  const firstChar = stringValue.charAt(0);
  
  if (dangerousChars.includes(firstChar)) {
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
