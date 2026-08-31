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

import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDbTargets, readActiveTargetName, type DriverName } from './db/targets.js';
import { resolveApiToken } from './lib/api-token.js';

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
  /**
   * Browser origins allowed to call the API without a token — this app's own UI, in other
   * words. Everything else needs `apiToken`; see `lib/request-guard.ts`.
   */
  corsOrigins: string[];
  /** The shared secret a browser extension presents. Generated on first run. */
  apiToken: string;
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

/**
 * Read `.env` into `process.env`.
 *
 * This has to be called by an entry point *before* `loadConfig`, and until it existed
 * nothing did: there is no dotenv dependency in this project and no `--env-file` flag on any
 * script, and `tsx` does not load one either. So every variable documented in `.env.example`
 * was quietly ignored when it was written to a file rather than exported into the shell —
 * including the connection settings the tray's "Open App Settings" menu item opens that very
 * file to edit.
 *
 * The file is looked for in the app data directory, which is where the tray writes and opens
 * it: the repo root for a clone, `%APPDATA%\jobtrack` (or `~/.local/share/jobtrack`) for an
 * installed `jobtrack`.
 *
 * A real environment variable always wins over the file — that is `process.loadEnvFile`'s
 * own behavior, and it is what keeps `PORT=3002 npm run dev:api` overriding a `.env` that
 * says otherwise.
 */
export function loadEnvFile(env: NodeJS.ProcessEnv = process.env): string | null {
  const path = resolve(resolveAppDataDir(env), '.env');
  if (!existsSync(path)) return null;
  try {
    process.loadEnvFile(path);
    return path;
  } catch (error) {
    // A malformed `.env` must not stop the app from starting — it would leave someone with
    // an app that will not boot and no way to see why, given this runs before any logging.
    console.warn(`[config] could not read ${path}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Where `DB_FILE` (or the `file` of a `DB_TARGETS` entry) actually points.
 *
 * Nothing resolved it before, so the path went to the SQLite driver as written and landed
 * relative to the working directory — `apps/api/data/jobtrack.db` under `npm run dev:api`,
 * `data/jobtrack.db` under the tray. One configured path, two databases, and which one you
 * were looking at depended on how the app had been started.
 *
 * The base is the app data directory, so `data/jobtrack.db` keeps meaning exactly what it
 * has always meant. A *bare filename* is the case worth bending for: `DB_FILE=work.db`
 * plainly means "the same place, a different database", so it lands in `data/` beside the
 * default rather than loose at the top of the data directory. An absolute path is used as
 * written.
 */
function resolveDatabaseFile(dataDir: string, configured: string | undefined): string {
  const dataFolder = resolve(dataDir, 'data');
  if (configured === undefined || configured.trim() === '') return resolve(dataFolder, 'jobtrack.db');
  const trimmed = configured.trim();
  return /[\/]/.test(trimmed) ? resolve(dataDir, trimmed) : resolve(dataFolder, trimmed);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = resolveAppDataDir(env);
  const targets = loadDbTargets(env);
  const activeName = readActiveTargetName(dataDir, targets);
  const active = targets.find((t) => t.name === activeName) ?? targets[0]!;

  const databaseFile = resolveDatabaseFile(dataDir, active.databaseFile);
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
    modelCacheDir: resolve(dataDir, env.MODEL_CACHE_DIR ?? '.models'),
    embeddingModel: env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
    semanticSearchEnabled: env.SEMANTIC_SEARCH !== 'false',
    dbTargets: targets.map((t) => ({ name: t.name, driver: t.driver })),
    activeDbTarget: active.name,
    dataDir,
    corsOrigins: loadCorsOrigins(env),
    apiToken: resolveApiToken(dataDir, env),
  };
}

/**
 * The origins this app's own UI is served from.
 *
 * The tray serves the SPA from the same address it binds, so that one is derived rather
 * than configured — both `localhost` and `127.0.0.1` spellings, because which one appears
 * in the address bar depends on how the browser was opened. `:5173` is the Vite dev server,
 * which in development is genuinely cross-origin to the API on another port.
 */
function loadCorsOrigins(env: NodeJS.ProcessEnv): string[] {
  const host = env.HOST ?? '127.0.0.1';
  const port = Number(env.PORT ?? 3001);
  const origins = new Set<string>([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]);
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '0.0.0.0') {
    origins.add(`http://${host}:${port}`);
  }
  for (const entry of (env.CORS_ORIGINS ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed !== '') origins.add(trimmed);
  }
  return [...origins];
}

/** Repo root, for anything else that needs to resolve a path the same way this module does. */
export { repoRoot };
