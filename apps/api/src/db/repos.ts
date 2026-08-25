/**
 * The one module that knows which database engine is underneath.
 *
 * Everything else in the API takes a `Repos` and cannot tell SQLite from Postgres — which
 * is the entire reason for building on repolayer. The type of `Repos` is deliberately
 * expressed in terms of `Repo<T>`, so a service written against it can be handed the
 * in-memory fake in tests with no ceremony at all (see test/support/repos.ts).
 */

import { createRepo, type Repo, type TxContext } from 'repolayer';
import type { Config, DriverName } from '../config.js';
import {
  applicationSchema,
  companySchema,
  noteSchema,
  searchVectorSchema,
  statusEventSchema,
  tagLinkSchema,
  tagSchema,
  type ApplicationRow,
  type CompanyRow,
  type NoteRow,
  type SearchVectorRow,
  type StatusEventRow,
  type TagLinkRow,
  type TagRow,
} from './schema.js';

export interface Repos {
  companies: Repo<CompanyRow>;
  applications: Repo<ApplicationRow>;
  tags: Repo<TagRow>;
  tagLinks: Repo<TagLinkRow>;
  notes: Repo<NoteRow>;
  statusEvents: Repo<StatusEventRow>;
  searchVectors: Repo<SearchVectorRow>;
}

export interface RepoBundle extends Repos {
  close(): Promise<void>;
}

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
  // honours the shorthand, but MemoryRepo leaves both fields null under it, so tests would
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

  return {
    companies,
    applications,
    tags,
    tagLinks,
    notes,
    statusEvents,
    searchVectors,
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
      ]);
    },
  };
}

/**
 * Rebind every repo to a transaction.
 *
 * Creating an application can create its company and several tags at the same time; if any
 * of that fails, none of it should survive. repolayer expresses this with `repo.with(ctx)`,
 * and this helper saves every service from threading the context through by hand. Passing
 * `undefined` returns the bundle unchanged, so a service can take an optional context and
 * work identically inside or outside a transaction.
 */
export function scopedRepos(repos: Repos, ctx: TxContext | undefined): Repos {
  if (!ctx) return repos;
  return {
    companies: repos.companies.with(ctx),
    applications: repos.applications.with(ctx),
    tags: repos.tags.with(ctx),
    tagLinks: repos.tagLinks.with(ctx),
    notes: repos.notes.with(ctx),
    statusEvents: repos.statusEvents.with(ctx),
    searchVectors: repos.searchVectors.with(ctx),
  };
}
