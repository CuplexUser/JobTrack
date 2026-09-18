import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import {
  convertOpening,
  createOpening,
  deleteOpening,
  findMatchingOpening,
  getOpening,
  listOpenings,
  updateOpening,
} from '../src/services/openings.service.js';
import { findAllMatching } from '../src/services/applications.service.js';
import { applicationFilterSchema } from '@jobtrack/shared';
import { createMemoryRepos, openingInput } from './support/repos.js';

let repos: RepoBundle;

beforeEach(() => {
  repos = createMemoryRepos();
});

describe('createOpening', () => {
  it('resolves the company by name, creating it if new', async () => {
    const opening = await createOpening(repos, openingInput());
    expect(opening.company.name).toBe('Spotify');
    expect(opening.archived).toBe(false);
    expect(opening.convertedApplicationId).toBeNull();
  });

  it('defaults savedOn to today when not given', async () => {
    const opening = await createOpening(repos, openingInput());
    expect(opening.savedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reuses an existing company rather than creating a second one', async () => {
    await createOpening(repos, openingInput());
    await createOpening(repos, openingInput({ jobTitle: 'Platform Engineer' }));
    const companies = await repos.companies.findMany({});
    expect(companies).toHaveLength(1);
  });
});

describe('listOpenings', () => {
  it('excludes archived openings by default', async () => {
    const opening = await createOpening(repos, openingInput());
    await updateOpening(repos, opening.id, { archived: true });
    expect(await listOpenings(repos)).toEqual([]);
    expect(await listOpenings(repos, { includeArchived: true })).toHaveLength(1);
  });

  it('matches q against title, company, location and notes, requiring every word', async () => {
    await createOpening(repos, openingInput({ jobTitle: 'Backend Engineer', notes: 'Kotlin and Postgres' }));
    await createOpening(repos, openingInput({ companyName: 'Klarna', jobTitle: 'Data Engineer', notes: null }));

    const titles = async (q: string) => (await listOpenings(repos, { q })).map((o) => o.jobTitle);
    expect(await titles('engineer')).toHaveLength(2);
    expect(await titles('KLARNA engineer')).toEqual(['Data Engineer']);
    expect(await titles('postgres backend')).toEqual(['Backend Engineer']);
    expect(await titles('postgres klarna')).toEqual([]);
  });

  it('filters by any of several locations and by source', async () => {
    await createOpening(repos, openingInput({ jobTitle: 'A', location: 'Malmö, Sweden', sourceName: 'Teamtailor' }));
    await createOpening(repos, openingInput({ jobTitle: 'B', location: 'Lund', sourceName: 'LinkedIn' }));
    await createOpening(repos, openingInput({ jobTitle: 'C', location: null, sourceName: null }));

    const byLocation = await listOpenings(repos, { location: ['malmo', 'Lund'] });
    expect(byLocation.map((o) => o.jobTitle).sort()).toEqual(['A', 'B']);

    const bySource = await listOpenings(repos, { source: 'linked' });
    expect(bySource.map((o) => o.jobTitle)).toEqual(['B']);
  });

  it('is newest first within a day, not oldest first', async () => {
    // `savedOn` holds no time, so three openings saved today are a three-way tie that only
    // the moment they were created can break — and the last one saved is the newest. The
    // clock is moved by hand because that moment is what decides it, and three creates in
    // a test run land in the same millisecond.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const [index, jobTitle] of ['A', 'B', 'C'].entries()) {
        vi.setSystemTime(new Date(`2026-09-17T09:0${index}:00Z`));
        await createOpening(repos, openingInput({ jobTitle, savedOn: '2026-09-17' }));
      }
      await createOpening(repos, openingInput({ jobTitle: 'Older', savedOn: '2026-09-16' }));
    } finally {
      vi.useRealTimers();
    }

    expect((await listOpenings(repos)).map((o) => o.jobTitle)).toEqual(['C', 'B', 'A', 'Older']);
  });
});

