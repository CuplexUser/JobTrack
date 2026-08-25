import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import { seedDemoData } from '../src/backup/seed.js';
import { currentCounts, isEmpty } from '../src/backup/snapshot.js';
import { createMemoryRepos } from './support/repos.js';

let repos: RepoBundle;

beforeEach(() => {
  repos = createMemoryRepos();
});

describe('seedDemoData', () => {
  it('writes the demo dataset into an empty database', async () => {
    expect(isEmpty(await currentCounts(repos))).toBe(true);

    const result = await seedDemoData(repos);

    expect(result.applications).toBeGreaterThan(0);
    expect(result.companies).toBeGreaterThan(0);
    expect(result.tags).toBeGreaterThan(0);
    expect(result.notes).toBeGreaterThan(0);

    const counts = await currentCounts(repos);
    expect(isEmpty(counts)).toBe(false);
    expect(counts.applications).toBe(result.applications);
    expect(counts.companies).toBe(result.companies);

    // The duplicate-detection demo: "Spotify" and "Spotify AB" are meant to normalize to one company.
    expect(await repos.companies.findOne({ where: { nameKey: 'spotify' } })).not.toBeNull();
  });

  it('does not check emptiness itself — callers own that decision', async () => {
    await seedDemoData(repos);
    const before = await repos.applications.count();

    // Calling it again on a non-empty database just adds more — the guard lives in the route/CLI, not here.
    await seedDemoData(repos);
    expect(await repos.applications.count()).toBeGreaterThan(before);
  });
});
