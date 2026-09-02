/**
 * One column definition, used by both exports.
 *
 * Deliberately short: position, company, location, date, status and notes. This is a list
 * of what you applied for, not a report about it — anything analytical belongs in the app,
 * where it can be interactive, rather than frozen into a spreadsheet cell.
 *
 * Keeping CSV and XLSX pointed at the same list is what stops them drifting into two
 * subtly different reports of the same data.
 */

import { STATUS_LABELS } from '@jobtrack/shared';
import type { ExportRow } from './rows.js';

export interface ExportColumn {
  header: string;
  /** Value for CSV — always a primitive. */
  value: (row: ExportRow) => string | number | null;
  /** Column width in characters, for the spreadsheet. */
  width: number;
  /** Notes run long and contain newlines, so that column wraps rather than overflowing. */
  wrap?: boolean;
}

export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'Position', value: (r) => r.jobTitle, width: 34 },
  { header: 'Company', value: (r) => r.company.name, width: 28 },
  // The application's own location, not the company's: the row is about where this job
  // was, which is not always where the employer is registered.
  { header: 'Location', value: (r) => r.location ?? '', width: 22 },
  { header: 'Date', value: (r) => r.appliedOn, width: 13 },
  // The label, not the stored enum value: "Rejected" rather than "rejected".
  { header: 'Status', value: (r) => STATUS_LABELS[r.status], width: 13 },
  { header: 'Notes', value: (r) => r.notesText, width: 70, wrap: true },
];

/** A filename that sorts chronologically and says what it contains. */
export function exportFilename(extension: 'csv' | 'xlsx', scope: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = scope ? `-${scope}` : '';
  return `jobtrack${suffix}-${stamp}.${extension}`;
}
