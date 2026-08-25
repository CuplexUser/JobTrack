/**
 * Text -> vector.
 *
 * Declared as an interface with two implementations for one reason: tests must never
 * download a 25 MB ONNX model, and the app must keep working on a machine where the model
 * cannot be loaded at all. Everything downstream depends on `Embedder`, so swapping in a
 * deterministic fake is a constructor argument rather than a mocking framework.
 */

export interface Embedder {
  /** Model identifier, stored on each vector so a model change invalidates old rows. */
  readonly model: string;
  /** Vector width. Zero until the model has actually loaded. */
  readonly dim: number;
  /** False while loading, and forever if loading failed. */
  readonly ready: boolean;
  /** Begin loading. Safe to call repeatedly; resolves to whether the model is usable. */
  load(): Promise<boolean>;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
}

/**
 * The real one: all-MiniLM-L6-v2 through transformers.js, running on onnxruntime-node.
 *
 * Loading is lazy and non-blocking — the API answers requests immediately and search is
 * lexical-only until this finishes. A failure here is downgraded to "semantic search is
 * off", never an unhandled rejection that takes the process with it.
 */
export class TransformersEmbedder implements Embedder {
  readonly model: string;
  #dim = 0;
  #ready = false;
  #loading: Promise<boolean> | null = null;
  #extractor: ((texts: readonly string[], options: object) => Promise<unknown>) | null = null;
  #cacheDir: string;
  #onError: (error: unknown) => void;

  constructor(options: { model: string; cacheDir: string; onError?: (error: unknown) => void }) {
    this.model = options.model;
    this.#cacheDir = options.cacheDir;
    this.#onError = options.onError ?? (() => {});
  }

  get dim(): number {
    return this.#dim;
  }

  get ready(): boolean {
    return this.#ready;
  }

  load(): Promise<boolean> {
    this.#loading ??= this.#doLoad();
    return this.#loading;
  }

  async #doLoad(): Promise<boolean> {
    try {
      const transformers = await import('@huggingface/transformers');
      // Cache to a project-local directory so the download happens once per machine and
      // an offline run afterwards works without any network at all.
      transformers.env.cacheDir = this.#cacheDir;

      const extractor = await transformers.pipeline('feature-extraction', this.model);
      this.#extractor = extractor as never;

      // Probe once to learn the width rather than hard-coding 384 for a model the user
      // could have overridden through EMBEDDING_MODEL.
      const probe = await this.embedRaw(['dimension probe']);
      this.#dim = probe[0]?.length ?? 0;
      this.#ready = this.#dim > 0;
      return this.#ready;
    } catch (error) {
      this.#onError(error);
      this.#ready = false;
      return false;
    }
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (!this.#ready) {
      const ok = await this.load();
      if (!ok) throw new Error('Embedder is not available');
    }
    return this.embedRaw(texts);
  }

  private async embedRaw(texts: readonly string[]): Promise<Float32Array[]> {
    if (!this.#extractor) throw new Error('Embedder is not loaded');
    if (texts.length === 0) return [];

    // Mean pooling over tokens, then L2 normalization — which is what makes cosine
    // similarity reduce to a dot product and keeps scores comparable across texts of very
    // different lengths.
    const output = (await this.#extractor([...texts], {
      pooling: 'mean',
      normalize: true,
    })) as { tolist(): number[][] };

    return output.tolist().map((row) => Float32Array.from(row));
  }
}

/** Stands in when semantic search is disabled. Never ready, never throws on load. */
export class DisabledEmbedder implements Embedder {
  readonly model = 'disabled';
  readonly dim = 0;
  readonly ready = false;

  async load(): Promise<boolean> {
    return false;
  }

  async embed(): Promise<Float32Array[]> {
    throw new Error('Semantic search is disabled');
  }
}

/**
 * A deterministic hashing embedder for tests.
 *
 * Not semantically meaningful, but stable and dependency-free, which is exactly what a
 * test of the *plumbing* needs: identical text yields identical vectors, so caching,
 * re-embedding and the fusion path can all be asserted without a model.
 */
export class FakeEmbedder implements Embedder {
  readonly model = 'fake-hash-v1';
  readonly dim: number;
  ready = true;

  constructor(dim = 32) {
    this.dim = dim;
  }

  async load(): Promise<boolean> {
    return true;
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const vector = new Float32Array(this.dim);
      // Bag-of-words hashing: shared words produce genuinely overlapping vectors, so
      // "backend engineer" scores higher against "senior backend engineer" than against
      // "graphic designer" — enough structure to make tests meaningful.
      for (const word of text.toLowerCase().split(/\W+/).filter(Boolean)) {
        let hash = 0;
        for (let i = 0; i < word.length; i += 1) {
          hash = (hash * 31 + word.charCodeAt(i)) | 0;
        }
        const slot = Math.abs(hash) % this.dim;
        vector[slot] = (vector[slot] ?? 0) + 1;
      }
      let norm = 0;
      for (const value of vector) norm += value * value;
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < vector.length; i += 1) vector[i] = (vector[i] ?? 0) / norm;
      return vector;
    });
  }
}
