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

import { mkdirSync } from 'node:fs';
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
  /** Where app data (the default SQLite file, the model cache, the active-target pointer) lives. */
  dataDir: string;
}

/**
 * Where this process's data lives. Defaults to the repo root — exactly today's behavior, for
 * the monorepo dev/test flows and `npm run tray` run straight off `src/` — but a globally
 * installed CLI (apps/tray's `bin/jobtrack.js`) sets `JOBTRACK_HOME` to a real per-user data
 * directory before this ever runs, since there's no "repo" once this is running out of
 * node_modules.
 */
export function resolveAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.JOBTRACK_HOME ? resolve(env.JOBTRACK_HOME) : repoRoot;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolveAppDataDir(env);
  const targets = loadDbTargets(env);
  const activeName = readActiveTargetName(dataDir, targets);
  const active = targets.find((t) => t.name === activeName) ?? targets[0]!;

  const databaseFile = active.databaseFile ?? resolve(dataDir, 'data', 'jobtrack.db');
  if (active.driver === 'sqlite') {
    // The monorepo's own data/ has always existed by hand; a fresh JOBTRACK_HOME (or a
    // custom DB_FILE pointed at a new folder) has no reason to, and repolayer's SQLite
    // driver doesn't create it for us.
    mkdirSync(dirname(databaseFile), { recursive: true });
  }

  return {
    driver: active.driver,
    databaseFile,
    databaseUrl: active.databaseUrl,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3001),
    modelCacheDir: env.MODEL_CACHE_DIR ?? resolve(dataDir, '.models'),
    embeddingModel: env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
    semanticSearchEnabled: env.SEMANTIC_SEARCH !== 'false',
    dbTargets: targets.map((t) => ({ name: t.name, driver: t.driver })),
    activeDbTarget: active.name,
    dataDir,
  };
}

/** Repo root, for anything else that needs to resolve a path the same way this module does. */
export { repoRoot };
