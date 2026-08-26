/**
 * MCP server bootstrap.
 *
 * Mirrors `apps/api/src/index.ts`'s startup sequence — config, repos, search — but serves
 * MCP tool calls over stdio instead of Fastify over HTTP, calling the exact same service
 * functions the REST routes call (via the `exports` map on `@jobtrack/api`). It talks to the
 * same SQLite file directly, so it works whether or not the API dev server is running; the
 * SQLite connection's `busyTimeoutMs` (see `apps/api/src/db/repos.ts`) is what makes that
 * safe when both happen to run at once.
 *
 * Known caveat: if the API dev server is also running, each process keeps its own in-memory
 * search index. A write here calls this process's own `search.markStale()`, which only
 * refreshes *this* process's index — the web app's search results only pick up a write made
 * here once its own index is separately invalidated (a later write there, or a restart).
 * Plain list/detail reads are unaffected, since those hit SQLite directly every time.
 *
 * All logging goes to stderr (`console.error`) — stdout is reserved for the MCP protocol
 * itself when using the stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '@jobtrack/api/config';
import { createRepos } from '@jobtrack/api/db/create-repos';
import { SearchIndex } from '@jobtrack/api/search';
import { DisabledEmbedder, type Embedder } from '@jobtrack/api/search/embedder';
import { TransformersEmbedder } from '@jobtrack/api/search/transformers-embedder';
import type { Deps } from '@jobtrack/api/deps';
import { registerApplicationTools } from './tools/applications.js';
import { registerCompanyTools } from './tools/companies.js';
import { registerNoteTools } from './tools/notes.js';
import { registerTagTools } from './tools/tags.js';
import { registerOpeningTools } from './tools/openings.js';
import { registerSearchTool } from './tools/search.js';
import { registerDashboardTool } from './tools/dashboard.js';

const config = loadConfig();
const repos = await createRepos(config);

const embedder: Embedder = config.semanticSearchEnabled
  ? new TransformersEmbedder({
      model: config.embeddingModel,
      cacheDir: config.modelCacheDir,
      onError: (error) => {
        console.error('[jobtrack-mcp] semantic model unavailable, staying lexical-only:', error);
      },
    })
  : new DisabledEmbedder();

const search = new SearchIndex({
  repos,
  embedder,
  log: (message, error) => console.error(`[jobtrack-mcp] ${message}`, error ?? ''),
});

const deps: Deps = { repos, search, config };

// Lexical is ready synchronously; the embedding model (if enabled) loads in the background,
// same as the API server — a tool call answers immediately rather than blocking on a 25 MB
// download the first time this runs on a machine.
await search.start();

const server = new McpServer({ name: 'jobtrack', version: '1.0.0' });

registerApplicationTools(server, deps);
registerCompanyTools(server, deps);
registerNoteTools(server, deps);
registerTagTools(server, deps);
registerOpeningTools(server, deps);
registerSearchTool(server, deps);
registerDashboardTool(server, deps);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[jobtrack-mcp] ready (driver: ${config.driver})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      search.stop();
      await repos.close();
      process.exit(0);
    })();
  });
}
