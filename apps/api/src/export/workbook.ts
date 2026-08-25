/**
 * The two export formats.
 *
 * Both take the already-filtered list, so "export what I'm looking at" is structurally
 * true: the route hands them the exact same result the table would have shown.
 */

import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  monthName,
  toCsvLines,
  type JobApplicationView,
} from '@jobtrack/shared';
import { EXPORT_COLUMNS } from './columns.js';

/** Line-by-line so a large export streams instead of being built in memory first. */
export function* csvLines(rows: readonly JobApplicationView[]): Generator<string> {
  yield* toCsvLines(rows, EXPORT_COLUMNS, { bom: true });
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2937' },
};

/**
 * Write an .xlsx with one worksheet per year plus a Summary sheet.
 *
 * A sheet per year is the spreadsheet equivalent of the year/month navigation in the app —
 * it is how someone actually reads a job search back, and it keeps any one sheet short
 * enough to scan.
 */
export async function writeWorkbook(
  rows: readonly JobApplicationView[],
  output: Writable,
): Promise<void> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useStyles: true,
  });
  workbook.creator = 'JobTrack';
  workbook.created = new Date();

  writeSummarySheet(workbook, rows);

  const byYear = new Map<number, JobApplicationView[]>();
  for (const row of rows) {
    const list = byYear.get(row.periodYear) ?? [];
    list.push(row);
    byYear.set(row.periodYear, list);
  }

  // Newest year first, matching the order the app shows them in.
  for (const year of [...byYear.keys()].sort((a, b) => b - a)) {
    const sheet = workbook.addWorksheet(String(year), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = EXPORT_COLUMNS.map((column) => ({
      header: column.header,
      key: column.header,
      width: column.width,
      ...(column.numFmt ? { style: { numFmt: column.numFmt } } : {}),
    }));

    styleHeader(sheet.getRow(1));

    const yearRows = (byYear.get(year) ?? []).slice().sort((a, b) => (a.appliedOn < b.appliedOn ? 1 : -1));
    for (const row of yearRows) {
      sheet.addRow(EXPORT_COLUMNS.map((column) => column.value(row))).commit();
    }

    // Autofilter over the populated range, so the sheet is usable the moment it opens.
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: yearRows.length + 1, column: EXPORT_COLUMNS.length },
    };
    sheet.commit();
  }

  if (byYear.size === 0) {
    // An empty export still needs a readable sheet. The header comes from `columns`
    // rather than addRow: in the streaming writer a committed row can no longer be
    // fetched, so styling it afterwards throws.
    const sheet = workbook.addWorksheet('Applications', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = EXPORT_COLUMNS.map((column) => ({
      header: column.header,
      key: column.header,
      width: column.width,
    }));
    styleHeader(sheet.getRow(1));
    sheet.commit();
  }

  await workbook.commit();
}

/**
 * A month-by-status matrix, plus the same totals the dashboard shows.
 *
 * This is the sheet that answers "how did the search actually go", which no per-row export
 * makes obvious on its own.
 */
function writeSummarySheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  rows: readonly JobApplicationView[],
): void {
  const sheet = workbook.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });

  const statuses = [...APPLICATION_STATUSES];
  sheet.columns = [
    { header: 'Period', key: 'period', width: 20 },
    ...statuses.map((status) => ({ header: STATUS_LABELS[status], key: status, width: 12 })),
    { header: 'Total', key: 'total', width: 10 },
  ];
  styleHeader(sheet.getRow(1));

  const buckets = new Map<string, { year: number; month: number; counts: Map<string, number> }>();
  for (const row of rows) {
    const key = `${row.periodYear}-${String(row.periodMonth).padStart(2, '0')}`;
    const bucket = buckets.get(key) ?? {
      year: row.periodYear,
      month: row.periodMonth,
      counts: new Map<string, number>(),
    };
    bucket.counts.set(row.status, (bucket.counts.get(row.status) ?? 0) + 1);
    buckets.set(key, bucket);
  }

  const ordered = [...buckets.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  for (const [, bucket] of ordered) {
    const counts = statuses.map((status) => bucket.counts.get(status) ?? 0);
    sheet
      .addRow([
        `${monthName(bucket.month)} ${bucket.year}`,
        ...counts,
        counts.reduce((sum, n) => sum + n, 0),
      ])
      .commit();
  }

  const totals = statuses.map((status) => rows.filter((r) => r.status === status).length);
  const totalRow = sheet.addRow(['All periods', ...totals, rows.length]);
  totalRow.font = { bold: true };
  totalRow.commit();

  sheet.commit();
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle' };
  row.commit();
}
