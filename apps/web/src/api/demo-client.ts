/**
 * The client-side demo: every route in `apps/api/src/routes/*.routes.ts`, reimplemented as
 * direct in-process calls instead of `fetch`, running against `repolayer/memory` instead of
 * SQLite. No server, no network — this is what `VITE_DEMO=true` swaps `httpApi` for (see
 * `index.ts`), so it must match `httpApi`'s shape exactly (enforced below via
 * `typeof httpApi`) and, method for method, reuse the same `@jobtrack/api` services the real
 * server runs — never a reimplementation of the business logic, only of the transport.
 *
 * Three things a real deployment gets for free that this has to do itself:
 *
 * - **Persistence.** There is no database file. `createSnapshot`/`restoreSnapshot` from
 *   `@jobtrack/api/backup/snapshot` — already written for the `.jtbak` backup feature — do
 *   the same job against `localStorage` instead of a downloaded file: every mutation writes
 *   a fresh snapshot, and startup restores the last one (or seeds the demo dataset when
 *   there isn't one yet).
 * - **Errors.** A real request either resolves or the server's error handler
 *   (`lib/errors.ts`) turns whatever was thrown into a JSON error body, which `client.ts`'s
 *   `request()` turns back into an `ApiError`. There is no HTTP round trip here, so
 *   `toApiError` below does that same translation directly.
 * - **The features a browser genuinely cannot do.** XLSX import/export needs `exceljs`,
 *   which does not belong in a client bundle; the `.jtbak` backup format needs `node:zlib`;
 *   multi-database switching needs a process to restart. Each is either narrowed to what a
 *   browser *can* do (XLSX -> CSV-only) or clearly rejected — see the comments at each of
 *   those methods.
 */

import { ZodError } from 'zod';
import { NotFoundError, QueryError, UniqueConstraintError } from 'repolayer';
import {
  applicationFilterSchema,
  changeStatusSchema,
  companyKey,
  convertJobOpeningSchema,
  createApplicationSchema,
  createJobOpeningSchema,
  createNoteSchema,
  duplicateCheckSchema,
  exportQuerySchema,
  monthName,
  noteTargetSchema,
  parseDateOnly,
  patchApplicationSchema,
  patchCompanySchema,
  patchJobOpeningSchema,
  parsePostingText,
  patchNoteSchema,
  postingDraftSchema,
  searchQuerySchema,
  titleKey,
  toCsvLines,
  type ApplicationStatus,
} from '@jobtrack/shared';

import { createMemoryRepos } from '@jobtrack/api/db/memory-repos';
import type { Repos, RepoBundle } from '@jobtrack/api/db/repos';
import { hydrateApplications } from '@jobtrack/api/db/hydrate';
import { toCompany, toNote } from '@jobtrack/api/db/mappers';
import { SearchIndex } from '@jobtrack/api/search';
import { FakeEmbedder } from '@jobtrack/api/search/embedder';
import {
  changeStatus,
  computePeriods,
  createApplication,
  deleteApplication,
  findAllMatching,
  getApplication,
  listApplications,
  patchApplication,
  type CreateApplicationData,
} from '@jobtrack/api/services/applications';
import { getCompanyWithTags, listCompanies, suggestCompanies, updateCompany } from '@jobtrack/api/services/companies';
import { checkDuplicates } from '@jobtrack/api/services/duplicates';
import { createNote, deleteNote, listNotes, updateNote } from '@jobtrack/api/services/notes';
import { listTags } from '@jobtrack/api/services/tags';
import { getDashboard } from '@jobtrack/api/services/dashboard';
import {
  convertOpening,
  createOpening,
  deleteOpening,
  getOpening,
  listOpenings,
  updateOpening,
} from '@jobtrack/api/services/openings';
import {
  clearDatabase,
  createSnapshot,
  currentCounts,
  isEmpty,
  restoreSnapshot,
  validateSnapshot,
} from '@jobtrack/api/backup/snapshot';
import { seedDemoData } from '@jobtrack/api/backup/seed';
import { parseCsvImport } from '@jobtrack/api/import/csv';
import { statusFromLabel, type RawImportRow } from '@jobtrack/api/import/columns';
import { withNotes } from '@jobtrack/api/export/rows';
import { EXPORT_COLUMNS, exportFilename } from '@jobtrack/api/export/columns';

import { ApiError, httpApi, type ImportCommitResponse, type ImportPreviewResponse, type ImportPreviewRow } from './client.js';

const STORAGE_KEY = 'jobtrack-demo-v1';

