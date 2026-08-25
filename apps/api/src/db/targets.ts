/**
 * Multiple configured database targets, and which one is currently active.
 *
 * `.env` stays the only place connection settings live — this module only ever *reads* it.
 * The one thing the app writes for itself is which target is active, and that lives in a
 * separate pointer file that carries a name, never a connection string or credential.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type DriverName = 'sqlite' | 'postgres' | 'mysql';

export interface DbTarget {
  name: string;
  driver: DriverName;
  /** SQLite only. */
  databaseFile?: string;
  /** Postgres and MySQL only. */
  databaseUrl?: string;
}

/** The name reserved for the target synthesized from `DB_DRIVER` / `DB_FILE` / `DATABASE_URL`. */
export const DEFAULT_TARGET_NAME = 'default';

interface RawTarget {
  name?: unknown;
  driver?: unknown;
  file?: unknown;
  url?: unknown;
}

function validateTarget(raw: RawTarget, index: number): DbTarget {
  const name = raw.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`DB_TARGETS[${index}] is missing a "name"`);
  }
  if (name === DEFAULT_TARGET_NAME) {
    throw new Error(`DB_TARGETS[${index}] cannot be named "${DEFAULT_TARGET_NAME}" — that name is reserved for DB_DRIVER`);
  }

  const driver = raw.driver;
  if (driver !== 'sqlite' && driver !== 'postgres' && driver !== 'mysql') {
    throw new Error(`DB_TARGETS[${index}] ("${name}") has an invalid driver ${JSON.stringify(driver)} — must be sqlite, postgres or mysql`);
  }

  if (driver === 'sqlite') {
    if (typeof raw.file !== 'string' || raw.file.trim() === '') {
      throw new Error(`DB_TARGETS[${index}] ("${name}") is sqlite and needs a "file"`);
    }
    return { name, driver, databaseFile: raw.file };
  }

  if (typeof raw.url !== 'string' || raw.url.trim() === '') {
    throw new Error(`DB_TARGETS[${index}] ("${name}") is ${driver} and needs a "url"`);
  }
  return { name, driver, databaseUrl: raw.url };
}

/**
 * The implicit target plus whatever `DB_TARGETS` adds.
 *
 * An unmodified `.env` produces exactly one target named "default" — the same driver/file/url
 * `loadConfig` has always read — so nothing about existing deployments changes unless
 * `DB_TARGETS` is set.
 */
export function loadDbTargets(env: NodeJS.ProcessEnv): DbTarget[] {
  const driver = (env.DB_DRIVER ?? 'sqlite').toLowerCase();
  if (driver !== 'sqlite' && driver !== 'postgres' && driver !== 'mysql') {
    throw new Error(`DB_DRIVER must be sqlite, postgres or mysql (got ${JSON.stringify(env.DB_DRIVER)})`);
  }

  const defaultTarget: DbTarget =
    driver === 'sqlite'
      ? { name: DEFAULT_TARGET_NAME, driver, databaseFile: env.DB_FILE }
      : { name: DEFAULT_TARGET_NAME, driver, databaseUrl: env.DATABASE_URL };

  const targets = [defaultTarget];

  const raw = env.DB_TARGETS;
  if (raw && raw.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`DB_TARGETS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(parsed)) throw new Error('DB_TARGETS must be a JSON array');

    const seen = new Set([DEFAULT_TARGET_NAME]);
    parsed.forEach((entry, index) => {
      const target = validateTarget(entry as RawTarget, index);
      if (seen.has(target.name)) throw new Error(`DB_TARGETS has more than one target named "${target.name}"`);
      seen.add(target.name);
      targets.push(target);
    });
  }

  return targets;
}

/** Where the active target's name is remembered, independent of `.env`. */
function pointerPath(repoRoot: string): string {
  return resolve(repoRoot, 'data', 'active-db.json');
}

/**
 * Which target should be active, falling back to "default" whenever the pointer is missing,
 * unreadable, or names a target `.env` no longer defines — so editing `DB_TARGETS` can never
 * strand the app on a target it can't find.
 */
export function readActiveTargetName(repoRoot: string, targets: readonly DbTarget[]): string {
  try {
    const raw = readFileSync(pointerPath(repoRoot), 'utf8');
    const parsed = JSON.parse(raw) as { target?: unknown };
    if (typeof parsed.target === 'string' && targets.some((t) => t.name === parsed.target)) {
      return parsed.target;
    }
  } catch {
    // No pointer file yet, or it's unreadable/invalid — the default target is always safe.
  }
  return DEFAULT_TARGET_NAME;
}

export function writeActiveTargetName(repoRoot: string, name: string): void {
  const path = pointerPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ target: name }), 'utf8');
}
