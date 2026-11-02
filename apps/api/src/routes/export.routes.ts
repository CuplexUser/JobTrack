/**
 * Exports.
 *
 * Both formats take the same filter object as the list view, so what you export is exactly
 * what the table was showing — including an active search query, which is resolved to
 * ranked ids first.
 *
 * Which columns, in which order and under which headers is the caller's to say (`columns` and
 * `headers`); the web app sends the saved export profile, with headers already in the active
 * language. Left out, an export is the classic six columns under English headers.
 */

import type { FastifyInstance } from 'fastify';
import { PassThrough } from 'node:stream';
import { exportQuerySchema, monthName } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { findAllMatching, listApplications } from '../services/applications.service.js';
import { exportColumns, exportFilename } from '../export/columns.js';
import { buildWorkbook, csvLines } from '../export/workbook.js';
import { withNotes } from '../export/rows.js';

export async function exportRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/export', async (request, reply) => {
    const query = exportQuerySchema.parse(request.query);

    // A search query restricts the export the same way it restricts the table.
    let matched;
    if (query.q) {
      const outcome = await search.search(query.q, { limit: 500, types: ['application'] });
      const result = await listApplications(
        repos,
        { ...query, limit: 200 },
        { orderedIds: outcome.hits.map((hit) => hit.entityId) },
      );
      matched = result.items;
    } else {
      matched = await findAllMatching(repos, query);
    }

    // The list view carries only a note count; an export carries the note text.
    const rows = await withNotes(repos, matched);

    const scope = describeScope(query);
    const columns = exportColumns(query.columns, query.headers);

    if (query.format === 'csv') {
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${exportFilename('csv', scope)}"`);

      // Generators are not streams; PassThrough bridges the two so the response starts
      // flowing before the whole document exists.
      const stream = new PassThrough();
      queueMicrotask(() => {
        for (const line of csvLines(rows, columns)) stream.write(line);
        stream.end();
      });
      return reply.send(stream);
    }

    reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header('Content-Disposition', `attachment; filename="${exportFilename('xlsx', scope)}"`);

    // Sent as a buffer rather than piped: the workbook is small enough that holding it in
    // memory costs nothing, and Content-Length lets the browser show real download
    // progress instead of an open-ended spinner.
    return reply.send(await buildWorkbook(rows, columns));
  });
}

/** A short filename hint describing what was exported. */
function describeScope(query: { year?: number; month?: number; q?: string }): string {
  if (query.q) return 'search';
  if (query.year && query.month) return `${query.year}-${monthName(query.month).toLowerCase()}`;
  if (query.year) return String(query.year);
  return '';
}