// ---------------------------------------------------------------- errors

/** Mirrors `apps/api/src/lib/errors.ts`'s `toErrorBody`, minus the HTTP transport. */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) {
    return new ApiError(
      400,
      'validation_error',
      'The request body or query is not valid',
      error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  if (error instanceof UniqueConstraintError) return new ApiError(409, 'conflict', 'That record already exists');
  if (error instanceof NotFoundError) return new ApiError(404, 'not_found', 'Not found');
  if (error instanceof QueryError) return new ApiError(400, 'bad_query', error.message);
  return new ApiError(500, 'internal_error', 'Something went wrong');
}

const notFound = (message = 'Not found'): ApiError => new ApiError(404, 'not_found', message);
const unsupported = (message: string): ApiError => new ApiError(400, 'unsupported_in_demo', message);

/** Every demo method runs through this, so one place turns a thrown error into an `ApiError`. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toApiError(error);
  }
}

// ---------------------------------------------------------------- state + persistence

interface DemoState {
  repos: RepoBundle;
  search: SearchIndex;
}

let statePromise: Promise<DemoState> | null = null;

function getState(): Promise<DemoState> {
  statePromise ??= init();
  return statePromise;
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private browsing, disabled storage, etc. — the demo still runs in-memory.
  }
}

function writeStorage(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage full or unavailable. The current session keeps working; only persistence is lost.
  }
}

async function init(): Promise<DemoState> {
  const repos = createMemoryRepos();
  const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });

  const raw = readStorage();
  let restored = false;
  if (raw) {
    try {
      await restoreSnapshot(repos, search, validateSnapshot(JSON.parse(raw)));
      restored = true;
    } catch {
      // A corrupt or foreign value in localStorage — fall through and reseed rather than
      // leaving the demo empty.
    }
  }
  if (!restored) await seedDemoData(repos);

  await search.start();
  await search.whenSemanticReady();

  return { repos, search };
}

/** Snapshot every table and write it, so the next page load picks up where this one left off. */
async function persist(repos: Repos): Promise<void> {
  const snapshot = await createSnapshot(repos);
  writeStorage(JSON.stringify(snapshot));
}

// ---------------------------------------------------------------- import (CSV only — see commitImport)

/** Port of `apps/api/src/services/import.service.ts`'s row classification, minus the XLSX
 * path — kept local rather than imported so the demo bundle never references
 * `import/workbook.ts`, which pulls in `exceljs`. */
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
    location: raw.location || null,
    workMode: 'unspecified',
    sourceName: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    followUpOn: null,
    tags: [],
    notes: raw.notes || null,
  });

  if (!parsed.success) return { data: null, errors: parsed.error.issues.map((issue) => issue.message) };
  return { data: parsed.data, errors: [] };
}

interface DemoPreviewedRow extends ImportPreviewRow {
  data: CreateApplicationData | null;
}

