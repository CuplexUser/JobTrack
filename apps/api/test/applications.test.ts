import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import {
  changeStatus,
  computeLocations,
  computePeriods,
  createApplication,
  deleteApplication,
  findAllMatching,
  getApplication,
  listApplications,
  patchApplication,
} from '../src/services/applications.service.js';
import { applicationFilterSchema } from '@jobtrack/shared';
import { applicationInput, createMemoryRepos } from './support/repos.js';

const filter = (over: Record<string, unknown> = {}) => applicationFilterSchema.parse(over);

let repos: RepoBundle;

beforeEach(() => {
  repos = createMemoryRepos();
});

describe('createApplication', () => {
  it('derives the period columns from the applied date', async () => {
    const created = await createApplication(repos, applicationInput({ appliedOn: '2026-03-12' }));
    expect(created.periodYear).toBe(2026);
    expect(created.periodMonth).toBe(3);
  });

  it('keeps the first of a month in that month', async () => {
    // The timezone bug this guards would file a 1 January application under December.
    const created = await createApplication(repos, applicationInput({ appliedOn: '2026-01-01' }));
    expect(created.periodYear).toBe(2026);
    expect(created.periodMonth).toBe(1);
  });

  it('creates the company on first use and reuses it after', async () => {
    await createApplication(repos, applicationInput({ companyName: 'Spotify' }));
    await createApplication(repos, applicationInput({ companyName: 'Spotify AB', jobTitle: 'Other' }));

    // "Spotify" and "Spotify AB" are the same employer, so there must be exactly one.
    expect(await repos.companies.count()).toBe(1);
  });

  it('writes an opening status event', async () => {
    const created = await createApplication(repos, applicationInput({ status: 'applied' }));
    const detail = await getApplication(repos, created.id);

    expect(detail!.statusEvents).toHaveLength(1);
    expect(detail!.statusEvents[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'applied',
      occurredOn: '2026-03-12',
    });
  });

  it('attaches tags by name, creating them once', async () => {
    await createApplication(repos, applicationInput({ tags: ['fintech', 'remote-ok'] }));
    await createApplication(
      repos,
      applicationInput({ jobTitle: 'Other', tags: ['Fintech', 'REMOTE OK'] }),
    );

    // Tag keys are normalized, so the varied spellings must not create new tags.
    expect(await repos.tags.count()).toBe(2);
  });

  it('stores form notes as a linked note', async () => {
    const created = await createApplication(
      repos,
      applicationInput({ notes: 'Take-home was long but fair.' }),
    );
    const detail = await getApplication(repos, created.id);

    expect(detail!.notes).toHaveLength(1);
    expect(detail!.notes[0]!.body).toContain('Take-home');
    expect(detail!.noteCount).toBe(1);
  });

  it('hydrates the company and tags onto the returned view', async () => {
    const created = await createApplication(repos, applicationInput({ tags: ['fintech'] }));
    expect(created.company.name).toBe('Spotify');
    expect(created.tags.map((t) => t.name)).toEqual(['fintech']);
  });
});

describe('patchApplication', () => {
  it('recomputes the period when the date moves across a month boundary', async () => {
    const created = await createApplication(repos, applicationInput({ appliedOn: '2026-03-31' }));
    const updated = await patchApplication(repos, created.id, { appliedOn: '2026-04-01' });

    expect(updated!.periodMonth).toBe(4);
    expect(updated!.appliedOn).toBe('2026-04-01');
  });

  it('records a status event when the status changes', async () => {
    const created = await createApplication(repos, applicationInput());
    await patchApplication(repos, created.id, { status: 'interview', statusComment: 'Round two' });

    const detail = await getApplication(repos, created.id);
    expect(detail!.status).toBe('interview');
    expect(detail!.statusEvents).toHaveLength(2);
    expect(detail!.statusEvents[1]).toMatchObject({
      fromStatus: 'applied',
      toStatus: 'interview',
      comment: 'Round two',
    });
  });

  it('does not record an event when the status is unchanged', async () => {
    const created = await createApplication(repos, applicationInput());
    await patchApplication(repos, created.id, { status: 'applied', location: 'Malmö' });

    const detail = await getApplication(repos, created.id);
    expect(detail!.statusEvents).toHaveLength(1);
    expect(detail!.location).toBe('Malmö');
  });

  it('returns null for an application that does not exist', async () => {
    expect(await patchApplication(repos, 'missing', { status: 'offer' })).toBeNull();
  });

  it('replaces tags rather than accumulating them', async () => {
    const created = await createApplication(repos, applicationInput({ tags: ['a', 'b'] }));
    const updated = await patchApplication(repos, created.id, { tags: ['b', 'c'] });

    expect(updated!.tags.map((t) => t.name).sort()).toEqual(['b', 'c']);
  });
});

