/** Cross-entity search — mirrors `search.routes.ts`. */

import { searchQuerySchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { hydrateApplications } from '@jobtrack/api/db/hydrate';
import { toCompany, toNote } from '@jobtrack/api/db/mappers';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonResult } from '../helpers.js';
import { applicationSummary } from '../views.js';

export function registerSearchTool(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'search_jobtrack',
    {
      description:
        'Search across applications, companies and notes at once, fused from lexical (typo-tolerant keyword) and semantic (meaning-based) retrieval. Use this for "find X" style questions rather than list_applications with a guessed filter.',
      inputSchema: searchQuerySchema,
    },
    async (query) => {
      const outcome = await search.search(query.q, {
        limit: query.limit,
        ...(query.types ? { types: query.types } : {}),
      });

      const idsOf = (type: string) => outcome.hits.filter((hit) => hit.type === type).map((hit) => hit.entityId);
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
        (await hydrateApplications(repos, applicationRows)).map((a) => [a.id, applicationSummary(a)]),
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

      return jsonResult({ results, semanticReady: outcome.semanticReady, query: query.q });
    },
  );
}
