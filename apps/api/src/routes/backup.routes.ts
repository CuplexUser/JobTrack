/**
 * Full-fidelity backup export/import — reset, disaster recovery, and SQLite<->Postgres
 * migration. See `backup/snapshot.ts` for why this is a separate thing from the CSV/XLSX
 * `export`/`import` routes.
 *
 * Same shape as `import.routes.ts`: the frontend posts the same file twice, once for preview
 * (counts only, nothing touched) and once to commit, so there's no server-side upload state
 * to manage between the two.
 *
 * `status`/`clear`/`seed` round out the same "get rid of the demo data" job the export/import
 * pair started with: `status` is what lets the Settings page know the database is empty (and
 * so it's safe to offer seeding), `clear` empties every backed-up table without needing a
 * snapshot at all, and `seed` writes the same demo dataset `npm run seed` does — refusing to
 * run over an already-populated database, since it has no `--force` flag to reach for the
 * way the CLI does.
 *
 * `/api/backup/auto…` is the automatic side: scheduled backups to a folder, optionally
 * encrypted (see `backup/auto-backup.ts`). Its settings live in files beside the API token
 * rather than in the database, so a restore never rolls them back.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
  backupConfigPatchSchema,
  backupConfigSchema,
  backupPassphraseSchema,
  backupTestSchema,
  type BackupConfigPatch,
} from '@jobtrack/shared';
import {
  backupStatus,
  buildBackupFile,
  listBackups,
  runAutoBackup,
  testBackupSetup,
  type AutoBackupContext,
} from '../backup/auto-backup.js';
import { decodeBackup } from '../backup/codec.js';
import { BackupConfigStore } from '../backup/config-store.js';
import { checkRecipient, generateKey } from '../backup/crypto.js';
import { pluginNameOf } from '../backup/plugin-recipient.js';
import {
  clearDatabase,
  countRows,
  currentCounts,
  isEmpty,
  restoreSnapshot,
  validateSnapshot,
} from '../backup/snapshot.js';
import { seedDemoData } from '../backup/seed.js';
import type { Deps } from '../deps.js';
import { HttpError, badRequest, conflict } from '../lib/errors.js';

/**
 * Not `.json.gz` — the payload is XOR-obfuscated on top of gzip, so a plain `gunzip` on it
 * won't work. `.age` on top when it is encrypted, so the age tools recognize it.
 */
function backupFilename(encrypted: boolean): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `jobtrack-backup-${stamp}.jtbak${encrypted ? '.age' : ''}`;
}

/**
 * Secrets for opening an encrypted backup come in headers, never the URL, so they stay out of
 * logs. URI-encoded by the client, since an identity file spans several lines.
 */
function secretHeader(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers[name];
  if (typeof raw !== 'string' || raw === '') return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    throw badRequest(`The ${name} header is not valid`);
  }
}

/** The first thing wrong with a settings change, in words, rather than a generic validation error. */
function readableValidation<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      throw badRequest(first?.message ?? 'These backup settings are not valid', error.issues);
    }
    throw error;
  }
}

export async function backupRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;
  const store = new BackupConfigStore(deps.config.dataDir);
  const context: AutoBackupContext = { repos, store, target: deps.config.activeDbTarget };

  /** Encrypted with the automatic backup's keys when encryption is set up, so both kinds of backup match. */
  app.get('/api/backup/export', async (_request, reply) => {
    let file;
    try {
      file = await buildBackupFile(repos, store.getConfig(), store);
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'Could not create the backup');
    }
    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${backupFilename(file.encrypted)}"`);
    return reply.send(file.data);
  });

  app.post('/api/backup/import', async (request) => {
    const query = request.query as { mode?: string };
    const mode = query.mode === 'commit' ? 'commit' : 'preview';

    const buffer = request.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw badRequest('No file was uploaded');

    const snapshot = validateSnapshot(
      await decodeBackup(buffer, {
        passphrase: secretHeader(request, 'x-backup-passphrase'),
        identity: secretHeader(request, 'x-backup-identity'),
      }),
    );
    const counts = countRows(snapshot);

    if (mode === 'preview') {
      return { mode: 'preview' as const, exportedAt: snapshot.exportedAt, counts };
    }

    const result = await restoreSnapshot(repos, search, snapshot);
    return { mode: 'commit' as const, exportedAt: snapshot.exportedAt, counts: result.counts };
  });

  app.get('/api/backup/status', async () => {
    const counts = await currentCounts(repos);
    return { counts, empty: isEmpty(counts) };
  });

  app.post('/api/backup/clear', async () => {
    const result = await clearDatabase(repos, search);
    return { counts: result.counts };
  });

  app.post('/api/backup/seed', async () => {
    const counts = await currentCounts(repos);
    if (!isEmpty(counts)) throw conflict('The active database is not empty. Clear it first.');

    const result = await seedDemoData(repos);
    search.markStale();
    return result;
  });

  app.get('/api/backup/auto', async () => backupStatus(store));

  /** Sections sent replace the stored ones; the merged result is checked as a whole. */
  app.put('/api/backup/auto', async (request) => {
    const patch = readableValidation(() => backupConfigPatchSchema.parse(request.body)) as Partial<BackupConfigPatch>;

    // Native keys are parsed now, so a typo is caught on save. A plugin key is only checked
    // by the Test button, since its plugin may be installed after the key is added.
    for (const entry of patch.encryption?.recipients ?? []) {
      if (pluginNameOf(entry.recipient)) continue;
      const problem = await checkRecipient(entry.recipient);
      if (problem) throw badRequest(`${entry.recipient.slice(0, 24)}…: ${problem}`);
    }

    const next = readableValidation(() => backupConfigSchema.parse({ ...store.getConfig(), ...patch }));
    if (next.enabled && next.encryption.mode === 'passphrase' && store.getPassphrase() === null) {
      throw badRequest('Save a passphrase before turning on passphrase encryption');
    }
    readableValidation(() => store.updateConfig(patch));
    return backupStatus(store);
  });

  /** Set, or clear with null. Never read back; the status only says whether one is saved. */
  app.put('/api/backup/auto/passphrase', async (request) => {
    const { passphrase } = readableValidation(() => backupPassphraseSchema.parse(request.body));
    store.setPassphrase(passphrase);
    return backupStatus(store);
  });

  /** A new key pair. The secret half is returned this once and not kept anywhere. */
  app.post('/api/backup/auto/keypair', async () => generateKey());

  /** Checks the saved settings, or unsaved ones sent in the body, without writing a backup. */
  app.post('/api/backup/auto/test', async (request) => {
    const override = readableValidation(() => backupTestSchema.parse(request.body ?? {}));
    const current = store.getConfig();
    return testBackupSetup({ ...current, ...override }, store);
  });

  /** "Back up now": always writes a backup, even when nothing has changed. */
  app.post('/api/backup/auto/run', async () => {
    try {
      return await runAutoBackup(context, { force: true });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, error instanceof Error ? error.message : 'The backup failed', undefined, 'backup_failed');
    }
  });

  /** The backups in the destination folder, newest first. Only files JobTrack wrote. */
  app.get('/api/backup/auto/files', async () => {
    try {
      return await listBackups(store.getConfig());
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : 'Could not read the backup folder');
    }
  });
}
