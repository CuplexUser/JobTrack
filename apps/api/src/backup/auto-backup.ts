/**
 * Automatic backups: snapshot → encode → encrypt (if set up) → write to the destination →
 * apply retention → record how it went.
 *
 * The scheduler calls `runScheduledBackup` every few minutes and it decides whether anything
 * is due; "Back up now" calls `runAutoBackup` directly. Both go through one in-flight guard,
 * so a slow network share never ends up with two backups being written at once.
 */

import { createHash } from 'node:crypto';
import type { BackupConfig, BackupFile, BackupRunResult, BackupStatus, BackupTestResult } from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { encodeSnapshot } from './codec.js';
import { BackupConfigStore, type StoredState } from './config-store.js';
import { checkRecipient, encryptBackup, type CryptoOptions, type EncryptionKeys } from './crypto.js';
import { openDestination } from './destinations/index.js';
import { backupFileName, expiredBackups, nextDue } from './schedule.js';
import { createSnapshot } from './snapshot.js';

export interface AutoBackupContext {
  repos: Repos;
  store: BackupConfigStore;
  /** The active database target's name, which goes into every file name. */
  target: string;
  crypto?: CryptoOptions;
  now?: () => Date;
}

/** The keys a backup is encrypted to, or null when encryption is off. Throws when it is on but incomplete. */
export function encryptionKeys(config: BackupConfig, store: BackupConfigStore): EncryptionKeys | null {
  switch (config.encryption.mode) {
    case 'none':
      return null;
    case 'passphrase': {
      const passphrase = store.getPassphrase();
      if (!passphrase) throw new Error('Passphrase encryption is on, but no passphrase is saved');
      return { kind: 'passphrase', passphrase };
    }
    case 'recipients':
      return { kind: 'recipients', recipients: config.encryption.recipients.map((entry) => entry.recipient) };
  }
}

/**
 * A backup file of the current database, encrypted as configured. Shared with the manual
 * "Export backup" download, so both produce the same kind of file.
 */
export async function buildBackupFile(
  repos: Repos,
  config: BackupConfig,
  store: BackupConfigStore,
  options: { crypto?: CryptoOptions } = {},
): Promise<{ data: Buffer; encrypted: boolean; hash: string }> {
  const snapshot = await createSnapshot(repos);
  // What was backed up, not when: `exportedAt` changes every time. The encryption settings
  // are part of it, so changing keys produces a fresh backup under the new keys.
  const hash = createHash('sha256')
    .update(JSON.stringify(snapshot.tables))
    .update(JSON.stringify(config.encryption))
    .digest('hex');

  const plain = encodeSnapshot(snapshot);
  const keys = encryptionKeys(config, store);
  if (!keys) return { data: plain, encrypted: false, hash };
  return { data: await encryptBackup(plain, keys, options.crypto), encrypted: true, hash };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let running: Promise<BackupRunResult> | null = null;

/**
 * Write a backup now. `force` writes one even when nothing has changed; "Back up now" always
 * forces, the scheduler never does.
 */
export function runAutoBackup(context: AutoBackupContext, options: { force?: boolean } = {}): Promise<BackupRunResult> {
  running ??= runOnce(context, options.force ?? false).finally(() => {
    running = null;
  });
  return running;
}

async function runOnce(context: AutoBackupContext, force: boolean): Promise<BackupRunResult> {
  const { store } = context;
  const now = context.now?.() ?? new Date();
  const config = store.getConfig();
  const previous = store.getState();
  const state: StoredState = { ...previous, lastRunAt: now.toISOString() };

  try {
    const destination = openDestination(config.destination);
    const file = await buildBackupFile(context.repos, config, store, { crypto: context.crypto });

    if (!force && config.skipUnchanged && file.hash === previous.lastHash && previous.lastFile) {
      const existing = await destination.list();
      if (existing.some((entry) => entry.name === previous.lastFile)) {
        store.setState({ ...state, lastError: null, lastSkippedAt: now.toISOString() });
        return { outcome: 'skipped', file: null, removed: [] };
      }
    }

    const name = backupFileName(context.target, now, file.encrypted);
    await destination.write(name, file.data);
    store.setState({ ...state, lastSuccessAt: now.toISOString(), lastError: null, lastFile: name, lastHash: file.hash });

    // Retention only after a good write, so a failing destination never loses old backups too.
    const removed: string[] = [];
    try {
      const names = (await destination.list()).map((entry) => entry.name);
      for (const expired of expiredBackups(names, context.target, config.retention, now)) {
        await destination.remove(expired);
        removed.push(expired);
      }
    } catch {
      // Leaving an old backup behind is not worth failing a backup that was written.
    }
    return { outcome: 'written', file: name, removed };
  } catch (error) {
    store.setState({ ...state, lastError: describe(error) });
    throw error;
  }
}

/** Called on the scheduler's tick: runs a backup only when one is due. */
export async function runScheduledBackup(context: AutoBackupContext): Promise<BackupRunResult | null> {
  const config = context.store.getConfig();
  if (!config.enabled) return null;
  const now = context.now?.() ?? new Date();
  if (nextDue(config.schedule, context.store.getState(), now) > now) return null;
  return runAutoBackup(context);
}

export function backupStatus(store: BackupConfigStore, now: Date = new Date()): BackupStatus {
  const config = store.getConfig();
  const { lastHash: _hash, ...state } = store.getState();
  return {
    config,
    hasPassphrase: store.getPassphrase() !== null,
    state,
    nextRunAt: config.enabled ? new Date(Math.max(now.getTime(), nextDue(config.schedule, state, now).getTime())).toISOString() : null,
  };
}

export async function listBackups(config: BackupConfig): Promise<BackupFile[]> {
  const stored = await openDestination(config.destination).list();
  return stored.map((entry) => ({
    name: entry.name,
    size: entry.size,
    modifiedAt: entry.modifiedAt.toISOString(),
    encrypted: entry.name.endsWith('.age'),
  }));
}

/**
 * Everything that would make the next backup fail, checked without writing a backup: the
 * folder, the passphrase, and each key (including whether a plugin key's plugin is installed).
 */
export async function testBackupSetup(
  config: BackupConfig,
  store: BackupConfigStore,
  options: { crypto?: CryptoOptions } = {},
): Promise<BackupTestResult> {
  const problems: string[] = [];

  try {
    await openDestination(config.destination).test();
  } catch (error) {
    problems.push(describe(error));
  }

  if (config.encryption.mode === 'passphrase' && store.getPassphrase() === null) {
    problems.push('Passphrase encryption is on, but no passphrase is saved');
  }
  if (config.encryption.mode === 'recipients') {
    for (const entry of config.encryption.recipients) {
      const problem = await checkRecipient(entry.recipient, options.crypto);
      if (problem) problems.push(`${entry.label || entry.recipient.slice(0, 20) + '…'}: ${problem}`);
    }
  }

  return { ok: problems.length === 0, problems };
}
