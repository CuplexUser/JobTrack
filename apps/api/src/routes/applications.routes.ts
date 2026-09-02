/**
 * Application endpoints, including the duplicate check that the New Application form calls
 * while you are still typing.
 */

import type { FastifyInstance } from 'fastify';
import {
  applicationFilterSchema,
  bulkDeleteSchema,
  changeStatusSchema,
  createApplicationSchema,
  duplicateCheckSchema,
  patchApplicationSchema,
} from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { notFound } from '../lib/errors.js';
import {
  changeStatus,
  computePeriods,
  createApplication,
  deleteApplication,
  deleteApplications,
  getApplication,
  listApplications,
  patchApplication,
} from '../services/applications.service.js';
import { checkDuplicates, findDuplicateGroups } from '../services/duplicates.service.js';

export async function applicationRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/applications', async (request) => {
    const filter = applicationFilterSchema.parse(request.query);

    // A free-text query turns the list into a ranked search: the ids come from the search
    // index, and every other filter is still applied on top of them.
    let orderedIds: string[] | null = null;
    let semanticReady = search.semanticReady;
    if (filter.q) {
      const outcome = await search.search(filter.q, { limit: 200, types: ['application'] });
      orderedIds = outcome.hits.map((hit) => hit.entityId);
      semanticReady = outcome.semanticReady;
    }

    const result = await listApplications(repos, filter, { orderedIds });
    return { ...result, searched: Boolean(filter.q), semanticReady };
  });

  /**
   * The year/month tree. Separate from the list so the sidebar keeps its counts while the
   * table is filtered down to a single month.
   */
  app.get('/api/applications/periods', async (request) => {
    const query = request.query as { archived?: string };
    const periods = await computePeriods(repos, {
      includeArchived: query.archived === 'all' || query.archived === 'true',
    });
    return { periods };
  });

  /**
   * The duplicate check.
   *
   * Registered before `/:id` — Fastify matches static segments first, but keeping the
   * order explicit means a future rename cannot silently turn "check" into an id lookup.
   */
  app.get('/api/applications/check', async (request) => {
    const input = duplicateCheckSchema.parse(request.query);
    return checkDuplicates(repos, search, input);
  });

  /** The whole-database sweep behind the duplicates page. Static segment, so before `/:id`. */
  app.get('/api/applications/duplicates', async () => findDuplicateGroups(repos));

  app.get('/api/applications/:id', async (request) => {
    const { id } = request.params as { id: string };
    const application = await getApplication(repos, id);
    if (!application) throw notFound('No such application');
    return application;
  });

  app.post('/api/applications', async (request, reply) => {
    const input = createApplicationSchema.parse(request.body);
    const created = await createApplication(repos, input);
    search.markStale();
    return reply.status(201).send(created);
  });

  app.patch('/api/applications/:id', async (request) => {
    const { id } = request.params as { id: string };
    const patch = patchApplicationSchema.parse(request.body);
    const updated = await patchApplication(repos, id, patch);
    if (!updated) throw notFound('No such application');
    search.markStale();
    return updated;
  });

  app.post('/api/applications/:id/status', async (request) => {
    const { id } = request.params as { id: string };
    const input = changeStatusSchema.parse(request.body);
    const updated = await changeStatus(repos, id, input);
    if (!updated) throw notFound('No such application');
    search.markStale();
    return updated;
  });

  /**
   * Remove several at once — what "delete the duplicates" does. A POST rather than a DELETE
   * with a body, since a body on DELETE is poorly supported and this needs a list.
   */
  app.post('/api/applications/bulk-delete', async (request) => {
    const { ids } = bulkDeleteSchema.parse(request.body);
    const result = await deleteApplications(repos, ids);
    if (result.deleted > 0) search.markStale();
    return result;
  });

  app.delete('/api/applications/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = await deleteApplication(repos, id);
    if (!removed) throw notFound('No such application');
    search.markStale();
    return reply.status(204).send();
  });
}
