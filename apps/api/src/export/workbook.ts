/**
 * The two export formats.
 *
 * Both take the already-filtered list, so "export what I'm looking at" is structurally
 * true: the route hands them the exact same result the table would have shown.
 *
 * Plain lists, no analysis. The workbook keeps one worksheet per year — that is how the
 * app organizes applications everywhere else, and it keeps any one sheet short enough to
 * read — but there is no summary or breakdown sheet.
 *
 * **Why the buffered writer, not `stream.xlsx.WorkbookWriter`.** The streaming writer goes
 * through `archiver`, which on this dependency tree writes some entries into the zip's
 * central directory with `crc = 0` and `uncompressed size = 0`. Readers that trust the
 * central directory — Python's zipfile, and therefore Excel-adjacent tooling — then read
 * those entries as empty and reject the file, even though the compressed bytes are
 * actually intact. `Workbook.xlsx.writeBuffer()` uses a different packing path and
 * produces a correct archive. The cost is holding the workbook in memory, which for a
 * personal tracker is a few hundred kilobytes at worst.
 */

import ExcelJS from 'exceljs';
import { toCsvLines } from '@jobtrack/shared';
import { EXPORT_COLUMNS, type ExportColumn } from './columns.js';
import type { ExportRow } from './rows.js';

/** Line-by-line so a large CSV export streams instead of being built in memory first. */
export function* csvLines(
  rows: readonly ExportRow[],
  columns: readonly ExportColumn[] = EXPORT_COLUMNS,
): Generator<string> {
  yield* toCsvLines(rows, columns, { bom: true });
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2937' },
};

const WRAPPED = { vertical: 'top', wrapText: true } as const;

/** Build the .xlsx as a buffer, ready to send, with `columns` in that order. */
export async function buildWorkbook(
  rows: readonly ExportRow[],
  columns: readonly ExportColumn[] = EXPORT_COLUMNS,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'JobTrack';
  workbook.created = new Date();

  const wraps = columns.some((column) => column.wrap);

  const byYear = new Map<number, ExportRow[]>();
  for (const row of rows) {
    const list = byYear.get(row.periodYear) ?? [];
    list.push(row);
    byYear.set(row.periodYear, list);
  }

  if (byYear.size === 0) {
    // An empty export still needs a readable sheet with its headers in place.
    addSheet(workbook, 'Applications', columns);
  }

  // Newest year first, matching the order the app shows them in.
  for (const year of [...byYear.keys()].sort((a, b) => b - a)) {
    const sheet = addSheet(workbook, String(year), columns);

    const yearRows = (byYear.get(year) ?? [])
      .slice()
      .sort((a, b) => (a.appliedOn < b.appliedOn ? 1 : -1));

    for (const row of yearRows) {
      const added = sheet.addRow(columns.map((column) => column.value(row)));
      // Notes can run to several paragraphs; without this the row is one line tall and
      // everything after the first newline is invisible.
      if (wraps) added.alignment = { ...WRAPPED };
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: yearRows.length + 1, column: columns.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** A worksheet with the shared columns and a frozen, styled header. */
function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: readonly ExportColumn[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = columns.map((column) => ({
    header: column.header,
    // The field, not the header: two columns may be given the same header.
    key: column.field,
    width: column.width,
    ...(column.wrap ? { style: { alignment: { ...WRAPPED } } } : {}),
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle' };

  return sheet;
}
