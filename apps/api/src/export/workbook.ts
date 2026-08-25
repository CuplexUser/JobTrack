/**
 * The two export formats.
 *
 * Both take the already-filtered list, so "export what I'm looking at" is structurally
 * true: the route hands them the exact same result the table would have shown.
 *
 * Plain lists, no analysis. The workbook keeps one worksheet per year — that is how the
 * app organises applications everywhere else, and it keeps any one sheet short enough to
 * read — but there is no summary or breakdown sheet.
 */

import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { toCsvLines } from '@jobtrack/shared';
import { EXPORT_COLUMNS } from './columns.js';
import type { ExportRow } from './rows.js';

/** Line-by-line so a large export streams instead of being built in memory first. */
export function* csvLines(rows: readonly ExportRow[]): Generator<string> {
  yield* toCsvLines(rows, EXPORT_COLUMNS, { bom: true });
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2937' },
};

export async function writeWorkbook(
  rows: readonly ExportRow[],
  output: Writable,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
  });
  workbook.creator = 'JobTrack';
  workbook.created = new Date();

  const byYear = new Map<number, ExportRow[]>();
  for (const row of rows) {
    const list = byYear.get(row.periodYear) ?? [];
    list.push(row);
    byYear.set(row.periodYear, list);
  }

  // Newest year first, matching the order the app shows them in.
  for (const year of [...byYear.keys()].sort((a, b) => b - a)) {
    const sheet = addSheet(workbook, String(year));

    const yearRows = (byYear.get(year) ?? [])
      .slice()
      .sort((a, b) => (a.appliedOn < b.appliedOn ? 1 : -1));

    for (const row of yearRows) {
      const added = sheet.addRow(EXPORT_COLUMNS.map((column) => column.value(row)));
      // Notes can run to several paragraphs; without this the row is one line tall and
      // everything after the first newline is invisible.
      added.alignment = { vertical: 'top', wrapText: true };
      added.commit();
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: yearRows.length + 1, column: EXPORT_COLUMNS.length },
    };
    sheet.commit();
  }

  if (byYear.size === 0) {
    // An empty export still needs a readable sheet with its headers in place.
    addSheet(workbook, 'Applications').commit();
  }

  await workbook.commit();
}

/**
 * A worksheet with the shared columns, a frozen styled header and an autofilter.
 *
 * The header comes from `columns` rather than `addRow`: in the streaming writer a
 * committed row can no longer be fetched, so styling it afterwards throws.
 */
function addSheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  name: string,
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = EXPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.header,
    width: column.width,
    ...(column.wrap ? { style: { alignment: { vertical: 'top', wrapText: true } } } : {}),
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle' };
  header.commit();

  return sheet;
}
