/**
 * The local API token.
 *
 * Until the browser extension existed, nothing outside this machine's own pages ever called
 * the API and `cors({ origin: true })` was harmless enough. It is not: a reflecting CORS
 * policy with no authentication means *any* page you happen to visit can POST to
 * 127.0.0.1:3001 and write into your database, and you would never see it happen.
 *
 * So requests are judged by origin (see `lib/request-guard.ts`), and anything from an
 * origin that is not on the list has to present this token instead — which is how the
 * extension gets in, since its `chrome-extension://<id>` origin is not knowable until it is
 * installed.
 *
 * The token is a file, not a setting: generated on first run, sitting next to the
 * active-target pointer in the app data directory, in the same spirit as
 * `db/targets.ts` — the app writes only what it generated itself, and `.env` stays the
 * place a *person* configures things.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';

export const TOKEN_FILENAME = 'api-token';

/**
 * Next to `data/active-db.json`, the other thing the app writes for itself. Same directory
 * for the same reason: `.env` is what a person edits, `data/` is what the app keeps.
 */
export function apiTokenPath(dataDir: string): string {
  return resolve(dataDir, 'data', TOKEN_FILENAME);
}

/** URL-safe, 192 bits. Long enough that guessing it is not a strategy. */
function generate(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Read the token for this data directory, creating it on first run.
 *
 * `API_TOKEN` in the environment wins and is never written to disk — that is the path for a
 * deployment that manages its own secrets, and for tests, which should not be leaving files
 * behind in anyone's home directory.
 */
export function resolveApiToken(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.API_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const path = apiTokenPath(dataDir);
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing !== '') return existing;
  }

  const token = generate();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${token}\n`, 'utf8');
  // Best effort: meaningless on Windows, worth doing everywhere else.
  try {
    chmodSync(path, 0o600);
  } catch {
    // A filesystem that cannot express permissions is not a reason to fail startup.
  }
  return token;
}
