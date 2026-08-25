import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import { SearchIndex } from '../src/search/index.js';
import { DisabledEmbedder, FakeEmbedder } from '../src/search/embedder.js';
import { createApplication } from '../src/services/applications.service.js';
import { createNote } from '../src/services/notes.service.js';
import { applicationInput, createMemoryRepos } from './support/repos.js';

let repos: RepoBundle;

beforeEach(async () => {
  repos = createMemoryRepos();
  await createApplication(
    repos,
    applicationInput({ companyName: 'Spotify', jobTitle: 'Backend Engineer', location: 'Stockholm' }),
  );
  await createApplication(
    repos,
    applicationInput({ companyName: 'Figma', jobTitle: 'Product Designer', location: 'Remote' }),
  );
  await createApplication(
    repos,
    applicationInput({ companyName: 'Neo4j', jobTitle: 'Database Engineer', location: 'Malmö' }),
  );
});

describe('SearchIndex', () => {
  it('indexes applications, companies and notes', async () => {
    await createNote(repos, {
      title: 'Interview prep',
      body: 'system design questions',
      targetType: 'standalone',
      targetId: null,
      pinned: false,
    });

    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    const outcome = await search.search('engineer');
    expect(outcome.hits.length).toBeGreaterThan(0);

    const noteHit = await search.search('interview prep', { types: ['note'] });
    expect(noteHit.hits[0]?.type).toBe('note');
  });

  it('finds an application by its company name', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    const outcome = await search.search('Spotify', { types: ['application'] });
    const rows = await repos.applications.findMany({});
    const spotify = rows.find((r) => r.jobTitle === 'Backend Engineer')!;

    expect(outcome.hits.map((h) => h.entityId)).toContain(spotify.id);
  });

  it('tolerates typos', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    const outcome = await search.search('enginer', { types: ['application'] });
    expect(outcome.hits.length).toBeGreaterThan(0);
  });

  it('respects a type filter', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    const outcome = await search.search('Spotify', { types: ['company'] });
    expect(outcome.hits.every((h) => h.type === 'company')).toBe(true);
  });

  it('honors the result limit', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    const outcome = await search.search('engineer', { limit: 1 });
    expect(outcome.hits).toHaveLength(1);
  });

  it('returns nothing for a blank query', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();
    expect((await search.search('   ')).hits).toEqual([]);
  });

  it('persists embeddings so a restart does not recompute them', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    // Three applications, three companies, no notes.
    const stored = await repos.searchVectors.count();
    expect(stored).toBe(6);

    const vectors = await repos.searchVectors.findMany({});
    expect(vectors[0]!.model).toBe('fake-hash-v1');
    expect(vectors[0]!.dim).toBe(32);
    expect(Array.isArray(vectors[0]!.embedding)).toBe(true);
  });

  it('drops vectors for documents that no longer exist', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();
    expect(await repos.searchVectors.count()).toBe(6);

    await repos.applications.deleteMany({});
    await search.rebuild();
    await search.start();
    await search.whenSemanticReady();

    // Only the three companies remain.
    expect(await repos.searchVectors.count()).toBe(3);
  });

  it('serves lexical results when no embedder is available', async () => {
    const search = new SearchIndex({ repos, embedder: new DisabledEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    const outcome = await search.search('engineer', { types: ['application'] });

    // Degraded but never empty — and the caller is told, so the UI can say so.
    expect(outcome.semanticReady).toBe(false);
    expect(outcome.hits.length).toBeGreaterThan(0);
    expect(outcome.hits.every((h) => h.matchedBy.includes('lexical'))).toBe(true);
  });

  it('reports which retrievers matched', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    const outcome = await search.search('backend engineer', { types: ['application'] });
    expect(outcome.semanticReady).toBe(true);
    expect(outcome.hits[0]!.matchedBy.length).toBeGreaterThan(0);
  });

  it('picks up new applications after a rebuild', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    await createApplication(
      repos,
      applicationInput({ companyName: 'Vercel', jobTitle: 'Compiler Engineer' }),
    );

    expect((await search.search('compiler')).hits).toHaveLength(0);
    await search.rebuild();
    expect((await search.search('compiler')).hits.length).toBeGreaterThan(0);
  });
});

describe('similarityTo', () => {
  it('scores a query against specific applications', async () => {
    const search = new SearchIndex({ repos, embedder: new FakeEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    const rows = await repos.applications.findMany({});
    const scores = await search.similarityTo('Backend Engineer at Spotify', rows.map((r) => r.id));

    expect(scores.size).toBe(3);
    for (const value of scores.values()) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('returns nothing when semantic search is unavailable', async () => {
    const search = new SearchIndex({ repos, embedder: new DisabledEmbedder() });
    await search.start();
    await search.whenSemanticReady();

    const rows = await repos.applications.findMany({});
    expect((await search.similarityTo('anything', rows.map((r) => r.id))).size).toBe(0);
  });
});

describe('FakeEmbedder', () => {
  it('is deterministic', async () => {
    const embedder = new FakeEmbedder();
    const [a] = await embedder.embed(['backend engineer']);
    const [b] = await embedder.embed(['backend engineer']);
    expect(Array.from(a!)).toEqual(Array.from(b!));
  });

  it('gives related text more overlap than unrelated text', async () => {
    const embedder = new FakeEmbedder();
    const [base, related, unrelated] = await embedder.embed([
      'backend engineer',
      'senior backend engineer',
      'graphic designer illustrator',
    ]);

    const dot = (x: Float32Array, y: Float32Array) =>
      x.reduce((sum, value, index) => sum + value * (y[index] ?? 0), 0);

    expect(dot(base!, related!)).toBeGreaterThan(dot(base!, unrelated!));
  });
});
