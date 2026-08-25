import type { FastifyInstance } from 'fastify';
import { convertJobOpeningSchema, createJobOpeningSchema, patchJobOpeningSchema } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { notFound } from '../lib/errors.js';
import {
  convertOpening,
  createOpening,
  deleteOpening,
  getOpening,
  listOpenings,
  updateOpening,
} from '../services/openings.service.js';

export async function openingRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos } = deps;

  app.get('/api/openings', async (request) => {
    const query = request.query as { archived?: string };
    return { openings: await listOpenings(repos, { includeArchived: query.archived === 'true' }) };
  });

  app.get('/api/openings/:id', async (request) => {
    const { id } = request.params as { id: string };
    const opening = await getOpening(repos, id);
    if (!opening) throw notFound('No such opening');
    return opening;
  });

  app.post('/api/openings', async (request, reply) => {
    const input = createJobOpeningSchema.parse(request.body);
    const opening = await createOpening(repos, input);
    return reply.status(201).send(opening);
  });

  app.patch('/api/openings/:id', async (request) => {
    const { id } = request.params as { id: string };
    const patch = patchJobOpeningSchema.parse(request.body);
    const opening = await updateOpening(repos, id, patch);
    if (!opening) throw notFound('No such opening');
    return opening;
  });

  app.delete('/api/openings/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteOpening(repos, id))) throw notFound('No such opening');
    return reply.status(204).send();
  });

  /** The whole point: turn a saved opening into a real, tracked application. */
  app.post('/api/openings/:id/convert', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = convertJobOpeningSchema.parse(request.body);
    const application = await convertOpening(repos, id, input);
    if (!application) throw notFound('No such opening');
    deps.search.markStale();
    return reply.status(201).send(application);
  });
}
