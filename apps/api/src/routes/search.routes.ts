import type { FastifyInstance } from 'fastify';
import { searchQuerySchema } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { hydrateApplications } from '../db/hydrate.js';
import { toCompany, toNote } from '../db/mappers.js';

/**
 * Cross-entity search: applications, companies and notes in one ranked list.
 *
 * The hits come back as ids, so the rows are fetched in three batched `in` queries and
 * then re-ordered to match the ranking — the database has no idea what relevance is.
 */
export async function searchRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/search', async (request) => {
    const query = searchQuerySchema.parse(request.query);
    const outcome = await search.search(query.q, {
      limit: query.limit,
      ...(query.types ? { types: query.types } : {}),
    });

    const idsOf = (type: string) =>
      outcome.hits.filter((h) => h.type === type).map((h) => h.entityId);

    const applicationIds = idsOf('application');
    const companyIds = idsOf('company');
    const noteIds = idsOf('note');

    const [applicationRows, companyRows, noteRows] = await Promise.all([
      applicationIds.length
        ? repos.applications.findMany({ where: [{ field: 'id', op: 'in', value: applicationIds }] })
        : Promise.resolve([]),
      companyIds.length
        ? repos.companies.findMany({ where: [{ field: 'id', op: 'in', value: companyIds }] })
        : Promise.resolve([]),
      noteIds.length
        ? repos.notes.findMany({ where: [{ field: 'id', op: 'in', value: noteIds }] })
        : Promise.resolve([]),
    ]);

    const applications = new Map(
      (await hydrateApplications(repos, applicationRows)).map((a) => [a.id, a]),
    );
    const companies = new Map(companyRows.map((c) => [c.id, toCompany(c)]));
    const notes = new Map(noteRows.map((n) => [n.id, toNote(n)]));

    const results = outcome.hits
      .map((hit) => {
        const record =
          hit.type === 'application'
            ? applications.get(hit.entityId)
            : hit.type === 'company'
              ? companies.get(hit.entityId)
              : notes.get(hit.entityId);
        return record ? { ...hit, record } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return { results, semanticReady: outcome.semanticReady, query: query.q };
  });
}
