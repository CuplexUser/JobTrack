/**
 * Text -> vector.
 *
 * Declared as an interface with several implementations for one reason: tests (and the
 * client-side demo build) must never download a 25 MB ONNX model, and the app must keep
 * working on a machine where the model cannot be loaded at all. Everything downstream
 * depends on `Embedder`, so swapping in a deterministic fake is a constructor argument
 * rather than a mocking framework.
 *
 * The real implementation, `TransformersEmbedder`, lives in `transformers-embedder.ts`
 * instead of here — see that file's header for why the split matters.
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
