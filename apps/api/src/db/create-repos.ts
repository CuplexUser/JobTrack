/**
 * The one module that knows which database engine is underneath.
 *
 * Everything else in the API takes a `Repos` (see `repos.ts`) and cannot tell SQLite from
 * Postgres — which is the entire reason for building on repolayer. This file is where that
 * choice actually gets made, which is also why it is kept separate from `repos.ts`: `repolayer`'s
 * `createRepo` dynamically imports whichever driver `config.driver` names, and none of that
 * — nor a real database connection — has any business in a browser bundle.
 */

import { createRepo } from 'repolayer';
import type { Config, DriverName } from '../config.js';
import type { RepoBundle } from './repos.js';
import {
  applicationSchema,
  companySchema,
  jobOpeningSchema,
  noteSchema,
  searchVectorSchema,
  statusEventSchema,
  tagLinkSchema,
  tagSchema,
  type ApplicationRow,
  type CompanyRow,
  type JobOpeningRow,
  type NoteRow,
  type SearchVectorRow,
  type StatusEventRow,
  type TagLinkRow,
  type TagRow,
} from './schema.js';

/**
 * repolayer takes connection settings per driver. Repos pointed at the same SQLite file
 * share one connection automatically, which is what makes `repo.with(ctx)` work across
 * tables — a transaction that spans companies and applications is not optional here, since
 * creating an application may create its company in the same breath.
 */
function connectionFor(config: Config): Record<string, unknown> {
  switch (config.driver) {
    case 'sqlite':
      return { file: config.databaseFile, busyTimeoutMs: 5000 };
    case 'postgres':
    case 'mysql': {
      if (!config.databaseUrl) {
        throw new Error(`DATABASE_URL is required when DB_DRIVER=${config.driver}`);
      }
      return { connectionString: config.databaseUrl, max: 10 };
    }
  }
}

export async function createRepos(config: Config): Promise<RepoBundle> {
  const driver = config.driver as DriverName;
  const connection = connectionFor(config);

  // The explicit timestamp field names rather than `timestamps: true`: the SQLite adapter
  // honors the shorthand, but MemoryRepo leaves both fields null under it, so tests would
  // diverge from production on something neither would obviously report.
  const common = {
    driver,
    connection,
    ids: 'uuid',
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    ensureTable: true,
  } as const;

  // Built sequentially rather than with Promise.all: on SQLite these share one connection
  // and one writer, and racing seven CREATE TABLE statements through it buys nothing.
  const companies = await createRepo<CompanyRow>({ ...common, table: 'companies', schema: companySchema });
  const applications = await createRepo<ApplicationRow>({ ...common, table: 'job_applications', schema: applicationSchema });
  const tags = await createRepo<TagRow>({ ...common, table: 'tags', schema: tagSchema });
  const tagLinks = await createRepo<TagLinkRow>({ ...common, table: 'tag_links', schema: tagLinkSchema });
  const notes = await createRepo<NoteRow>({ ...common, table: 'notes', schema: noteSchema });
  const statusEvents = await createRepo<StatusEventRow>({ ...common, table: 'status_events', schema: statusEventSchema });
  const searchVectors = await createRepo<SearchVectorRow>({ ...common, table: 'search_vectors', schema: searchVectorSchema });
  const jobOpenings = await createRepo<JobOpeningRow>({ ...common, table: 'job_openings', schema: jobOpeningSchema });

  return {
    companies,
    applications,
    tags,
    tagLinks,
    notes,
    statusEvents,
    searchVectors,
    jobOpenings,
    async close() {
      // Closing every repo is correct even when they share a pool: repolayer closes a pool
      // it created once, and leaves one that was passed in alone.
      await Promise.allSettled([
        companies.close(),
        applications.close(),
        tags.close(),
        tagLinks.close(),
        notes.close(),
        statusEvents.close(),
        searchVectors.close(),
        jobOpenings.close(),
      ]);
    },
  };
}