describe('changeStatus', () => {
  it('records who it moved from and to', async () => {
    const created = await createApplication(repos, applicationInput());
    await changeStatus(repos, created.id, {
      status: 'screening',
      occurredOn: '2026-04-01',
      comment: 'Recruiter call booked',
    });

    const detail = await getApplication(repos, created.id);
    expect(detail!.statusEvents[1]).toMatchObject({
      fromStatus: 'applied',
      toStatus: 'screening',
      occurredOn: '2026-04-01',
      comment: 'Recruiter call booked',
    });
  });
});

describe('deleteApplication', () => {
  it('removes the application and everything hanging off it', async () => {
    const created = await createApplication(
      repos,
      applicationInput({ tags: ['fintech'], notes: 'some note' }),
    );

    expect(await deleteApplication(repos, created.id)).toBe(true);

    // repolayer has no cascading deletes, so orphans are a real risk worth asserting.
    expect(await repos.applications.count()).toBe(0);
    expect(await repos.statusEvents.count()).toBe(0);
    expect(await repos.notes.count()).toBe(0);
    expect(await repos.tagLinks.count()).toBe(0);
    // The tag itself survives — it may still label other applications.
    expect(await repos.tags.count()).toBe(1);
  });

  it('reports false for an application that is already gone', async () => {
    expect(await deleteApplication(repos, 'missing')).toBe(false);
  });
});

