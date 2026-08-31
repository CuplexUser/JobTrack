/**
 * Where a configured path lands.
 *
 * `DB_FILE=data/jobtrack.db` — the line `.env.example` ships — was passed to the SQLite
 * driver exactly as written, which made it relative to the working directory: `npm run
 * dev:api` runs in `apps/api`, so the API opened `apps/api/data/jobtrack.db` while the tray
 * and the CLI opened `data/jobtrack.db` at the repo root. One setting, two databases, and
 * which one you were looking at depended on how you had started the app.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { writeActiveTargetName } from '../src/db/targets.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'jobtrack-config-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('puts the database in data/ when nothing is configured', () => {
    expect(loadConfig({ JOBTRACK_HOME: home }).databaseFile).toBe(resolve(home, 'data', 'jobtrack.db'));
  });

  it('keeps DB_FILE=data/jobtrack.db meaning the same file it always did', () => {
    const config = loadConfig({ JOBTRACK_HOME: home, DB_FILE: 'data/jobtrack.db' });
    expect(config.databaseFile).toBe(resolve(home, 'data', 'jobtrack.db'));
  });

  it('reads a bare filename as a second database in the same data folder', () => {
    const config = loadConfig({ JOBTRACK_HOME: home, DB_FILE: 'work.db' });
    expect(config.databaseFile).toBe(resolve(home, 'data', 'work.db'));
  });

  it('leaves an absolute DB_FILE exactly as written', () => {
    const absolute = resolve(home, 'elsewhere', 'jobtrack.db');
    expect(loadConfig({ JOBTRACK_HOME: home, DB_FILE: absolute }).databaseFile).toBe(absolute);
  });

  it('resolves a sqlite DB_TARGETS entry by the same rule', () => {
    const env = {
      JOBTRACK_HOME: home,
      DB_TARGETS: JSON.stringify([{ name: 'scratch', driver: 'sqlite', file: 'scratch.db' }]),
    };
    writeActiveTargetName(home, 'scratch');

    const config = loadConfig(env);
    expect(config.activeDbTarget).toBe('scratch');
    expect(config.databaseFile).toBe(resolve(home, 'data', 'scratch.db'));
  });

  it('resolves the model cache from the data directory too', () => {
    expect(loadConfig({ JOBTRACK_HOME: home }).modelCacheDir).toBe(resolve(home, '.models'));
    expect(loadConfig({ JOBTRACK_HOME: home, MODEL_CACHE_DIR: 'cache' }).modelCacheDir).toBe(
      resolve(home, 'cache'),
    );
  });
});
