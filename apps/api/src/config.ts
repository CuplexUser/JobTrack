/**
 * Environment configuration.
 *
 * The driver lives here and nowhere else. Moving this app to Postgres is meant to be
 * `DB_DRIVER=postgres npm i pg` plus a `DATABASE_URL` — if any other module ever learns
 * which engine it is talking to, that promise has quietly stopped being true.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** apps/api/src -> repo root */
const repoRoot = resolve(here, '../../..');

export type DriverName = 'sqlite' | 'postgres' | 'mysql';

function readDriver(): DriverName {
  const value = (process.env.DB_DRIVER ?? 'sqlite').toLowerCase();
  if (value === 'sqlite' || value === 'postgres' || value === 'mysql') return value;
  throw new Error(
    `DB_DRIVER must be sqlite, postgres or mysql (got ${JSON.stringify(process.env.DB_DRIVER)})`,
  );
}

export interface Config {
  driver: DriverName;
  /** SQLite only. */
  databaseFile: string;
  /** Postgres and MySQL only. */
  databaseUrl: string | undefined;
  host: string;
  port: number;
  /** Where transformers.js caches the ONNX model, so it downloads once per machine. */
  modelCacheDir: string;
  /** The embedding model. Small, good, and public-domain-ish enough to vendor a cache of. */
  embeddingModel: string;
  /**
   * Turning this off skips loading the ONNX model entirely and leaves search purely
   * lexical. Useful in tests and on machines that would rather not spend the 25 MB.
   */
  semanticSearchEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    driver: readDriver(),
    databaseFile: env.DB_FILE ?? resolve(repoRoot, 'data', 'jobtrack.db'),
    databaseUrl: env.DATABASE_URL,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3001),
    modelCacheDir: env.MODEL_CACHE_DIR ?? resolve(repoRoot, '.models'),
    embeddingModel: env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
    semanticSearchEnabled: env.SEMANTIC_SEARCH !== 'false',
  };
}
