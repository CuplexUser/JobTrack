/**
 * The real embedder: all-MiniLM-L6-v2 through transformers.js, running on onnxruntime-node.
 *
 * Kept in its own module, separate from `embedder.ts`'s `DisabledEmbedder`/`FakeEmbedder`,
 * for one reason: its `@huggingface/transformers` import (below) pulls in onnxruntime's
 * ~23 MB WASM binary. Anything that only needs the lightweight embedders — the test suite,
 * and `apps/web`'s client-side demo build — imports `./embedder.js` and never touches this
 * file, so that binary never ends up in their bundle. Everything that runs a real server
 * (`apps/api/src/index.ts`, `apps/tray`, `apps/mcp`) imports both.
 *
 * Loading is lazy and non-blocking — the API answers requests immediately and search is
 * lexical-only until this finishes. A failure here is downgraded to "semantic search is
 * off", never an unhandled rejection that takes the process with it.
 */

import type { Embedder } from './embedder.js';

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

      // enableCpuMemArena: false is what keeps this process at ~220 MB instead of ~2 GB.
      // onnxruntime's CPU arena reserves for the largest tensor shape it has ever seen and
      // never gives it back, and the largest here is a full batch at the model's 512-token
      // limit — measured at 1.9 GB resident, held for the life of the process long after the
      // embedding pass finished. Without the arena each inference allocates and frees, which
      // cost ~30% on a one-time background pass and is a trade worth making for a tray app
      // that sits idle all day.
      const extractor = await transformers.pipeline('feature-extraction', this.model, {
        session_options: { enableCpuMemArena: false },
      });
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
