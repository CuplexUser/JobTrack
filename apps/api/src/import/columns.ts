/**
 * The inverse of `export/columns.ts`: turning a spreadsheet's cells back into the fields
 * Import needs.
 *
 * Headers are matched by name rather than position, case-insensitively, so a re-imported
 * export still works if a column was ever reordered. `STATUS_LABELS` is inverted rather than
 * re-declared, so the two can never disagree about what "Interview" means.
 */

import { STATUS_LABELS, type ApplicationStatus } from '@jobtrack/shared';
import { EXPORT_COLUMNS } from '../export/columns.js';

/** The column headers Export writes, in order: Position, Company, Location, Date, Status, Notes. */
export const IMPORT_HEADERS = EXPORT_COLUMNS.map((c) => c.header);

/**
 * Headers a file must carry to be importable at all. Location is deliberately absent: it
 * was added to Export later, and a workbook produced before that should still import.
 */
export const REQUIRED_HEADERS = IMPORT_HEADERS.filter((h) => h !== 'Location');

const STATUS_BY_LABEL = new Map<string, ApplicationStatus>(
  (Object.entries(STATUS_LABELS) as [ApplicationStatus, string][]).map(([status, label]) => [
    label.toLowerCase(),
    status,
  ]),
);

/** "Interview" -> 'interview'. Case-insensitive; null when the label is not recognized. */
export function statusFromLabel(label: string): ApplicationStatus | null {
  return STATUS_BY_LABEL.get(label.trim().toLowerCase()) ?? null;
}

export interface RawImportRow {
  /** 1-based, counted across the whole file (or, for xlsx, across every sheet). */
  rowNumber: number;
  /** The worksheet a row came from, for xlsx; null for CSV. */
  sheet: string | null;
  position: string;
  company: string;
  /** Empty when the file predates the Location column, or the cell was blank. */
  location: string;
  date: string;
  status: string;
  notes: string;
}

/**
 * Match a header row against the expected columns, case-insensitively.
 *
 * Returns null when a required one is missing — a row with no `appliedOn` or no company
 * has nothing to create. Optional columns simply stay out of the map.
 */
export function mapHeaders(header: readonly string[]): Record<string, number> | null {
  const normalized = header.map((h) => h.trim().toLowerCase());
  const map: Record<string, number> = {};
  for (const name of IMPORT_HEADERS) {
    const index = normalized.indexOf(name.toLowerCase());
    if (index === -1) {
      if (REQUIRED_HEADERS.includes(name)) return null;
      continue;
    }
    map[name] = index;
  }
  return map;
}

/** True when every cell in a row is blank — a stray empty line in the spreadsheet. */
export function isBlankRow(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === '');
}

/** One data row's cells, keyed by the mapped header indexes, into the raw shape above. */
export function toRawRow(
  cells: readonly string[],
  headerMap: Record<string, number>,
  rowNumber: number,
  sheet: string | null,
): RawImportRow {
  const cell = (name: string): string => {
    const index = headerMap[name];
    return index === undefined ? '' : (cells[index] ?? '').trim();
  };
  return {
    rowNumber,
    sheet,
    position: cell('Position'),
    company: cell('Company'),
    location: cell('Location'),
    date: cell('Date'),
    status: cell('Status'),
    notes: cell('Notes'),
  };
}
