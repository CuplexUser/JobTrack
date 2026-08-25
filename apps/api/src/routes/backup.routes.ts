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
 */

import type { FastifyInstance } from 'fastify';
import { decodeSnapshot, encodeSnapshot } from '../backup/codec.js';
import {
  clearDatabase,
  countRows,
  createSnapshot,
  currentCounts,
  isEmpty,
  restoreSnapshot,
  validateSnapshot,
} from '../backup/snapshot.js';
import { seedDemoData } from '../backup/seed.js';
import type { Deps } from '../deps.js';
import { badRequest, conflict } from '../lib/errors.js';

/** Not `.json.gz` — the payload is XOR-obfuscated on top of gzip, so a plain `gunzip` on it won't work. */
function backupFilename(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `jobtrack-backup-${stamp}.jtbak`;
}

export async function backupRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/backup/export', async (_request, reply) => {
    const snapshot = await createSnapshot(repos);
    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${backupFilename()}"`);
    return reply.send(encodeSnapshot(snapshot));
  });

  app.post('/api/backup/import', async (request) => {
    const query = request.query as { mode?: string };
    const mode = query.mode === 'commit' ? 'commit' : 'preview';

    const buffer = request.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw badRequest('No file was uploaded');

    const snapshot = validateSnapshot(decodeSnapshot(buffer));
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
    if (!isEmpty(counts)) throw conflict('The active database is not empty — clear it first');

    const result = await seedDemoData(repos);
    search.markStale();
    return result;
  });
}