async function demoPreviewRows(repos: Repos, search: SearchIndex, raw: readonly RawImportRow[]): Promise<DemoPreviewedRow[]> {
  const previewed: DemoPreviewedRow[] = [];
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
    let verdict: ImportPreviewRow['verdict'];
    if (seenInBatch.has(batchKey)) {
      verdict = 'duplicate';
    } else {
      const duplicate = await checkDuplicates(repos, search, { company: data.companyName, title: data.jobTitle });
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

// ---------------------------------------------------------------- CSV export (used by ApplicationsPage in demo mode)

/** A short filename hint describing what was exported — mirrors `export.routes.ts`'s scope logic. */
function describeExportScope(query: { year?: number; month?: number; q?: string }): string {
  if (query.q) return 'search';
  if (query.year && query.month) return `${query.year}-${monthName(query.month).toLowerCase()}`;
  if (query.year) return String(query.year);
  return '';
}

/**
 * Builds the same CSV `GET /api/export?format=csv` would, entirely client-side. Exported
 * separately from `demoApi` (not through `exportUrl`, which is synchronous) — `ApplicationsPage`
 * calls this directly in demo mode. XLSX export is not offered in the demo; see that page.
 */
export async function demoExportCsv(filter: Record<string, unknown>): Promise<{ filename: string; blob: Blob }> {
  return guarded(async () => {
    const { repos, search } = await getState();
    const query = exportQuerySchema.parse({ ...filter, format: 'csv' });

    let matched;
    if (query.q) {
      const outcome = await search.search(query.q, { limit: 500, types: ['application'] });
      const result = await listApplications(repos, { ...query, limit: 200 }, { orderedIds: outcome.hits.map((hit) => hit.entityId) });
      matched = result.items;
    } else {
      matched = await findAllMatching(repos, query);
    }

    const rows = await withNotes(repos, matched);
    const text = [...toCsvLines(rows, EXPORT_COLUMNS, { bom: true })].join('');
    return {
      filename: exportFilename('csv', describeExportScope(query)),
      blob: new Blob([text], { type: 'text/csv;charset=utf-8' }),
    };
  });
}

// ---------------------------------------------------------------- the api

export const demoApi: typeof httpApi = {
  listApplications: (filter) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const parsed = applicationFilterSchema.parse(filter);

      let orderedIds: string[] | null = null;
      let semanticReady = search.semanticReady;
      if (parsed.q) {
        const outcome = await search.search(parsed.q, { limit: 200, types: ['application'] });
        orderedIds = outcome.hits.map((hit) => hit.entityId);
        semanticReady = outcome.semanticReady;
      }

      const result = await listApplications(repos, parsed, { orderedIds });
      return { ...result, searched: Boolean(parsed.q), semanticReady };
    }),

  getApplication: (id) =>
    guarded(async () => {
      const { repos } = await getState();
      const application = await getApplication(repos, id);
      if (!application) throw notFound('No such application');
      return application;
    }),

  periods: () =>
    guarded(async () => {
      const { repos } = await getState();
      return { periods: await computePeriods(repos, {}) };
    }),

  checkDuplicates: (params) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const input = duplicateCheckSchema.parse(params);
      return checkDuplicates(repos, search, input);
    }),

  createApplication: (body) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const input = createApplicationSchema.parse(body);
      const created = await createApplication(repos, input);
      search.markStale();
      await persist(repos);
      return created;
    }),

  updateApplication: (id, body) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const patch = patchApplicationSchema.parse(body);
      const updated = await patchApplication(repos, id, patch);
      if (!updated) throw notFound('No such application');
      search.markStale();
      await persist(repos);
      return updated;
    }),

  changeStatus: (id, body) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const input = changeStatusSchema.parse(body);
      const updated = await changeStatus(repos, id, input);
      if (!updated) throw notFound('No such application');
      search.markStale();
      await persist(repos);
      return updated;
    }),

  deleteApplication: (id) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const removed = await deleteApplication(repos, id);
      if (!removed) throw notFound('No such application');
      search.markStale();
      await persist(repos);
    }),

  listCompanies: (params = {}) =>
    guarded(async () => {
      const { repos } = await getState();
      const archived = typeof params.archived === 'string' ? params.archived : undefined;
      const q = typeof params.q === 'string' ? params.q : undefined;
      return {
        companies: await listCompanies(repos, {
          includeArchived: archived === 'true' || archived === 'all',
          ...(q ? { search: q } : {}),
        }),
      };
    }),

  suggestCompanies: (q) =>
    guarded(async () => {
      const { repos } = await getState();
      return { companies: await suggestCompanies(repos, q, 8) };
    }),

  getCompany: (id) =>
    guarded(async () => {
      const { repos } = await getState();
      const company = await getCompanyWithTags(repos, id);
      if (!company) throw notFound('No such company');
      const filter = applicationFilterSchema.parse({ companyId: id, limit: '200', archived: 'all' });
      const applications = await listApplications(repos, filter);
      return { company, applications: applications.items };
    }),

  updateCompany: (id, body) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const patch = patchCompanySchema.parse(body);
      const company = await updateCompany(repos, id, patch);
      search.markStale();
      await persist(repos);
      return company;
    }),

  listTags: () =>
    guarded(async () => {
      const { repos } = await getState();
      return { tags: await listTags(repos) };
    }),

  listNotes: (params = {}) =>
    guarded(async () => {
      const { repos } = await getState();
      const targetType = typeof params.targetType === 'string' ? noteTargetSchema.parse(params.targetType) : undefined;
      const targetId = typeof params.targetId === 'string' ? params.targetId : undefined;
      return { notes: await listNotes(repos, { ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) }) };
    }),

  createNote: (body) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const input = createNoteSchema.parse(body);
      const note = await createNote(repos, input);
      search.markStale();
      await persist(repos);
      return note;
    }),

  updateNote: (id, body) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const patch = patchNoteSchema.parse(body);
      const note = await updateNote(repos, id, patch);
      if (!note) throw notFound('No such note');
      search.markStale();
      await persist(repos);
      return note;
    }),

  deleteNote: (id) =>
    guarded(async () => {
      const { repos, search } = await getState();
      if (!(await deleteNote(repos, id))) throw notFound('No such note');
      search.markStale();
      await persist(repos);
    }),

  dashboard: () =>
    guarded(async () => {
      const { repos } = await getState();
      return getDashboard(repos);
    }),

  search: (q, types) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const query = searchQuerySchema.parse({ q, limit: 25, types });
      const outcome = await search.search(query.q, { limit: query.limit, ...(query.types ? { types: query.types } : {}) });

      const idsOf = (type: string) => outcome.hits.filter((h) => h.type === type).map((h) => h.entityId);
      const applicationIds = idsOf('application');
      const companyIds = idsOf('company');
      const noteIds = idsOf('note');

      const [applicationRows, companyRows, noteRows] = await Promise.all([
        applicationIds.length ? repos.applications.findMany({ where: [{ field: 'id', op: 'in', value: applicationIds }] }) : Promise.resolve([]),
        companyIds.length ? repos.companies.findMany({ where: [{ field: 'id', op: 'in', value: companyIds }] }) : Promise.resolve([]),
        noteIds.length ? repos.notes.findMany({ where: [{ field: 'id', op: 'in', value: noteIds }] }) : Promise.resolve([]),
      ]);

      const applications = new Map((await hydrateApplications(repos, applicationRows)).map((a) => [a.id, a]));
      const companies = new Map(companyRows.map((c) => [c.id, toCompany(c)]));
      const notes = new Map(noteRows.map((n) => [n.id, toNote(n)]));

      const results = outcome.hits
        .map((hit) => {
          const record =
            hit.type === 'application' ? applications.get(hit.entityId) : hit.type === 'company' ? companies.get(hit.entityId) : notes.get(hit.entityId);
          return record ? { ...hit, record } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      return { results, semanticReady: outcome.semanticReady, query: query.q };
    }),

  /** Synchronous by contract, so it cannot do the async CSV build itself — see `demoExportCsv`,
   * which `ApplicationsPage` calls directly in demo mode. XLSX export is hidden there too. */
  exportUrl: () => '#',

  previewImport: (file, format) =>
    guarded(async () => {
      if (format === 'xlsx') throw unsupported('Excel import is not available in this demo — please use a CSV file instead.');
      const { repos, search } = await getState();
      const text = await file.text();
      const { rows, errors } = parseCsvImport(text);
      const previewed = await demoPreviewRows(repos, search, rows);
      const totals = {
        new: previewed.filter((r) => r.verdict === 'new').length,
        duplicate: previewed.filter((r) => r.verdict === 'duplicate').length,
        error: previewed.filter((r) => r.verdict === 'error').length,
      };
      const wireRows: ImportPreviewRow[] = previewed.map(({ data: _data, ...rest }) => rest);
      return { mode: 'preview', fileErrors: errors, totals, rows: wireRows } satisfies ImportPreviewResponse;
    }),

  commitImport: (file, format) =>
    guarded(async () => {
      if (format === 'xlsx') throw unsupported('Excel import is not available in this demo — please use a CSV file instead.');
      const { repos, search } = await getState();
      const text = await file.text();
      const { rows, errors } = parseCsvImport(text);
      const previewed = await demoPreviewRows(repos, search, rows);

      let created = 0;
      let skipped = 0;
      let failed = 0;
      const rowErrors: { rowNumber: number; message: string }[] = [];

      for (const row of previewed) {
        if (row.verdict === 'duplicate') {
          skipped += 1;
          continue;
        }
        if (row.verdict === 'error' || !row.data) {
          failed += 1;
          rowErrors.push({ rowNumber: row.rowNumber, message: row.errors.join('; ') || 'Could not be imported' });
          continue;
        }
        try {
          await createApplication(repos, row.data);
          created += 1;
        } catch (error) {
          failed += 1;
          rowErrors.push({ rowNumber: row.rowNumber, message: error instanceof Error ? error.message : String(error) });
        }
      }

      if (created > 0) search.markStale();
      await persist(repos);
      return { mode: 'commit', fileErrors: errors, created, skipped, failed, errors: rowErrors } satisfies ImportCommitResponse;
    }),

  listOpenings: (params = {}) =>
    guarded(async () => {
      const { repos } = await getState();
      const archived = typeof params.archived === 'string' && params.archived === 'true';
      return { openings: await listOpenings(repos, { includeArchived: archived }) };
    }),

  getOpening: (id) =>
    guarded(async () => {
      const { repos } = await getState();
      const opening = await getOpening(repos, id);
      if (!opening) throw notFound('No such opening');
      return opening;
    }),

  createOpening: (body) =>
    guarded(async () => {
      const { repos } = await getState();
      const input = createJobOpeningSchema.parse(body);
      const opening = await createOpening(repos, input);
      await persist(repos);
      return opening;
    }),

  updateOpening: (id, body) =>
    guarded(async () => {
      const { repos } = await getState();
      const patch = patchJobOpeningSchema.parse(body);
      const opening = await updateOpening(repos, id, patch);
      if (!opening) throw notFound('No such opening');
      await persist(repos);
      return opening;
    }),

  deleteOpening: (id) =>
    guarded(async () => {
      const { repos } = await getState();
      if (!(await deleteOpening(repos, id))) throw notFound('No such opening');
      await persist(repos);
    }),

  /**
   * Capture, minus the half a browser cannot do.
   *
   * Pasted text works exactly as it does on a server — `parsePostingText` is shared code
   * with no network in it. Fetching a URL does not and cannot: a static page has no way to
   * read a job site cross-origin, which is a browser security boundary rather than a gap in
   * the demo, so it says so instead of failing obscurely.
   */
  ingestUrl: () =>
    guarded(async () => {
      throw unsupported(
        'Reading a link is not available in this demo — a page in your browser cannot fetch another site. Paste the posting text instead.',
      );
    }),

  ingestText: (text, url) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const draft = parsePostingText(text, url);
      const duplicate =
        draft.companyName.trim() === ''
          ? {
              verdict: 'none' as const,
              companyMatched: false,
              matches: [],
              priorCount: 0,
              company: null,
              semanticUsed: false,
            }
          : await checkDuplicates(repos, search, { company: draft.companyName, title: draft.jobTitle });
      return { draft, duplicate };
    }),

  clipPosting: (body) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const draft = postingDraftSchema.parse(body);
      const duplicate = await checkDuplicates(repos, search, {
        company: draft.companyName,
        title: draft.jobTitle,
      });
      const opening = await createOpening(repos, { ...draft, savedOn: undefined });
      await persist(repos);
      return { draft, duplicate, opening };
    }),

  convertOpening: (id, body) =>
    guarded(async () => {
      const { repos, search } = await getState();
      const input = convertJobOpeningSchema.parse(body);
      const application = await convertOpening(repos, id, input);
      if (!application) throw notFound('No such opening');
      search.markStale();
      await persist(repos);
      return application;
    }),

  /** Only one target ever exists in the demo, which is what makes `DatabaseCard`'s switch UI
   * hide itself (it only renders when more than one target is configured) — `switchDb` below
   * is unreachable in practice. */
  getDbTargets: () => guarded(async () => ({ targets: [{ name: 'demo', driver: 'sqlite' as const }], active: 'demo' })),

  switchDb: () => guarded(async () => {
    throw unsupported('Switching databases is not available in this demo.');
  }),

  /** Never read: `SettingsPage` hides the "Backup & restore" card entirely in demo mode,
   * since the `.jtbak` format needs `node:zlib`, which does not belong in a browser bundle. */
  backupExportUrl: '#',

  previewBackup: () =>
    guarded(async () => {
      throw unsupported('Backup restore is not available in this demo.');
    }),

  commitBackup: () =>
    guarded(async () => {
      throw unsupported('Backup restore is not available in this demo.');
    }),

  getDataStatus: () =>
    guarded(async () => {
      const { repos } = await getState();
      const counts = await currentCounts(repos);
      return { counts, empty: isEmpty(counts) };
    }),

  clearDatabase: () =>
    guarded(async () => {
      const { repos, search } = await getState();
      const result = await clearDatabase(repos, search);
      await persist(repos);
      return result;
    }),

  seedDatabase: () =>
    guarded(async () => {
      const { repos } = await getState();
      const counts = await currentCounts(repos);
      if (!isEmpty(counts)) throw new ApiError(409, 'conflict', 'The active database is not empty — clear it first');
      const result = await seedDemoData(repos);
      await persist(repos);
      return result;
    }),

  /**
   * There is no installed package and no server process to report a version for — this is a
   * static bundle running entirely in the visitor's tab. Says so rather than inventing a
   * number; `SettingsPage`'s About card renders the driver as the in-memory store it is.
   */
  getMeta: () => guarded(async () => ({ name: 'jobtrack', version: 'demo', driver: 'memory' })),
};
