import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import { createApplication } from '../src/services/applications.service.js';
import { checkDuplicates } from '../src/services/duplicates.service.js';
import { applicationInput, createMemoryRepos, createTestSearch } from './support/repos.js';

let repos: RepoBundle;

beforeEach(async () => {
  repos = createMemoryRepos();
  await createApplication(
    repos,
    applicationInput({ companyName: 'Spotify', jobTitle: 'Backend Engineer', appliedOn: '2024-02-12' }),
  );
  await createApplication(
    repos,
    applicationInput({ companyName: 'Spotify AB', jobTitle: 'Senior Backend Engineer', appliedOn: '2025-01-14' }),
  );
  await createApplication(
    repos,
    applicationInput({ companyName: 'Klarna', jobTitle: 'Platform Engineer', appliedOn: '2026-03-12' }),
  );
});

describe('checkDuplicates', () => {
  it('says nothing for a company that is genuinely new', async () => {
    const check = await checkDuplicates(repos, null, { company: 'Brand New Co', title: 'Backend Engineer' });
    expect(check.verdict).toBe('none');
    expect(check.company).toBeNull();
    expect(check.companyMatched).toBe(false);
  });

  it('resolves a differently-spelled company to the same record', async () => {
    // Both applications above went to one company because "Spotify AB" normalizes to
    // "spotify" — this is the check that the whole feature rests on.
    const check = await checkDuplicates(repos, null, { company: 'spotify', title: '' });
    expect(check.company?.name).toBe('Spotify');
    expect(check.priorCount).toBe(2);
  });

  it('flags an exact repeat of the same role', async () => {
    const check = await checkDuplicates(repos, null, {
      company: 'Spotify AB',
      title: 'backend engineer',
    });
    expect(check.verdict).toBe('exact');
    expect(check.matches[0]!.matchKind).toBe('exact');
    expect(check.matches[0]!.appliedOn).toBe('2024-02-12');
  });

  it('flags a near-identical title as similar', async () => {
    const check = await checkDuplicates(repos, null, {
      company: 'Spotify',
      title: 'Senior Backend Engineers',
    });
    expect(check.verdict).toBe('similar');
  });

  it('reports company-only for an unrelated role', async () => {
    const check = await checkDuplicates(repos, null, { company: 'Klarna', title: 'Graphic Designer' });
    expect(check.verdict).toBe('company');
    expect(check.priorCount).toBe(1);
    expect(check.matches).toEqual([]);
  });

  it('does not report an application as its own duplicate when editing', async () => {
    const existing = await repos.applications.findOne({ where: { jobTitle: 'Backend Engineer' } });

    const withoutExclusion = await checkDuplicates(repos, null, {
      company: 'Spotify',
      title: 'Backend Engineer',
    });
    expect(withoutExclusion.verdict).toBe('exact');

    const withExclusion = await checkDuplicates(repos, null, {
      company: 'Spotify',
      title: 'Backend Engineer',
      excludeId: existing!.id,
    });
    // The only exact match was itself, so what remains is the merely-similar senior role.
    expect(withExclusion.verdict).toBe('similar');
    expect(withExclusion.priorCount).toBe(1);
  });

  it('works without a search index, reporting that semantics were not used', async () => {
    const check = await checkDuplicates(repos, null, { company: 'Spotify', title: 'Backend Engineer' });
    expect(check.semanticUsed).toBe(false);
    expect(check.verdict).toBe('exact');
  });

  it('uses the search index when one is available', async () => {
    const search = createTestSearch(repos);
    await search.start();

    const check = await checkDuplicates(repos, search, {
      company: 'Spotify',
      title: 'Backend Engineer',
    });

    expect(check.semanticUsed).toBe(true);
    expect(check.matches[0]!.semanticSimilarity).not.toBeNull();
  });
});