describe('listApplications', () => {
  beforeEach(async () => {
    await createApplication(repos, applicationInput({ appliedOn: '2026-03-12', status: 'applied' }));
    await createApplication(
      repos,
      applicationInput({ companyName: 'Klarna', jobTitle: 'Platform Engineer', appliedOn: '2026-04-02', status: 'interview', tags: ['fintech'] }),
    );
    await createApplication(
      repos,
      applicationInput({ companyName: 'Anthropic', jobTitle: 'Data Engineer', appliedOn: '2025-11-05', status: 'rejected' }),
    );
  });

  it('filters by year and month', async () => {
    const result = await listApplications(repos, filter({ year: 2026, month: 4 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.jobTitle).toBe('Platform Engineer');
  });

  it('filters by status', async () => {
    const result = await listApplications(repos, filter({ status: 'interview,rejected' }));
    expect(result.items).toHaveLength(2);
  });

  it('filters by tag', async () => {
    const result = await listApplications(repos, filter({ tags: 'fintech' }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.company.name).toBe('Klarna');
  });

  it('returns nothing for a tag that does not exist', async () => {
    const result = await listApplications(repos, filter({ tags: 'nonexistent' }));
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('filters by location as a contains match, ignoring case and accents', async () => {
    await createApplication(
      repos,
      applicationInput({ companyName: 'Axis', jobTitle: 'Firmware Engineer', location: 'Malmö, Sweden' }),
    );
    const result = await listApplications(repos, filter({ location: 'MALMO' }));
    expect(result.items.map((i) => i.company.name)).toEqual(['Axis']);
  });

  it('matches any of several locations', async () => {
    await createApplication(
      repos,
      applicationInput({ companyName: 'Ericsson', jobTitle: 'Software Developer', location: 'Lund' }),
    );
    await createApplication(
      repos,
      applicationInput({ companyName: 'Volvo', jobTitle: 'Developer', location: 'Göteborg' }),
    );
    const result = await listApplications(repos, filter({ location: 'Lund|goteborg', sort: 'company', direction: 'asc' }));
    expect(result.items.map((i) => i.company.name)).toEqual(['Ericsson', 'Volvo']);
    expect(result.total).toBe(2);
  });

  it('combines a location with tags and status', async () => {
    await createApplication(
      repos,
      applicationInput({ companyName: 'Tink', jobTitle: 'Server-Side Developer', location: 'Lund', tags: ['fintech'] }),
    );
    // Klarna is fintech in Stockholm, Tink is fintech in Lund: only one survives both filters.
    const both = await listApplications(repos, filter({ location: 'Lund', tags: 'fintech' }));
    expect(both.items.map((i) => i.company.name)).toEqual(['Tink']);

    const none = await listApplications(repos, filter({ location: 'Lund', status: 'interview' }));
    expect(none.items).toEqual([]);
  });

  it('keeps the search ranking order under a location filter', async () => {
    const all = await listApplications(repos, filter());
    const reversed = all.items.map((i) => i.id).reverse();
    const ranked = await listApplications(repos, filter({ location: 'stockholm' }), { orderedIds: reversed });
    expect(ranked.items.map((i) => i.id)).toEqual(reversed);
  });

  it('returns nothing for a location nobody applied in', async () => {
    const result = await listApplications(repos, filter({ location: 'Kiruna' }));
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('filters by date range', async () => {
    const result = await listApplications(repos, filter({ from: '2026-01-01', to: '2026-12-31' }));
    expect(result.items).toHaveLength(2);
  });

  it('sorts by company name in memory, since that is a join the database cannot do', async () => {
    const result = await listApplications(repos, filter({ sort: 'company', direction: 'asc' }));
    expect(result.items.map((i) => i.company.name)).toEqual(['Anthropic', 'Klarna', 'Spotify']);
  });

  it('honors a search ranking over the database ordering', async () => {
    const all = await listApplications(repos, filter());
    const reversed = all.items.map((i) => i.id).reverse();

    const ranked = await listApplications(repos, filter(), { orderedIds: reversed });
    expect(ranked.items.map((i) => i.id)).toEqual(reversed);
  });

  it('reports a total independent of the page size', async () => {
    const result = await listApplications(repos, filter({ limit: 1 }));
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
  });
});

describe('computePeriods', () => {
  it('tallies applications by year and month, newest first', async () => {
    await createApplication(repos, applicationInput({ appliedOn: '2026-03-12' }));
    await createApplication(repos, applicationInput({ jobTitle: 'B', appliedOn: '2026-03-20' }));
    await createApplication(repos, applicationInput({ jobTitle: 'C', appliedOn: '2025-11-05' }));

    const periods = await computePeriods(repos);

    expect(periods.map((p) => p.year)).toEqual([2026, 2025]);
    expect(periods[0]!.count).toBe(2);
    expect(periods[0]!.months).toEqual([{ year: 2026, month: 3, count: 2 }]);
    expect(periods[1]!.count).toBe(1);
  });

  it('excludes archived applications by default', async () => {
    const created = await createApplication(repos, applicationInput());
    await patchApplication(repos, created.id, { archived: true });

    expect(await computePeriods(repos)).toEqual([]);
    expect(await computePeriods(repos, { includeArchived: true })).toHaveLength(1);
  });
});

describe('computeLocations', () => {
  it('groups spellings of one place, labels it by the most common, and counts', async () => {
    await createApplication(repos, applicationInput({ jobTitle: 'A', location: 'Malmö' }));
    await createApplication(repos, applicationInput({ jobTitle: 'B', location: 'Malmö' }));
    await createApplication(repos, applicationInput({ jobTitle: 'C', location: 'malmo ' }));
    await createApplication(repos, applicationInput({ jobTitle: 'D', location: 'Lund' }));
    await createApplication(repos, applicationInput({ jobTitle: 'E', location: null }));

    expect(await computeLocations(repos)).toEqual([
      { label: 'Malmö', count: 3 },
      { label: 'Lund', count: 1 },
    ]);
  });

  it('leaves out archived applications', async () => {
    const created = await createApplication(repos, applicationInput({ location: 'Umeå' }));
    await patchApplication(repos, created.id, { archived: true });
    expect(await computeLocations(repos)).toEqual([]);
  });
});

describe('findAllMatching', () => {
  it('applies the location filter, so an export matches the table', async () => {
    await createApplication(repos, applicationInput({ jobTitle: 'Stockholm role', location: 'Stockholm' }));
    await createApplication(repos, applicationInput({ jobTitle: 'Lund role', location: 'Lund' }));
    const rows = await findAllMatching(repos, filter({ location: 'lund' }));
    expect(rows.map((r) => r.jobTitle)).toEqual(['Lund role']);
  });

  it('ignores the page limit, because an export is not paged', async () => {
    for (let i = 0; i < 5; i += 1) {
      await createApplication(repos, applicationInput({ jobTitle: `Role ${i}` }));
    }
    const rows = await findAllMatching(repos, filter({ limit: 2 }));
    expect(rows).toHaveLength(5);
  });
});
