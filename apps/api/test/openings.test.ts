import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import {
  convertOpening,
  createOpening,
  deleteOpening,
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
