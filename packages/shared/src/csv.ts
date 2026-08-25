/**
 * RFC 4180 CSV writing.
 *
 * Hand-written rather than pulled from a dependency, because the entire specification that
 * matters here is "quote when the value contains a delimiter, a quote or a newline, and
 * double any quote inside" — and the failure mode of getting it subtly wrong (a job title
 * containing a comma silently shifting every later column) is exactly the kind of thing
 * worth having tests for rather than trust in.
 */

/**
 * Excel on Windows reads a UTF-8 file as the local ANSI codepage unless it finds a byte
 * order mark, which turns "Ericsson Malmö" into mojibake. The BOM is the difference
 * between an export that opens correctly on a double-click and one that needs the import
 * wizard.
 */
export const UTF8_BOM = '\uFEFF';

/** RFC 4180 says CRLF, and Excel is happier with it. */
const ROW_SEPARATOR = '\r\n';

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  const text = value instanceof Date ? value.toISOString() : String(value);
  if (!/[",\r\n]/.test(text)) return text;

  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsvRow(values: readonly unknown[]): string {
  return values.map(escapeCsvField).join(',');
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * Render rows to a complete CSV document.
 *
 * Yielded line by line rather than concatenated so the API can stream a large export
 * straight to the response instead of building the whole string in memory first.
 */
export function* toCsvLines<T>(
  rows: Iterable<T>,
  columns: readonly CsvColumn<T>[],
  options: { bom?: boolean } = {},
): Generator<string> {
  const withBom = options.bom ?? true;
  yield `${withBom ? UTF8_BOM : ''}${toCsvRow(columns.map((c) => c.header))}${ROW_SEPARATOR}`;

  for (const row of rows) {
    yield `${toCsvRow(columns.map((c) => c.value(row)))}${ROW_SEPARATOR}`;
  }
}

export function toCsv<T>(
  rows: Iterable<T>,
  columns: readonly CsvColumn<T>[],
  options: { bom?: boolean } = {},
): string {
  return [...toCsvLines(rows, columns, options)].join('');
}
