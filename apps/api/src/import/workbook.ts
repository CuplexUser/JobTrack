/**
 * .xlsx parsing for Import — the read direction of `export/workbook.ts`.
 *
 * Export writes one worksheet per year; Import does not care which sheet a row came from, so
 * every worksheet is read and its rows pooled together. A sheet whose header does not match
 * is skipped with a file-level error rather than failing the whole upload — a workbook that
 * was hand-edited to add a summary tab should not block importing the sheets that are fine.
 */

import ExcelJS from 'exceljs';
import { IMPORT_HEADERS, isBlankRow, mapHeaders, toRawRow, type RawImportRow } from './columns.js';
import type { ParsedImport } from './csv.js';

/** Export writes every cell as a plain string, but a hand-edited file might carry a real
 * date or number in a cell — coerce those back to text rather than choking on them. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'richText' in value) {
    return (value.richText as { text: string }[]).map((part) => part.text).join('');
  }
  if (typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '');
  if (typeof value === 'object' && 'result' in value) {
    return String((value as { result: unknown }).result ?? '');
  }
  return String(value);
}

export async function parseXlsxImport(buffer: Buffer): Promise<ParsedImport> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled types declare an ambient `Buffer extends ArrayBuffer`, which collides
  // structurally with the real Node `Buffer` from @types/node — a cast, not a real mismatch.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const rows: RawImportRow[] = [];
  const errors: string[] = [];
  let rowNumber = 0;

  for (const sheet of workbook.worksheets) {
    const headerValues = sheet.getRow(1).values as ExcelJS.CellValue[];
    // Row.values is 1-indexed with a leading empty slot at index 0.
    const header = headerValues.slice(1).map(cellToString);
    if (header.length === 0) continue;

    const headerMap = mapHeaders(header);
    if (!headerMap) {
      errors.push(
        `Sheet "${sheet.name}" is missing one of the required columns (${IMPORT_HEADERS.join(', ')}) and was skipped.`,
      );
      continue;
    }

    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const sheetRow = sheet.getRow(r);
      const cells = header.map((_, index) => cellToString(sheetRow.getCell(index + 1).value));
      if (isBlankRow(cells)) continue;
      rowNumber += 1;
      rows.push(toRawRow(cells, headerMap, rowNumber, sheet.name));
    }
  }

  return { rows, errors };
}
