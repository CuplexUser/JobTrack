/**
 * Import.
 *
 * `POST /api/import?format=csv|xlsx&mode=preview|commit`. Both modes re-parse the posted
 * bytes and re-run classification — no server-side upload state — so the frontend just posts
 * the same `File` twice: once for the preview, once (if the user confirms) to commit it. The
 * body is the raw file, matching how `export.routes.ts` sends raw bytes back; see the
 * `addContentTypeParser` registration in `app.ts` for why that does not need a multipart
 * dependency.
 */

import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { badRequest } from '../lib/errors.js';
import { commitImport, parseImportFile, previewImport, type ImportFormat } from '../services/import.service.js';

function parseFormat(value: unknown): ImportFormat {
  if (value === 'csv' || value === 'xlsx') return value;
  throw badRequest('format must be "csv" or "xlsx"');
}

export async function importRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.post('/api/import', async (request) => {
    const query = request.query as { format?: string; mode?: string };
    const format = parseFormat(query.format);
    const mode = query.mode === 'commit' ? 'commit' : 'preview';

    const buffer = request.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw badRequest('No file was uploaded');

    const parsed = await parseImportFile(buffer, format);

    if (mode === 'preview') {
      const rows = await previewImport(repos, search, parsed.rows);
      const totals = {
        new: rows.filter((r) => r.verdict === 'new').length,
        duplicate: rows.filter((r) => r.verdict === 'duplicate').length,
        error: rows.filter((r) => r.verdict === 'error').length,
      };
      return { mode: 'preview' as const, fileErrors: parsed.errors, totals, rows };
    }

    const result = await commitImport(repos, search, parsed.rows);
    return { mode: 'commit' as const, fileErrors: parsed.errors, ...result };
  });
}
