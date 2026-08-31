/**
 * `.env` actually being read.
 *
 * This existed as documentation long before it existed as behavior: `.env.example` told
 * people to copy it, the README listed every variable, and the tray's "Open App Settings"
 * opened the file in Notepad — while nothing in the project ever loaded it. No dotenv
 * dependency, no `--env-file` flag on any script, and `tsx` does not do it either. Settings
 * written there were silently ignored, and the only reason it went unnoticed is that the
 * defaults are right for the common case and the documented Postgres example happens to put
 * the variables on the command line.
 *
 * So: a test that reads a real file from a real directory, because the bug was precisely
 * that no code path connected the two.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadEnvFile } from '../src/config.js';

let home: string;
/** Only the keys these tests set, so the suite cannot leak into the rest of the run. */
const TOUCHED = ['API_TOKEN', 'PORT', 'CORS_ORIGINS', 'PROBE_ONLY_IN_FILE'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'jobtrack-env-'));
  saved = Object.fromEntries(TOUCHED.map((key) => [key, process.env[key]]));
  for (const key of TOUCHED) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
});

function writeEnv(contents: string): void {
  writeFileSync(join(home, '.env'), contents, 'utf8');
}

describe('loadEnvFile', () => {
  it('reads the file from the app data directory', () => {
    writeEnv('API_TOKEN=from-the-file\nPROBE_ONLY_IN_FILE=yes\n');

    const path = loadEnvFile({ JOBTRACK_HOME: home });

    expect(path).toBe(resolve(home, '.env'));
    expect(process.env.API_TOKEN).toBe('from-the-file');
    expect(process.env.PROBE_ONLY_IN_FILE).toBe('yes');
  });

  it('lets a real environment variable win over the file', () => {
    process.env.PORT = '3002';
    writeEnv('PORT=3001\n');

    loadEnvFile({ JOBTRACK_HOME: home });

    // `PORT=3002 npm run dev:api` has to keep meaning 3002 whatever `.env` says.
    expect(process.env.PORT).toBe('3002');
  });

  it('ignores comments and blank lines the way .env.example is written', () => {
    writeEnv('# a comment\n\nCORS_ORIGINS=http://localhost:4173\n');

    loadEnvFile({ JOBTRACK_HOME: home });

    expect(process.env.CORS_ORIGINS).toBe('http://localhost:4173');
  });

  it('is a no-op when there is no file, which is the normal case', () => {
    expect(loadEnvFile({ JOBTRACK_HOME: home })).toBeNull();
    expect(process.env.API_TOKEN).toBeUndefined();
  });
});
