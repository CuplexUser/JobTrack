/**
 * Import — the reverse of Export.
 *
 * Two passes, both built on code Export and the duplicate checker already have:
 *
 * 1. `previewImport` classifies every row as `new`, `duplicate` (an exact match — the same
 *    rule `shouldBlockSave` uses everywhere else) or `error`, without writing anything.
 * 2. `commitImport` re-uses that exact classification and creates every `new` row through
 *    `createApplication` — the same function the web form and the REST API use, so an
 *    imported row is validated and stored identically to one typed by hand.
 *
 * A file containing the same row twice is caught too: `previewImport` tracks the
 * company+title keys it has already classified `new` within this batch, so the second copy
 * is marked `duplicate` even though the database has not seen it yet — otherwise both would
 * import, since checking the database alone cannot see a sibling row in the same upload.
 */

import {
  companyKey,
  createApplicationSchema,
  parseDateOnly,
  titleKey,
  type ApplicationStatus,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import type { SearchIndex } from '../search/index.js';
import { createApplication, type CreateApplicationData } from './applications.service.js';
import { checkDuplicates } from './duplicates.service.js';
import { statusFromLabel, type RawImportRow } from '../import/columns.js';
import { parseCsvImport } from '../import/csv.js';
import { parseXlsxImport } from '../import/workbook.js';

export type ImportFormat = 'csv' | 'xlsx';
export type RowVerdict = 'new' | 'duplicate' | 'error';

export interface PreviewedRow {
  rowNumber: number;
  sheet: string | null;
  verdict: RowVerdict;
  jobTitle: string;
  companyName: string;
  appliedOn: string;
  status: ApplicationStatus | null;
  errors: string[];
  data: CreateApplicationData | null;
}

export async function parseImportFile(
  buffer: Buffer,
  format: ImportFormat,
): Promise<{ rows: RawImportRow[]; errors: string[] }> {
  if (format === 'csv') return parseCsvImport(buffer.toString('utf8'));
  return parseXlsxImport(buffer);
}

/** Turn one raw row into validated create-application input, or the reasons it cannot be. */
function toCreateData(raw: RawImportRow): { data: CreateApplicationData | null; errors: string[] } {
  const errors: string[] = [];

  let status: ApplicationStatus = 'applied';
  if (raw.status) {
    const resolved = statusFromLabel(raw.status);
    if (!resolved) errors.push(`Unrecognized status "${raw.status}"`);
    else status = resolved;
  }

  if (!raw.date) {
    errors.push('Date is required');
  } else {
    try {
      parseDateOnly(raw.date);
    } catch {
      errors.push(`"${raw.date}" is not a YYYY-MM-DD date`);
    }
  }

  if (errors.length > 0) return { data: null, errors };

  const parsed = createApplicationSchema.safeParse({
    companyName: raw.company,
    jobTitle: raw.position,
    appliedOn: raw.date,
    status,
    jobUrl: null,
    location: null,
    workMode: 'unspecified',
    sourceName: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    followUpOn: null,
    tags: [],
    notes: raw.notes || null,
  });

  if (!parsed.success) {
    return { data: null, errors: parsed.error.issues.map((issue) => issue.message) };
  }
  return { data: parsed.data, errors: [] };
}

export async function previewImport(
  repos: Repos,
  search: SearchIndex,
  raw: readonly RawImportRow[],
): Promise<PreviewedRow[]> {
  const previewed: PreviewedRow[] = [];
  const seenInBatch = new Set<string>();

  for (const row of raw) {
    const { data, errors } = toCreateData(row);
    if (!data) {
      previewed.push({
        rowNumber: row.rowNumber,
        sheet: row.sheet,
        verdict: 'error',
        jobTitle: row.position,
        companyName: row.company,
        appliedOn: row.date,
        status: null,
        errors,
        data: null,
      });
      continue;
    }

    const batchKey = `${companyKey(data.companyName)}::${titleKey(data.jobTitle)}`;
    let verdict: RowVerdict;
    if (seenInBatch.has(batchKey)) {
      verdict = 'duplicate';
    } else {
      const duplicate = await checkDuplicates(repos, search, {
        company: data.companyName,
        title: data.jobTitle,
      });
      verdict = duplicate.verdict === 'exact' ? 'duplicate' : 'new';
    }
    if (verdict === 'new') seenInBatch.add(batchKey);

    previewed.push({
      rowNumber: row.rowNumber,
      sheet: row.sheet,
      verdict,
      jobTitle: data.jobTitle,
      companyName: data.companyName,
      appliedOn: data.appliedOn,
      status: data.status,
      errors: [],
      data,
    });
  }

  return previewed;
}

export interface CommitResult {
  created: number;
  skipped: number;
  failed: number;
  errors: { rowNumber: number; message: string }[];
}

export async function commitImport(
  repos: Repos,
  search: SearchIndex,
  raw: readonly RawImportRow[],
): Promise<CommitResult> {
  const previewed = await previewImport(repos, search, raw);

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const errors: { rowNumber: number; message: string }[] = [];

  for (const row of previewed) {
    if (row.verdict === 'duplicate') {
      skipped += 1;
      continue;
    }
    if (row.verdict === 'error' || !row.data) {
      failed += 1;
      errors.push({ rowNumber: row.rowNumber, message: row.errors.join('; ') || 'Could not be imported' });
      continue;
    }
    try {
      await createApplication(repos, row.data);
      created += 1;
    } catch (error) {
      failed += 1;
      errors.push({
        rowNumber: row.rowNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (created > 0) search.markStale();

  return { created, skipped, failed, errors };
}
