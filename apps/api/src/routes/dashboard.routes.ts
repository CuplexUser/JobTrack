import type { FastifyInstance } from 'fastify';
import type { Deps } from '../deps.js';
import { getDashboard } from '../services/dashboard.service.js';
import { getAgenda } from '../services/agenda.service.js';

export async function dashboardRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  app.get('/api/dashboard', async () => getDashboard(deps.repos));

  /** What is waiting on the user today: due follow-ups, quiet applications, idle openings. */
  app.get('/api/agenda', async () => getAgenda(deps.repos));

  /** Liveness plus whether semantic search has finished warming up. */
  app.get('/api/health', async () => ({
    ok: true,
    driver: deps.config.driver,
    semanticReady: deps.search.semanticReady,
  }));
}
