/**
 * The hydrate layer stands in for the joins repolayer does not have. The property that
 * matters is that its cost does not grow with the page size — so these tests count queries
 * as well as checking the output.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import { hydrateApplications, uniqueIds } from '../src/db/hydrate.js';
import { createApplication } from '../src/services/applications.service.js';
import { applicationInput, createMemoryRepos } from './support/repos.js';

let repos: RepoBundle;

beforeEach(() => {
  repos = createMemoryRepos();
});

describe('uniqueIds', () => {
  it('deduplicates and drops empties', () => {
    expect(uniqueIds(['a', 'b', 'a', '', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('hydrateApplications', () => {
  it('returns nothing for an empty page without touching the database', async () => {
    const spy = vi.spyOn(repos.companies, 'findMany');
    expect(await hydrateApplications(repos, [])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stitches company, tags and note count onto each row', async () => {
    await createApplication(
      repos,
      applicationInput({ tags: ['fintech', 'remote-ok'], notes: 'a note' }),
    );
    const rows = await repos.applications.findMany({});
    const [view] = await hydrateApplications(repos, rows);

    expect(view!.company.name).toBe('Spotify');
    expect(view!.tags.map((t) => t.name)).toEqual(['fintech', 'remote-ok']);
    expect(view!.noteCount).toBe(1);
  });

  it('sorts tags by name so the UI order is stable', async () => {
    await createApplication(repos, applicationInput({ tags: ['zebra', 'alpha', 'middle'] }));
    const rows = await repos.applications.findMany({});
    const [view] = await hydrateApplications(repos, rows);

    expect(view!.tags.map((t) => t.name)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('costs the same number of queries for 20 rows as for one', async () => {
    for (let i = 0; i < 20; i += 1) {
      await createApplication(
        repos,
        applicationInput({ companyName: `Company ${i}`, jobTitle: `Role ${i}`, tags: [`tag${i}`] }),
      );
    }
    const rows = await repos.applications.findMany({});
    expect(rows).toHaveLength(20);

    const companySpy = vi.spyOn(repos.companies, 'findMany');
    const tagLinkSpy = vi.spyOn(repos.tagLinks, 'findMany');
    const tagSpy = vi.spyOn(repos.tags, 'findMany');
    const noteSpy = vi.spyOn(repos.notes, 'findMany');

    const views = await hydrateApplications(repos, rows);

    expect(views).toHaveLength(20);
    // One query each, regardless of how many rows are on the page. If this ever fails,
    // something has reintroduced a per-row lookup.
    expect(companySpy).toHaveBeenCalledTimes(1);
    expect(tagLinkSpy).toHaveBeenCalledTimes(1);
    expect(tagSpy).toHaveBeenCalledTimes(1);
    expect(noteSpy).toHaveBeenCalledTimes(1);
  });

  it('renders a placeholder rather than dropping a row whose company vanished', async () => {
    await createApplication(repos, applicationInput());
    const rows = await repos.applications.findMany({});
    await repos.companies.deleteMany({});

    const views = await hydrateApplications(repos, rows);

    // Losing a row from a list silently would be worse than showing an unknown employer.
    expect(views).toHaveLength(1);
    expect(views[0]!.company.name).toBe('(unknown company)');
  });
});
