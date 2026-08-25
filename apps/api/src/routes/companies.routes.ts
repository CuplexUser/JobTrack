import type { FastifyInstance } from 'fastify';
import { createCompanySchema, patchCompanySchema } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { notFound } from '../lib/errors.js';
import {
  createCompany,
  getCompanyWithTags,
  listCompanies,
  suggestCompanies,
  updateCompany,
} from '../services/companies.service.js';
import { listApplications } from '../services/applications.service.js';
import { applicationFilterSchema } from '@jobtrack/shared';

export async function companyRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/companies', async (request) => {
    const query = request.query as { archived?: string; q?: string };
    return {
      companies: await listCompanies(repos, {
        includeArchived: query.archived === 'true' || query.archived === 'all',
        ...(query.q ? { search: query.q } : {}),
      }),
    };
  });

  /**
   * Autocomplete for the company field. The first line of duplicate defense: offering
   * "Spotify" while someone types "spot" is what stops a second spelling being created.
   */
  app.get('/api/companies/suggest', async (request) => {
    const query = request.query as { q?: string; limit?: string };
    const limit = Math.min(Number(query.limit ?? 8) || 8, 25);
    return { companies: await suggestCompanies(repos, query.q ?? '', limit) };
  });

  app.get('/api/companies/:id', async (request) => {
    const { id } = request.params as { id: string };
    const company = await getCompanyWithTags(repos, id);
    if (!company) throw notFound('No such company');

    // The company page shows its full application history.
    const filter = applicationFilterSchema.parse({ companyId: id, limit: '200', archived: 'all' });
    const applications = await listApplications(repos, filter);
    return { company, applications: applications.items };
  });

  app.post('/api/companies', async (request, reply) => {
    const input = createCompanySchema.parse(request.body);
    const company = await createCompany(repos, input);
    search.markStale();
    return reply.status(201).send(company);
  });

  app.patch('/api/companies/:id', async (request) => {
    const { id } = request.params as { id: string };
    const patch = patchCompanySchema.parse(request.body);
    const company = await updateCompany(repos, id, patch);
    search.markStale();
    return company;
  });
}
