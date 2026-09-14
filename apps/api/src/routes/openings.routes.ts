import type { FastifyInstance } from 'fastify';
import {
  convertJobOpeningSchema,
  createJobOpeningSchema,
  openingFilterSchema,
  patchJobOpeningSchema,
  scorePostingsSchema,
} from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { notFound } from '../lib/errors.js';
import { fitOpening, rankOpenings, rankPostings } from '../services/fit.service.js';
import {
  convertOpening,
  createOpening,
  deleteOpening,
  getOpening,
  updateOpening,
} from '../services/openings.service.js';

export async function openingRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos } = deps;

  app.get('/api/openings', async (request) => {
    // `archived=true` is the web app's name for `includeArchived`, kept so its links still work.
    const { archived, ...query } = request.query as Record<string, unknown>;
    const filter = openingFilterSchema.parse({ includeArchived: archived, ...query });
    return { openings: await rankOpenings(repos, deps.search, filter) };
  });

  /**
   * Score postings against the profile without saving them, best first. For deciding what is
   * worth adding before anything is added.
   */
  app.post('/api/openings/score', async (request) => {
    const { postings } = scorePostingsSchema.parse(request.body);
    return rankPostings(repos, deps.search, postings);
  });

  // The single-opening reads and writes carry `fit` too (null without a profile), so saving or
  // editing one says how well it matches.
  app.get('/api/openings/:id', async (request) => {
    const { id } = request.params as { id: string };
    const opening = await getOpening(repos, id);
    if (!opening) throw notFound('No such opening');
    return fitOpening(repos, deps.search, opening);
  });

  app.post('/api/openings', async (request, reply) => {
    const input = createJobOpeningSchema.parse(request.body);
    const opening = await createOpening(repos, input);
    return reply.status(201).send(await fitOpening(repos, deps.search, opening));
  });

  app.patch('/api/openings/:id', async (request) => {
    const { id } = request.params as { id: string };
    const patch = patchJobOpeningSchema.parse(request.body);
    const opening = await updateOpening(repos, id, patch);
    if (!opening) throw notFound('No such opening');
    return fitOpening(repos, deps.search, opening);
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
