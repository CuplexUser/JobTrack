/** Cross-entity search — mirrors `search.routes.ts`. */

import { searchQuerySchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { resolveHits } from '@jobtrack/api/search/results';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonResult } from '../helpers.js';
import { applicationSummary, contactSummary } from '../views.js';

export function registerSearchTool(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'search_jobtrack',
    {
      description:
        'Search across applications, companies, notes and people at once, fused from lexical (typo-tolerant keyword) and semantic (meaning-based) retrieval. People are found by name, employer, job title and what was said in conversations with them. Use this for "find X" style questions rather than list_applications with a guessed filter.',
      inputSchema: searchQuerySchema,
    },
    async (query) => {
      const outcome = await search.search(query.q, {
        limit: query.limit,
        ...(query.types ? { types: query.types } : {}),
      });

      // Applications and people carry more than a result row needs, so they come back summarized.
      const results = (await resolveHits(repos, outcome.hits)).map((hit) => {
        if (hit.type === 'application') return { ...hit, record: applicationSummary(hit.record) };
        if (hit.type === 'contact') return { ...hit, record: contactSummary(hit.record) };
        return hit;
      });

      return jsonResult({ results, semanticReady: outcome.semanticReady, query: query.q });
    },
  );
}