describe('findMatchingOpening', () => {
  const posting = (over: Partial<{ companyName: string; jobTitle: string; jobUrl: string | null }> = {}) => ({
    companyName: 'Spotify',
    jobTitle: 'Backend Engineer',
    jobUrl: null,
    ...over,
  });

  it('finds the opening a link was already saved as, however the link is written', async () => {
    await createOpening(repos, openingInput({ jobUrl: 'https://jobs.example.com/spotify/7' }));

    const match = await findMatchingOpening(
      repos,
      posting({ jobUrl: 'http://www.jobs.example.com/spotify/7/?utm_source=mail' }),
    );

    expect(match?.jobTitle).toBe('Backend Engineer');
  });

  it('treats two different links as two postings, title and company notwithstanding', async () => {
    // The same role advertised in two cities is two ads, and saving both is the point.
    await createOpening(repos, openingInput({ jobUrl: 'https://jobs.example.com/spotify/7' }));

    expect(
      await findMatchingOpening(repos, posting({ jobUrl: 'https://jobs.example.com/spotify/8' })),
    ).toBeNull();
  });

  it('falls back to title when a link is just the company\'s domain, not a specific posting', async () => {
    // What actually happened: an MCP client filled `jobUrl` with the company's careers
    // domain (no path) rather than leaving it out, which used to compare it byte-for-byte
    // against a real posting link, find no match, and let a second copy through.
    await createOpening(repos, openingInput({ jobUrl: 'https://nexergroup.teamtailor.com' }));

    const match = await findMatchingOpening(
      repos,
      posting({ jobUrl: 'https://arbetsformedlingen.se/platsbanken/annonser/31465602' }),
    );

    expect(match?.jobTitle).toBe('Backend Engineer');
  });

  it('falls back to company and title when either side has no link', async () => {
    await createOpening(repos, openingInput());

    expect((await findMatchingOpening(repos, posting()))?.jobTitle).toBe('Backend Engineer');
    // Title matching goes through titleKey, so case and punctuation are not a difference.
    expect(await findMatchingOpening(repos, posting({ jobTitle: 'BACKEND  Engineer!' }))).not.toBeNull();
    expect(await findMatchingOpening(repos, posting({ jobTitle: 'Platform Engineer' }))).toBeNull();
  });

  it('finds nothing at a company nothing has been saved for', async () => {
    await createOpening(repos, openingInput());
    expect(await findMatchingOpening(repos, posting({ companyName: 'Klarna' }))).toBeNull();
  });

  it('still finds one that was archived, or that became an application', async () => {
    const opening = await createOpening(repos, openingInput());
    await convertOpening(repos, opening.id, {});

    const match = await findMatchingOpening(repos, posting());
    expect(match?.archived).toBe(true);
    expect(match?.convertedApplicationId).not.toBeNull();
  });
});

describe('updateOpening', () => {
  it('changes only the given fields', async () => {
    const opening = await createOpening(repos, openingInput());
    const updated = await updateOpening(repos, opening.id, { location: 'Remote' });
    expect(updated?.location).toBe('Remote');
    expect(updated?.jobTitle).toBe('Backend Engineer');
  });

  it('returns null for an unknown id', async () => {
    expect(await updateOpening(repos, 'missing', { location: 'Remote' })).toBeNull();
  });
});

describe('deleteOpening', () => {
  it('removes the opening and reports success', async () => {
    const opening = await createOpening(repos, openingInput());
    expect(await deleteOpening(repos, opening.id)).toBe(true);
    expect(await getOpening(repos, opening.id)).toBeNull();
  });

  it('reports false for an unknown id', async () => {
    expect(await deleteOpening(repos, 'missing')).toBe(false);
  });
});

describe('convertOpening', () => {
  it('creates a real application carrying the opening\'s fields', async () => {
    const opening = await createOpening(
      repos,
      openingInput({ jobTitle: 'Platform Engineer', notes: 'Looks promising.' }),
    );

    const application = await convertOpening(repos, opening.id, { appliedOn: '2026-04-01' });
    expect(application).toMatchObject({
      jobTitle: 'Platform Engineer',
      appliedOn: '2026-04-01',
      status: 'applied',
      company: expect.objectContaining({ name: 'Spotify' }),
    });

    const applications = await findAllMatching(repos, applicationFilterSchema.parse({}));
    expect(applications).toHaveLength(1);
  });

  it('archives the opening and records what it became', async () => {
    const opening = await createOpening(repos, openingInput());
    const application = await convertOpening(repos, opening.id, {});

    const after = await getOpening(repos, opening.id);
    expect(after?.archived).toBe(true);
    expect(after?.convertedApplicationId).toBe(application?.id);
  });

  it('returns null for an unknown opening', async () => {
    expect(await convertOpening(repos, 'missing', {})).toBeNull();
  });

  it('defaults status to applied and appliedOn to today', async () => {
    const opening = await createOpening(repos, openingInput());
    const application = await convertOpening(repos, opening.id, {});
    expect(application?.status).toBe('applied');
    expect(application?.appliedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
