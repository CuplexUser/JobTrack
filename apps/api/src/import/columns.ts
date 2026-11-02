/**
 * The inverse of `export/columns.ts`: turning a spreadsheet's cells back into the fields
 * Import needs.
 *
 * Headers are matched by name rather than position, case-insensitively, so a re-imported
 * export still works if a column was ever reordered. Each column answers to its English
 * export header, the header the export dialog gives it in every UI language, and a few
 * common hand-typed names. Columns Import has no use for (tags, salary, ...) are ignored.
 * `STATUS_LABELS` is inverted rather than re-declared, so the two can never disagree about
 * what "Interview" means.
 */

import { STATUS_LABELS, type ApplicationStatus } from '@jobtrack/shared';

/** The fields Import reads, which are the fields of the default export. */
export const IMPORT_FIELDS = ['jobTitle', 'company', 'location', 'appliedOn', 'status', 'notes'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * Every header each field is recognized under, the English export header first. Keep the
 * export dialog's default headers in here (`export.field.*` in the web app's `applications`
 * locale files): a test reads those files and fails when one is missing.
 */
export const IMPORT_HEADER_NAMES: Record<ImportField, readonly string[]> = {
  jobTitle: ['Position', 'Role', 'Job title', 'Title', 'Roll', 'Titel', 'Tjänst', 'Befattning'],
  company: ['Company', 'Employer', 'Företag', 'Arbetsgivare'],
  location: ['Location', 'City', 'Ort', 'Plats', 'Stad'],
  appliedOn: ['Date', 'Applied', 'Applied on', 'Datum', 'Ansökt', 'Ansökningsdatum'],
  status: ['Status'],
  notes: ['Notes', 'Anteckningar'],
};

/**
 * Fields a file must carry to be importable at all: a row without a role, a company or a
 * date has nothing to create. Everything else is optional, so an export with only the
 * columns someone picked still imports: a blank status reads as Applied.
 */
export const REQUIRED_FIELDS: readonly ImportField[] = ['jobTitle', 'company', 'appliedOn'];

/** "Position, Company, Date", for the message about a file missing one. */
export const REQUIRED_HEADERS = REQUIRED_FIELDS.map((field) => IMPORT_HEADER_NAMES[field][0]!);

const FIELD_BY_HEADER = new Map<string, ImportField>(
  IMPORT_FIELDS.flatMap((field) => IMPORT_HEADER_NAMES[field].map((name): [string, ImportField] => [name.toLowerCase(), field])),
);

/** Labels earlier versions exported, so their workbooks still import. */
const LEGACY_STATUS_LABELS: [string, ApplicationStatus][] = [['screening', 'screening']];

const STATUS_BY_LABEL = new Map<string, ApplicationStatus>([
  ...LEGACY_STATUS_LABELS,
  ...(Object.entries(STATUS_LABELS) as [ApplicationStatus, string][]).map(
    ([status, label]): [string, ApplicationStatus] => [label.toLowerCase(), status],
  ),
]);

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
  /** Empty when the file has no location column, or the cell was blank. Likewise status and notes. */
  location: string;
  date: string;
  status: string;
  notes: string;
}

/**
 * Match a header row against the import fields, case-insensitively.
 *
 * Returns null when a required one is missing. Optional fields simply stay out of the map.
 * When two columns answer to the same field, the leftmost one wins.
 */
export function mapHeaders(header: readonly string[]): Partial<Record<ImportField, number>> | null {
  const map: Partial<Record<ImportField, number>> = {};
  header.forEach((name, index) => {
    const field = FIELD_BY_HEADER.get(name.trim().toLowerCase());
    if (field && map[field] === undefined) map[field] = index;
  });
  return REQUIRED_FIELDS.every((field) => map[field] !== undefined) ? map : null;
}

/** True when every cell in a row is blank — a stray empty line in the spreadsheet. */
export function isBlankRow(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === '');
}

/** One data row's cells, keyed by the mapped header indexes, into the raw shape above. */
export function toRawRow(
  cells: readonly string[],
  headerMap: Partial<Record<ImportField, number>>,
  rowNumber: number,
  sheet: string | null,
): RawImportRow {
  const cell = (field: ImportField): string => {
    const index = headerMap[field];
    return index === undefined ? '' : (cells[index] ?? '').trim();
  };
  return {
    rowNumber,
    sheet,
    position: cell('jobTitle'),
    company: cell('company'),
    location: cell('location'),
    date: cell('appliedOn'),
    status: cell('status'),
    notes: cell('notes'),
  };
}
