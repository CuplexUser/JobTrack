/**
 * The columns an export can carry, used by both formats.
 *
 * By default it is the short list it always was: position, company, location, date, status and
 * notes. This is a list of what you applied for, not a report about it. The other fields are
 * there for someone who wants them in their own spreadsheet, chosen in the export dialog, but
 * never switched on by default.
 *
 * Keeping CSV and XLSX pointed at the same definitions is what stops them drifting into two
 * subtly different reports of the same data.
 */

import {
  DEFAULT_EXPORT_FIELDS,
  STATUS_LABELS,
  WORK_MODE_LABELS,
  type ExportField,
} from '@jobtrack/shared';
import type { ExportRow } from './rows.js';

export interface ExportColumn {
  field: ExportField;
  header: string;
  /** Value for CSV — always a primitive. */
  value: (row: ExportRow) => string | number | null;
  /** Column width in characters, for the spreadsheet. */
  width: number;
  /** Notes run long and contain newlines, so that column wraps rather than overflowing. */
  wrap?: boolean;
}

/** "40000-50000 SEK", "40000+ SEK", "≤50000 SEK", or blank when no salary was noted. */
function salaryText(row: ExportRow): string {
  const { salaryMin: min, salaryMax: max, salaryCurrency } = row;
  if (min === null && max === null) return '';
  const currency = salaryCurrency ? ` ${salaryCurrency}` : '';
  if (min !== null && max !== null) return min === max ? `${min}${currency}` : `${min}-${max}${currency}`;
  return min !== null ? `${min}+${currency}` : `≤${max}${currency}`;
}

/** Every column, with its English header: the one an export gets when it is sent no header. */
export const COLUMN_DEFINITIONS: Record<ExportField, ExportColumn> = {
  jobTitle: { field: 'jobTitle', header: 'Position', value: (r) => r.jobTitle, width: 34 },
  company: { field: 'company', header: 'Company', value: (r) => r.company.name, width: 28 },
  // The application's own location, not the company's: the row is about where this job
  // was, which is not always where the employer is registered.
  location: { field: 'location', header: 'Location', value: (r) => r.location ?? '', width: 22 },
  appliedOn: { field: 'appliedOn', header: 'Date', value: (r) => r.appliedOn, width: 13 },
  // The label, not the stored enum value: "Rejected" rather than "rejected".
  status: { field: 'status', header: 'Status', value: (r) => STATUS_LABELS[r.status], width: 13 },
  notes: { field: 'notes', header: 'Notes', value: (r) => r.notesText, width: 70, wrap: true },
  workMode: { field: 'workMode', header: 'Work mode', value: (r) => WORK_MODE_LABELS[r.workMode], width: 13 },
  source: { field: 'source', header: 'Source', value: (r) => r.sourceName ?? '', width: 18 },
  followUpOn: { field: 'followUpOn', header: 'Follow up', value: (r) => r.followUpOn ?? '', width: 13 },
  salary: { field: 'salary', header: 'Salary', value: salaryText, width: 20 },
  jobUrl: { field: 'jobUrl', header: 'Job URL', value: (r) => r.jobUrl ?? '', width: 40 },
  tags: { field: 'tags', header: 'Tags', value: (r) => r.tags.map((tag) => tag.name).join(', '), width: 24 },
};

/** The default export, and the headers Import expects to find. */
export const EXPORT_COLUMNS: ExportColumn[] = DEFAULT_EXPORT_FIELDS.map((field) => COLUMN_DEFINITIONS[field]);

/**
 * The columns one export writes: `fields` in that order, each under its matching entry in
 * `headers`, or under its English header when that entry is missing or blank. No `fields`
 * gives the default export.
 */
export function exportColumns(fields?: readonly ExportField[], headers?: readonly string[]): ExportColumn[] {
  return (fields ?? DEFAULT_EXPORT_FIELDS).map((field, index) => {
    const column = COLUMN_DEFINITIONS[field];
    const header = headers?.[index]?.trim();
    return header ? { ...column, header } : column;
  });
}

/** A filename that sorts chronologically and says what it contains. */
export function exportFilename(extension: 'csv' | 'xlsx', scope: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = scope ? `-${scope}` : '';
  return `jobtrack${suffix}-${stamp}.${extension}`;
}
