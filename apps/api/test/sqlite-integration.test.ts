/**
 * One suite against a real `node:sqlite` file.
 *
 * Everything else in this directory runs on MemoryRepo, which is fast and trustworthy —
 * but it is still a fake, and it cannot prove that `ensureTable()` emits DDL a real engine
 * accepts, that the column names survive an engine that never quotes identifiers, or that
 * a Date round-trips through storage unchanged. That is what this file is for.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createRepos } from '../src/db/create-repos.js';
import type { RepoBundle } from '../src/db/repos.js';
import {
  computePeriods,
  createApplication,
  getApplication,
  listApplications,
  patchApplication,
} from '../src/services/applications.service.js';
import { checkDuplicates } from '../src/services/duplicates.service.js';
import { applicationFilterSchema } from '@jobtrack/shared';
import { applicationInput } from './support/repos.js';

let directory: string;
let repos: RepoBundle;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jobtrack-test-'));
  const config = loadConfig({
    DB_DRIVER: 'sqlite',
    DB_FILE: join(directory, 'test.db'),
    SEMANTIC_SEARCH: 'false',
  } as NodeJS.ProcessEnv);
  repos = await createRepos(config);
});

afterAll(async () => {
  await repos.close();
  await rm(directory, { recursive: true, force: true });
});

describe('against real SQLite', () => {
  it('creates every table from the schema descriptors', async () => {
    // ensureTable ran during createRepos; a count proves the DDL was accepted.
    await expect(repos.companies.count()).resolves.toBe(0);
    await expect(repos.applications.count()).resolves.toBe(0);
    await expect(repos.tags.count()).resolves.toBe(0);
    await expect(repos.tagLinks.count()).resolves.toBe(0);
    await expect(repos.notes.count()).resolves.toBe(0);
    await expect(repos.statusEvents.count()).resolves.toBe(0);
    await expect(repos.searchVectors.count()).resolves.toBe(0);
  });

  it('round-trips a calendar date without shifting it', async () => {
    const created = await createApplication(repos, applicationInput({ appliedOn: '2026-01-01' }));
    const read = await getApplication(repos, created.id);

    // The whole point of storing dates as UTC midnight: 1 January stays 1 January.
    expect(read!.appliedOn).toBe('2026-01-01');
    expect(read!.periodYear).toBe(2026);
    expect(read!.periodMonth).toBe(1);
  });

  it('round-trips booleans and nullable numbers as real types', async () => {
    const created = await createApplication(
      repos,
      applicationInput({ jobTitle: 'Typed Role', salaryMin: 600000, salaryMax: null }),
    );
    const row = await repos.applications.findById(created.id);

    expect(row!.archived).toBe(false);
    expect(row!.salaryMin).toBe(600000);
    expect(row!.salaryMax).toBeNull();
    expect(row!.appliedOn).toBeInstanceOf(Date);
  });

  it('enforces the unique company key at the database level', async () => {
    await createApplication(repos, applicationInput({ companyName: 'Klarna', jobTitle: 'A' }));
    await createApplication(repos, applicationInput({ companyName: 'Klarna AB', jobTitle: 'B' }));

    const klarna = await repos.companies.findMany({ where: { nameKey: 'klarna' } });
    expect(klarna).toHaveLength(1);
  });

  it('runs the transactional create across tables', async () => {
    const before = await repos.companies.count();
    const created = await createApplication(
      repos,
      applicationInput({ companyName: 'Transactional Co', jobTitle: 'Role', tags: ['x'], notes: 'n' }),
    );

    expect(await repos.companies.count()).toBe(before + 1);
    const detail = await getApplication(repos, created.id);
    expect(detail!.statusEvents).toHaveLength(1);
    expect(detail!.notes).toHaveLength(1);
    expect(detail!.tags).toHaveLength(1);
  });

  it('filters and pages through the real query compiler', async () => {
    const filter = applicationFilterSchema.parse({ year: 2026, limit: 2 });
    const page = await listApplications(repos, filter);

    expect(page.items.length).toBeLessThanOrEqual(2);
    for (const item of page.items) expect(item.periodYear).toBe(2026);

    if (page.cursor) {
      const next = await listApplications(
        repos,
        applicationFilterSchema.parse({ year: 2026, limit: 2, cursor: page.cursor }),
      );
      // Keyset paging must not repeat a row across the boundary.
      const firstIds = new Set(page.items.map((i) => i.id));
      expect(next.items.every((i) => !firstIds.has(i.id))).toBe(true);
    }
  });

  it('detects duplicates end to end', async () => {
    await createApplication(
      repos,
      applicationInput({ companyName: 'Duplicate Test AB', jobTitle: 'Backend Engineer' }),
    );

    const check = await checkDuplicates(repos, null, {
      company: 'duplicate test',
      title: 'Backend Engineer',
    });

    expect(check.verdict).toBe('exact');
    expect(check.company?.name).toBe('Duplicate Test AB');
  });

  it('keeps the period tally in step when a date moves across a month', async () => {
    const created = await createApplication(
      repos,
      applicationInput({ companyName: 'Period Co', jobTitle: 'Mover', appliedOn: '2024-05-31' }),
    );

    const before = await computePeriods(repos);
    expect(before.find((p) => p.year === 2024)?.months?.[0]).toMatchObject({ month: 5, count: 1 });

    await patchApplication(repos, created.id, { appliedOn: '2024-06-01' });

    const after = await computePeriods(repos);
    expect(after.find((p) => p.year === 2024)?.months?.[0]).toMatchObject({ month: 6, count: 1 });
  });
});
