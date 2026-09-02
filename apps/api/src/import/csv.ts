/**
 * CSV parsing for Import, built on the generic `parseCsv` in `@jobtrack/shared`.
 *
 * Everything domain-specific — which columns are required, how a row's cells become a
 * `RawImportRow` — lives here rather than in the shared package, which stays a generic RFC
 * 4180 reader/writer with no idea what "Position" or "Status" mean.
 */

import { parseCsv } from '@jobtrack/shared';
import { REQUIRED_HEADERS, isBlankRow, mapHeaders, toRawRow, type RawImportRow } from './columns.js';

export interface ParsedImport {
  rows: RawImportRow[];
  /** File-level problems — a missing column, an empty file — rather than a bad single row. */
  errors: string[];
}

export function parseCsvImport(text: string): ParsedImport {
  const table = parseCsv(text);
  const [header, ...body] = table;
  if (!header) return { rows: [], errors: ['The file is empty.'] };

  const headerMap = mapHeaders(header);
  if (!headerMap) {
    return {
      rows: [],
      errors: [`The file is missing one of the required columns: ${REQUIRED_HEADERS.join(', ')}.`],
    };
  }

  const rows: RawImportRow[] = [];
  let rowNumber = 0;
  for (const cells of body) {
    if (isBlankRow(cells)) continue;
    rowNumber += 1;
    rows.push(toRawRow(cells, headerMap, rowNumber, null));
  }
  return { rows, errors: [] };
}
