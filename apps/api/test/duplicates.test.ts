import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import {
  changeStatus,
  createApplication,
  deleteApplications,
  patchApplication,
} from '../src/services/applications.service.js';
import { checkDuplicates, findDuplicateGroups } from '../src/services/duplicates.service.js';
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

describe('findDuplicateGroups', () => {
  it('reports a reworded title at the same employer as a similar group', async () => {
    // The fixture's "Backend Engineer" and "Senior Backend Engineer" went to one company
    // (Spotify and Spotify AB normalize together), which is exactly what the sweep is for.
    const scan = await findDuplicateGroups(repos);
    expect(scan.scanned).toBe(3);
    expect(scan.groups).toHaveLength(1);
    expect(scan.groups[0]).toMatchObject({ companyName: 'Spotify', kind: 'similar' });
  });

  it('pairs up an application that was entered twice, exact repeats first', async () => {
    // What an import run twice, or a posting clipped from two tabs, leaves behind.
    await createApplication(
      repos,
      applicationInput({ companyName: 'Klarna', jobTitle: 'Platform Engineer', appliedOn: '2026-03-12' }),
    );

    const scan = await findDuplicateGroups(repos);
    expect(scan.groups.map((g) => g.kind)).toEqual(['exact', 'similar']);
    expect(scan.groups[0]).toMatchObject({ companyName: 'Klarna' });
    expect(scan.groups[0]!.members).toHaveLength(2);
  });

  it('groups differently-spelled companies together, since they are one company', async () => {
    await createApplication(
      repos,
      applicationInput({ companyName: 'spotify ab', jobTitle: 'Backend Engineer', appliedOn: '2026-05-01' }),
    );

    const scan = await findDuplicateGroups(repos);
    expect(scan.groups).toHaveLength(1);
    expect(scan.groups[0]!.companyName).toBe('Spotify');
    expect(scan.groups[0]!.members).toHaveLength(3);
  });

  it('recommends keeping the record with the history on it', async () => {
    const other = await createApplication(
      repos,
      applicationInput({ companyName: 'Klarna', jobTitle: 'Platform Engineer', appliedOn: '2026-03-12' }),
    );
    await changeStatus(repos, other.id, { status: 'interview', occurredOn: '2026-04-01', comment: null });

    const scan = await findDuplicateGroups(repos);
    const klarna = scan.groups.find((g) => g.companyName === 'Klarna')!;
    expect(klarna.keepId).toBe(other.id);
    expect(klarna.members[0]!.id).toBe(other.id);
  });

  it('includes archived records, so half a pair cannot hide', async () => {
    const extra = await createApplication(
      repos,
      applicationInput({ companyName: 'Klarna', jobTitle: 'Platform Engineer', appliedOn: '2026-03-12' }),
    );
    await patchApplication(repos, extra.id, { archived: true });

    const scan = await findDuplicateGroups(repos);
    const klarna = scan.groups.find((g) => g.companyName === 'Klarna')!;
    expect(klarna.members.map((m) => m.id)).toContain(extra.id);
  });
});

describe('deleteApplications', () => {
  it('removes exactly the records it was given', async () => {
    const extra = await createApplication(
      repos,
      applicationInput({ companyName: 'Klarna', jobTitle: 'Platform Engineer', appliedOn: '2026-03-12' }),
    );

    const result = await deleteApplications(repos, [extra.id]);
    expect(result).toEqual({ deleted: 1, missing: 0 });

    const scan = await findDuplicateGroups(repos);
    expect(scan.scanned).toBe(3);
    expect(scan.groups.some((g) => g.companyName === 'Klarna')).toBe(false);
  });

  it('counts an id that is already gone as missing rather than failing the batch', async () => {
    const extra = await createApplication(
      repos,
      applicationInput({ companyName: 'Klarna', jobTitle: 'Platform Engineer', appliedOn: '2026-03-12' }),
    );

    const result = await deleteApplications(repos, [extra.id, '00000000-0000-4000-8000-000000000000']);
    expect(result).toEqual({ deleted: 1, missing: 1 });
  });
});
