import type { FastifyInstance } from 'fastify';
import { searchQuerySchema } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { resolveHits } from '../search/results.js';

/**
 * Cross-entity search: applications, companies, notes and people in one ranked list. The
 * hits come back as ids; `resolveHits` fetches the records and keeps the ranking order.
 */
export async function searchRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/search', async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const outcome = await search.search(query.q, {
      limit: query.limit,
      ...(query.types ? { types: query.types } : {}),
    });

    const results = await resolveHits(repos, outcome.hits);
    return { results, semanticReady: outcome.semanticReady, query: query.q };
  });
}
