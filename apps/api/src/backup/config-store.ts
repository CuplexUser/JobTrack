/**
 * Automatic backup settings and run history, kept as files in the app data directory rather
 * than in `app_settings`.
 *
 * `app_settings` is inside every backup and is replaced on restore, so a schedule kept there
 * would be rolled back by restoring an older backup, and every backup would carry its own
 * configuration. Files beside `api-token` and `active-db.json` (see `lib/api-token.ts`) avoid
 * both, and follow the same rule: `data/` holds what the app writes for itself.
 *
 * - `backup.json`: the settings. No secrets; public keys only.
 * - `backup-secret`: the passphrase, only when passphrase encryption is used, since a
 *   scheduled run has nobody to type it. It protects the copies in the cloud or on the network
 *   share, not this machine, which the UI says plainly.
 * - `backup-state.json`: when it last ran and how that went.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  backupConfigSchema,
  type BackupConfig,
  type BackupConfigPatch,
  type BackupRunState,
} from '@jobtrack/shared';

const CONFIG_FILE = 'backup.json';
const SECRET_FILE = 'backup-secret';
const STATE_FILE = 'backup-state.json';

export const EMPTY_STATE: BackupRunState = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastFile: null,
  lastSkippedAt: null,
};

export interface StoredState extends BackupRunState {
  /** Hash of the last backed-up snapshot's tables, for skipping runs when nothing changed. */
  lastHash: string | null;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Private to this user where the filesystem can say so. Meaningless on Windows, harmless there. */
function writePrivate(path: string, contents: string): void {
  writeFileSync(path, contents, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // A filesystem without permissions is not a reason to fail.
  }
}

export class BackupConfigStore {
  readonly #folder: string;

  constructor(dataDir: string) {
    this.#folder = resolve(dataDir, 'data');
  }

  #path(name: string): string {
    return resolve(this.#folder, name);
  }

  #ensureFolder(): void {
    mkdirSync(this.#folder, { recursive: true });
  }

  /** A file that no longer parses reads as the defaults (off), rather than failing every request. */
  getConfig(): BackupConfig {
    const parsed = backupConfigSchema.safeParse(readJson(this.#path(CONFIG_FILE)) ?? {});
    return parsed.success ? parsed.data : backupConfigSchema.parse({});
  }

  /** Merges the sections sent and validates the whole result, so a patch cannot leave it inconsistent. */
  updateConfig(patch: Partial<BackupConfigPatch>): BackupConfig {
    const sent = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const next = backupConfigSchema.parse({ ...this.getConfig(), ...sent });
    this.#ensureFolder();
    writeFileSync(this.#path(CONFIG_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return next;
  }

  getPassphrase(): string | null {
    const path = this.#path(SECRET_FILE);
    if (!existsSync(path)) return null;
    const value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
    return value === '' ? null : value;
  }

  setPassphrase(passphrase: string | null): void {
    const path = this.#path(SECRET_FILE);
    if (passphrase === null) {
      rmSync(path, { force: true });
      return;
    }
    this.#ensureFolder();
    writePrivate(path, `${passphrase}\n`);
  }

  getState(): StoredState {
    const stored = readJson(this.#path(STATE_FILE));
    return { ...EMPTY_STATE, lastHash: null, ...(typeof stored === 'object' && stored !== null ? stored : {}) };
  }

  setState(state: StoredState): void {
    this.#ensureFolder();
    writeFileSync(this.#path(STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
}
