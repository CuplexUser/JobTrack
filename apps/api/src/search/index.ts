/**
 * Hybrid search.
 *
 * Two retrievers over the same documents, fused by rank:
 *
 * - **Lexical** (MiniSearch): typo-tolerant BM25. Finds "pyhton devloper".
 * - **Semantic** (embeddings): cosine over mean-pooled sentence vectors. Finds "Backend
 *   Engineer" when the query was "server-side developer" — no shared words at all.
 *
 * Neither is sufficient alone, which is the whole argument for fusing them: lexical search
 * cannot bridge vocabulary, and vector search is unreliable on exact identifiers like a
 * company name. See rrf.ts for why the fusion works on ranks rather than scores.
 *
 * The index lives in memory and is rebuilt wholesale on a debounce after writes. For a
 * personal tracker — hundreds to low thousands of rows — a rebuild is milliseconds, and
 * embeddings are only recomputed for documents whose text actually changed, which the
 * stored `textHash` decides.
 */

import MiniSearch, { type Options } from 'minisearch';
import {
  cosineSimilarity,
  reciprocalRankFusion,
  formatDateOnly,
  type Tag,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import type { Embedder } from './embedder.js';

export type DocType = 'application' | 'company' | 'note';

export interface SearchDoc {
  /** `${type}:${entityId}` — unique across types, which is what MiniSearch indexes on. */
  id: string;
  type: DocType;
  entityId: string;
  title: string;
  company: string;
  location: string;
  tags: string;
  body: string;
  /** The single string handed to the embedder. */
  text: string;
}

export interface SearchHit {
  type: DocType;
  entityId: string;
  score: number;
  /** Which retrievers found it — surfaced in the UI as a "why this matched" hint. */
  matchedBy: ('lexical' | 'semantic')[];
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** False while the model is still loading, so the UI can say results will improve. */
  semanticReady: boolean;
}

const MINISEARCH_OPTIONS: Options<SearchDoc> = {
  idField: 'id',
  fields: ['title', 'company', 'location', 'tags', 'body'],
  storeFields: ['type', 'entityId'],
  searchOptions: {
    // Roughly "one typo per five characters", plus prefix matching so results appear
    // while the query is still being typed.
    fuzzy: 0.2,
    prefix: true,
    boost: { title: 3, company: 2, tags: 1.5 },
  },
};

/**
 * Cosine floor for the semantic half.
 *
 * Vector search has no concept of "no match" — it always returns the nearest neighbours,
 * so without a floor a query for "zzzzz" comes back with the whole table ranked by
 * accident. Normalized MiniLM embeddings put unrelated sentence pairs below ~0.2 and
 * genuinely related ones above ~0.4, so this sits between them.
 */
const SEMANTIC_FLOOR = 0.25;

export class SearchIndex {
  #repos: Repos;
  #embedder: Embedder;
  #log: (message: string, error?: unknown) => void;

  #mini = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
  #docs = new Map<string, SearchDoc>();
  #vectors = new Map<string, Float32Array>();

  #building: Promise<void> | null = null;
  #embedding: Promise<void> | null = null;
  #rebuildTimer: NodeJS.Timeout | null = null;
  #stale = false;

  constructor(options: {
    repos: Repos;
    embedder: Embedder;
    log?: (message: string, error?: unknown) => void;
  }) {
    this.#repos = options.repos;
    this.#embedder = options.embedder;
    this.#log = options.log ?? (() => {});
  }

  get semanticReady(): boolean {
    return this.#embedder.ready && this.#vectors.size > 0;
  }

  /**
   * Build the lexical index immediately, then load the model and embed in the background.
   *
   * Deliberately two phases: the API is useful the moment the lexical half is ready, and
   * waiting on a 25 MB download before serving the first request would be a poor trade.
   */
  async start(): Promise<void> {
    await this.rebuild();
    this.#embedding = this.#embedInBackground();
  }

  /**
   * Resolves once the current embedding pass has finished.
   *
   * `start()` deliberately does not wait — the API must answer requests while the model
   * loads. Tests, and the seed script's summary, do need to wait, and this is how.
   */
  async whenSemanticReady(): Promise<void> {
    await this.#embedding;
  }

  async rebuild(): Promise<void> {
    this.#building ??= this.#doRebuild().finally(() => {
      this.#building = null;
    });
    return this.#building;
  }

  /**
   * Note that something changed. Rebuilds are debounced, so a bulk import or a rapid
   * sequence of edits costs one rebuild rather than one per write.
   */
  markStale(): void {
    this.#stale = true;
    if (this.#rebuildTimer) clearTimeout(this.#rebuildTimer);
    this.#rebuildTimer = setTimeout(() => {
      this.#rebuildTimer = null;
      this.#embedding = this.rebuild()
        .then(() => this.#embedInBackground())
        .catch((error) => this.#log('search rebuild failed', error));
    }, 400);
    // Never hold the process open for a rebuild.
    this.#rebuildTimer.unref?.();
  }

  /** Stop the pending rebuild — called on shutdown so tests and Ctrl-C exit cleanly. */
  stop(): void {
    if (this.#rebuildTimer) clearTimeout(this.#rebuildTimer);
    this.#rebuildTimer = null;
  }

  async #doRebuild(): Promise<void> {
    const docs = await this.#composeDocs();

    const mini = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
    mini.addAll(docs);

    this.#mini = mini;
    this.#docs = new Map(docs.map((doc) => [doc.id, doc]));
    this.#stale = false;

    // Drop vectors for documents that no longer exist, so a deleted application cannot
    // keep scoring in semantic results.
    for (const key of [...this.#vectors.keys()]) {
      if (!this.#docs.has(key)) this.#vectors.delete(key);
    }
  }

  /**
   * Read everything and compose one searchable document per entity.
   *
   * Applications carry their company name, tags and linked notes in their text, which is
   * what lets "remote fintech" find an application whose own row says neither.
   */
  async #composeDocs(): Promise<SearchDoc[]> {
    const [applications, companies, notes, tagLinks, tags] = await Promise.all([
      this.#repos.applications.findMany({}),
      this.#repos.companies.findMany({}),
      this.#repos.notes.findMany({}),
      this.#repos.tagLinks.findMany({}),
      this.#repos.tags.findMany({}),
    ]);

    const companyById = new Map(companies.map((c) => [c.id, c]));
    const tagById = new Map(tags.map((t) => [t.id, t]));

    const tagNamesFor = (type: string, id: string): string[] =>
      tagLinks
        .filter((l) => l.targetType === type && l.targetId === id)
        .map((l) => tagById.get(l.tagId)?.name)
        .filter((n): n is string => Boolean(n));

    const notesFor = (type: string, id: string) =>
      notes.filter((n) => n.targetType === type && n.targetId === id);

    const docs: SearchDoc[] = [];

    for (const app of applications) {
      const company = companyById.get(app.companyId);
      const tagNames = tagNamesFor('application', app.id);
      const linkedNotes = notesFor('application', app.id);
      const body = linkedNotes.map((n) => `${n.title} ${n.body}`).join(' ');
      const companyName = company?.name ?? '';
      const location = app.location ?? '';

      docs.push({
        id: `application:${app.id}`,
        type: 'application',
        entityId: app.id,
        title: app.jobTitle,
        company: companyName,
        location,
        tags: tagNames.join(' '),
        body,
        text: [
          app.jobTitle,
          companyName ? `at ${companyName}` : '',
          location,
          app.workMode !== 'unspecified' ? app.workMode : '',
          app.sourceName ?? '',
          tagNames.join(' '),
          body,
        ]
          .filter(Boolean)
          .join(' — '),
      });
    }

    for (const company of companies) {
      const tagNames = tagNamesFor('company', company.id);
      const linkedNotes = notesFor('company', company.id);
      const body = linkedNotes.map((n) => `${n.title} ${n.body}`).join(' ');
      docs.push({
        id: `company:${company.id}`,
        type: 'company',
        entityId: company.id,
        title: company.name,
        company: company.name,
        location: company.location ?? '',
        tags: tagNames.join(' '),
        body,
        text: [company.name, company.location ?? '', tagNames.join(' '), body]
          .filter(Boolean)
          .join(' — '),
      });
    }

    for (const note of notes) {
      docs.push({
        id: `note:${note.id}`,
        type: 'note',
        entityId: note.id,
        title: note.title,
        company: '',
        location: '',
        tags: '',
        body: note.body,
        text: `${note.title} — ${note.body}`,
      });
    }

    return docs;
  }

  /**
   * Bring stored embeddings up to date, computing only what changed.
   *
   * Runs detached from any request. Failures are logged and dropped: an app whose model
   * will not load must still serve lexical search rather than 500.
   */
  async #embedInBackground(): Promise<void> {
    try {
      const ok = await this.#embedder.load();
      if (!ok) return;
      await this.#refreshVectors();
    } catch (error) {
      this.#log('embedding pass failed', error);
    }
  }

  async #refreshVectors(): Promise<void> {
    const stored = await this.#repos.searchVectors.findMany({});
    const storedByKey = new Map(stored.map((row) => [`${row.targetType}:${row.targetId}`, row]));

    const outdated: SearchDoc[] = [];

    for (const doc of this.#docs.values()) {
      const hash = hashText(doc.text);
      const row = storedByKey.get(doc.id);

      // A model change invalidates every vector: two models' vectors are not comparable,
      // and mixing them would silently produce meaningless similarities.
      if (row && row.textHash === hash && row.model === this.#embedder.model) {
        if (!this.#vectors.has(doc.id) && Array.isArray(row.embedding)) {
          this.#vectors.set(doc.id, Float32Array.from(row.embedding as number[]));
        }
        continue;
      }
      outdated.push(doc);
    }

    // Delete vectors whose document is gone, so the table does not grow without bound.
    for (const [key, row] of storedByKey) {
      if (!this.#docs.has(key)) await this.#repos.searchVectors.delete(row.id);
    }

    if (outdated.length === 0) return;

    // Batched so a first run over a seeded database does not hold one enormous tensor.
    const BATCH = 32;
    for (let i = 0; i < outdated.length; i += BATCH) {
      const batch = outdated.slice(i, i + BATCH);
      const vectors = await this.#embedder.embed(batch.map((d) => d.text));

      for (const [index, doc] of batch.entries()) {
        const vector = vectors[index];
        if (!vector) continue;
        this.#vectors.set(doc.id, vector);

        const hash = hashText(doc.text);
        const existing = storedByKey.get(doc.id);
        const payload = {
          targetType: doc.type,
          targetId: doc.entityId,
          model: this.#embedder.model,
          dim: vector.length,
          embedding: Array.from(vector),
          textHash: hash,
        };

        if (existing) await this.#repos.searchVectors.update(existing.id, payload as never);
        else await this.#repos.searchVectors.create(payload);
      }
    }
  }

  /**
   * Run both retrievers and fuse them.
   *
   * When the model is not ready the lexical ranking is returned alone — degraded, but
   * never empty, and the caller is told so it can say as much.
   */
  async search(
    query: string,
    options: { limit?: number; types?: readonly DocType[] } = {},
  ): Promise<SearchOutcome> {
    const limit = options.limit ?? 25;
    const trimmed = query.trim();
    if (!trimmed) return { hits: [], semanticReady: this.semanticReady };

    if (this.#stale) await this.rebuild();

    const typeFilter = options.types && options.types.length > 0 ? new Set(options.types) : null;
    const allowed = (id: string): boolean => {
      const doc = this.#docs.get(id);
      return doc !== undefined && (typeFilter === null || typeFilter.has(doc.type));
    };

    // Over-fetch from each retriever: fusion needs depth to work with, and a document
    // ranked 30th lexically but 2nd semantically should still be able to surface.
    const depth = Math.max(limit * 4, 50);

    const lexicalIds = this.#mini
      .search(trimmed)
      .map((result) => String(result.id))
      .filter(allowed)
      .slice(0, depth);

    const semanticIds = await this.#semanticSearch(trimmed, depth, allowed);

    const fused = reciprocalRankFusion({
      lexical: { ids: lexicalIds },
      semantic: { ids: semanticIds },
    });

    const hits: SearchHit[] = [];
    for (const entry of fused) {
      const doc = this.#docs.get(entry.id);
      if (!doc) continue;
      const matchedBy: ('lexical' | 'semantic')[] = [];
      if (entry.ranks.lexical !== undefined) matchedBy.push('lexical');
      if (entry.ranks.semantic !== undefined) matchedBy.push('semantic');
      hits.push({ type: doc.type, entityId: doc.entityId, score: entry.score, matchedBy });
      if (hits.length >= limit) break;
    }

    return { hits, semanticReady: this.semanticReady };
  }

  async #semanticSearch(
    query: string,
    depth: number,
    allowed: (id: string) => boolean,
  ): Promise<string[]> {
    if (!this.semanticReady) return [];

    try {
      const [queryVector] = await this.#embedder.embed([query]);
      if (!queryVector) return [];

      // Brute force over every vector. At this scale that is a few hundred dot products
      // of 384 floats — microseconds, and a vector database would be pure ceremony.
      const scored: { id: string; score: number }[] = [];
      for (const [id, vector] of this.#vectors) {
        if (!allowed(id)) continue;
        if (vector.length !== queryVector.length) continue;
        const score = cosineSimilarity(queryVector, vector);
        // Below the floor this is a nearest neighbour rather than a match, and letting it
        // into the fusion is how a nonsense query ends up returning the whole table.
        if (score < SEMANTIC_FLOOR) continue;
        scored.push({ id, score });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, depth).map((entry) => entry.id);
    } catch (error) {
      this.#log('semantic search failed; falling back to lexical', error);
      return [];
    }
  }

  /**
   * Cosine similarity between one query string and specific application ids.
   *
   * Used by duplicate detection, which needs "is this the same role written differently"
   * rather than a ranked list. Returns an empty map when the model is not ready, and
   * duplicate detection then falls back to text similarity alone.
   */
  async similarityTo(
    query: string,
    applicationIds: readonly string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (!this.semanticReady || applicationIds.length === 0 || !query.trim()) return result;

    try {
      const [queryVector] = await this.#embedder.embed([query]);
      if (!queryVector) return result;

      for (const id of applicationIds) {
        const vector = this.#vectors.get(`application:${id}`);
        if (!vector || vector.length !== queryVector.length) continue;
        result.set(id, cosineSimilarity(queryVector, vector));
      }
    } catch (error) {
      this.#log('similarity lookup failed', error);
    }
    return result;
  }
}

/**
 * A change-detection fingerprint for `text`, not a security hash — this only decides
 * whether a document's embedding needs recomputing, so a fast, dependency-free non-crypto
 * hash is the right tool. Two FNV-1a passes with different seeds, concatenated, keep the
 * collision risk low enough for that job without pulling in `node:crypto` (this module has
 * no Node built-ins left, which is what lets it run in a browser build too).
 */
function hashText(text: string): string {
  const pass = (seed: number): string => {
    let hash = seed;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  return pass(0x811c9dc5) + pass(0x9e3779b9);
}

/** Exported for the seed script, which reports what it indexed. */
export { formatDateOnly };
export type { Tag };
