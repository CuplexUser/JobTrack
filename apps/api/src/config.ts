/**
 * Environment configuration.
 *
 * The driver lives here and nowhere else. Moving this app to Postgres is meant to be
 * `DB_DRIVER=postgres npm i pg` plus a `DATABASE_URL` — if any other module ever learns
 * which engine it is talking to, that promise has quietly stopped being true.
 *
 * When `.env` defines more than one target (`DB_TARGETS`, see `db/targets.ts`), which one is
 * *active* is decided by a separate pointer file the app writes to itself — never by editing
 * `.env` — so connection settings stay entirely out of reach of anything but the person
 * editing `.env` by hand.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDbTargets, readActiveTargetName, type DriverName } from './db/targets.js';

const here = dirname(fileURLToPath(import.meta.url));
/** apps/api/src -> repo root */
const repoRoot = resolve(here, '../../..');

export type { DriverName };

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
  /** Every target `.env` defines — driver kind only, never a file path or connection string. */
  dbTargets: { name: string; driver: DriverName }[];
  /** Which of `dbTargets` this process actually connected to. */
  activeDbTarget: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const targets = loadDbTargets(env);
  const activeName = readActiveTargetName(repoRoot, targets);
  const active = targets.find((t) => t.name === activeName) ?? targets[0]!;

  return {
    driver: active.driver,
    databaseFile: active.databaseFile ?? resolve(repoRoot, 'data', 'jobtrack.db'),
    databaseUrl: active.databaseUrl,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3001),
    modelCacheDir: env.MODEL_CACHE_DIR ?? resolve(repoRoot, '.models'),
    embeddingModel: env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
    semanticSearchEnabled: env.SEMANTIC_SEARCH !== 'false',
    dbTargets: targets.map((t) => ({ name: t.name, driver: t.driver })),
    activeDbTarget: active.name,
  };
}

/** Repo root, for anything else that needs to resolve a path the same way this module does. */
export { repoRoot };
