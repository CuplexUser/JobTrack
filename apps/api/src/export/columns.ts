/**
 * One column definition, used by both exports.
 *
 * Keeping CSV and XLSX pointed at the same list is what stops them drifting into two
 * subtly different reports of the same data.
 */

import {
  STATUS_LABELS,
  WORK_MODE_LABELS,
  monthName,
  type JobApplicationView,
} from '@jobtrack/shared';

export interface ExportColumn {
  header: string;
  /** Value for CSV — always a primitive. */
  value: (row: JobApplicationView) => string | number | null;
  /** Column width in characters, for the spreadsheet. */
  width: number;
  /** Excel number format, where the default text rendering would be wrong. */
  numFmt?: string;
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Applied On', value: (r) => r.appliedOn, width: 13 },
  { header: 'Year', value: (r) => r.periodYear, width: 7 },
  { header: 'Month', value: (r) => monthName(r.periodMonth), width: 11 },
  { header: 'Company', value: (r) => r.company.name, width: 28 },
  { header: 'Job Title', value: (r) => r.jobTitle, width: 32 },
  { header: 'Status', value: (r) => STATUS_LABELS[r.status], width: 12 },
  { header: 'Work Mode', value: (r) => WORK_MODE_LABELS[r.workMode], width: 12 },
  { header: 'Location', value: (r) => r.location, width: 20 },
  { header: 'Source', value: (r) => r.sourceName, width: 16 },
  { header: 'Salary Min', value: (r) => r.salaryMin, width: 12, numFmt: '#,##0' },
  { header: 'Salary Max', value: (r) => r.salaryMax, width: 12, numFmt: '#,##0' },
  { header: 'Currency', value: (r) => r.salaryCurrency, width: 10 },
  { header: 'Follow Up On', value: (r) => r.followUpOn, width: 14 },
  { header: 'Tags', value: (r) => r.tags.map((t) => t.name).join(', '), width: 26 },
  { header: 'Notes', value: (r) => r.noteCount, width: 8 },
  { header: 'Job URL', value: (r) => r.jobUrl, width: 40 },
];

/** A filename that sorts chronologically and says what it contains. */
export function exportFilename(extension: 'csv' | 'xlsx', scope: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = scope ? `-${scope}` : '';
  return `jobtrack${suffix}-${stamp}.${extension}`;
}
