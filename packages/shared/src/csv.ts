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

/**
 * RFC 4180 CSV parsing — the reader counterpart to `toCsvLines`/`toCsv` above, for the same
 * reason the writer is hand-written: a field containing a delimiter, a quote or a newline is
 * exactly what a naive `split(',')` gets wrong, and that is precisely what Import needs to
 * get right on a file nobody here produced.
 *
 * Returns every row as an array of cells, in file order. A blank line (no characters between
 * two separators) is dropped rather than returned as a one-empty-cell row, since that is what
 * a stray empty line in a spreadsheet export means.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\r') {
      endRow();
      if (input[i + 1] === '\n') i += 1;
    } else if (char === '\n') {
      endRow();
    } else {
      field += char;
    }
  }

  // A trailing row with no terminator still counts; the phantom empty row that a file
  // ending in its own separator would otherwise produce does not.
  if (field !== '' || row.length > 0) endRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
