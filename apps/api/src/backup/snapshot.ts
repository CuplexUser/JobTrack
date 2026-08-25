/**
 * Full-fidelity snapshot of every table, for reset/backup/restore and for migrating between
 * drivers (export from SQLite, import into Postgres).
 *
 * Deliberately separate from `export/` and `import/`, which produce and read the CSV/XLSX
 * report a person reads — "Position, Company, Date, Status, Notes" (see
 * `export/columns.ts`) — a format that's lossy on purpose. This one is meant to be read back
 * by this same app and reconstruct every row exactly, including ids (so relations survive)
 * and every field on every table.
 *
 * `searchVectors` is deliberately excluded: it's fully derived from the other tables' text
 * (`search/index.ts`'s `#composeDocs` + `#refreshVectors`), so there is nothing in it that
 * isn't recomputable, and restoring it verbatim would risk keeping an embedding model's
 * output around after a restore onto a machine using a different model.
 *
 * One known, unavoidable gap: repolayer stamps `createdAt`/`updatedAt` to "now" on every
 * `create`, with no way to pass a value through (see its `prepareInsert`). A restored row's
 * timestamps reflect when it was restored, not when it was originally created. Everything
 * else round-trips exactly.
 */

import type { Repo, TxContext } from 'repolayer';
import { scopedRepos, type Repos } from '../db/repos.js';
import type {
  ApplicationRow,
  CompanyRow,
  JobOpeningRow,
  NoteRow,
  StatusEventRow,
  TagLinkRow,
  TagRow,
} from '../db/schema.js';
import type { SearchIndex } from '../search/index.js';
import { badRequest } from '../lib/errors.js';

export const BACKUP_FORMAT = 'jobtrack-backup' as const;
export const BACKUP_VERSION = 1 as const;

export const BACKUP_TABLES = [
  'companies',
  'applications',
  'tags',
  'tagLinks',
  'notes',
  'statusEvents',
  'jobOpenings',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

interface BackupRowTypes {
  companies: CompanyRow;
  applications: ApplicationRow;
  tags: TagRow;
  tagLinks: TagLinkRow;
  notes: NoteRow;
  statusEvents: StatusEventRow;
  jobOpenings: JobOpeningRow;
}

export interface BackupSnapshot {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  tables: { [K in BackupTable]: BackupRowTypes[K][] };
}

/** Which fields on each table are `date`-typed, and so need reviving from an ISO string on import. */
const DATE_FIELDS: { [K in BackupTable]: (keyof BackupRowTypes[K])[] } = {
  companies: ['createdAt', 'updatedAt'],
  applications: ['appliedOn', 'followUpOn', 'createdAt', 'updatedAt'],
  tags: ['createdAt', 'updatedAt'],
  tagLinks: ['createdAt', 'updatedAt'],
  notes: ['createdAt', 'updatedAt'],
  statusEvents: ['occurredOn', 'createdAt', 'updatedAt'],
  jobOpenings: ['savedOn', 'createdAt', 'updatedAt'],
};

export async function createSnapshot(repos: Repos): Promise<BackupSnapshot> {
  const [companies, applications, tags, tagLinks, notes, statusEvents, jobOpenings] = await Promise.all([
    repos.companies.findMany({}),
    repos.applications.findMany({}),
    repos.tags.findMany({}),
    repos.tagLinks.findMany({}),
    repos.notes.findMany({}),
    repos.statusEvents.findMany({}),
    repos.jobOpenings.findMany({}),
  ]);

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables: { companies, applications, tags, tagLinks, notes, statusEvents, jobOpenings },
  };
}

/** `toDb` rejects a plain string for a `date` field — every date has to become a `Date` again. */
function reviveDates<T extends BackupTable>(table: T, rows: BackupRowTypes[T][]): BackupRowTypes[T][] {
  const fields = DATE_FIELDS[table];
  return rows.map((row) => {
    const revived: Record<string, unknown> = { ...row };
    for (const field of fields) {
      const value = revived[field as string];
      if (typeof value === 'string') revived[field as string] = new Date(value);
    }
    return revived as BackupRowTypes[T];
  });
}

/**
 * Checks the shape without touching the database, so a garbage upload fails with a clear
 * message before anything is deleted.
 */
export function validateSnapshot(input: unknown): BackupSnapshot {
  if (typeof input !== 'object' || input === null) throw badRequest('This file is not a JobTrack backup');

  const format = (input as { format?: unknown }).format;
  if (format !== BACKUP_FORMAT) throw badRequest('This file is not a JobTrack backup');

  const version = (input as { version?: unknown }).version;
  if (version !== BACKUP_VERSION) {
    throw badRequest(
      `This backup is format version ${String(version)}, but this build only reads version ${BACKUP_VERSION}`,
    );
  }

  const tables = (input as { tables?: unknown }).tables;
  if (typeof tables !== 'object' || tables === null) throw badRequest('This file is not a JobTrack backup');
  for (const table of BACKUP_TABLES) {
    if (!Array.isArray((tables as Record<string, unknown>)[table])) {
      throw badRequest(`This backup is missing its "${table}" table`);
    }
  }

  return input as BackupSnapshot;
}

export function countRows(snapshot: BackupSnapshot): Record<BackupTable, number> {
  const counts = {} as Record<BackupTable, number>;
  for (const table of BACKUP_TABLES) counts[table] = snapshot.tables[table].length;
  return counts;
}

export interface RestoreResult {
  counts: Record<BackupTable, number>;
}

/** Every table's repo, typed generically — the one place this module needs a cast, since `Repos` has no index signature. */
function anyRepo(repos: Repos, table: BackupTable): Repo<Record<string, unknown>> {
  return repos[table] as unknown as Repo<Record<string, unknown>>;
}

/** How many rows each backed-up table holds right now — drives the "is this empty?" check and the Clear confirmation. */
export async function currentCounts(repos: Repos): Promise<Record<BackupTable, number>> {
  const counts = {} as Record<BackupTable, number>;
  await Promise.all(
    BACKUP_TABLES.map(async (table) => {
      counts[table] = await anyRepo(repos, table).count();
    }),
  );
  return counts;
}

export function isEmpty(counts: Record<BackupTable, number>): boolean {
  return Object.values(counts).every((count) => count === 0);
}

export interface ClearResult {
  counts: Record<BackupTable, number>;
}

/** Wipes every backed-up table, in one transaction, without recreating anything. */
export async function clearDatabase(repos: Repos, search: SearchIndex): Promise<ClearResult> {
  const counts = {} as Record<BackupTable, number>;

  await repos.companies.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);
    for (const table of BACKUP_TABLES) {
      counts[table] = await anyRepo(scoped, table).deleteMany();
    }
  });

  search.markStale();

  return { counts };
}

/**
 * Wipes every backed-up table and recreates it from the snapshot, in one transaction — a
 * restore replaces the active database, it does not merge into it.
 */
export async function restoreSnapshot(
  repos: Repos,
  search: SearchIndex,
  snapshot: BackupSnapshot,
): Promise<RestoreResult> {
  const counts = countRows(snapshot);

  await repos.companies.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);

    for (const table of BACKUP_TABLES) {
      await anyRepo(scoped, table).deleteMany();
    }
    for (const table of BACKUP_TABLES) {
      const rows = reviveDates(table, snapshot.tables[table]);
      if (rows.length > 0) await anyRepo(scoped, table).createMany(rows as unknown as Record<string, unknown>[]);
    }
  });

  search.markStale();

  return { counts };
}
