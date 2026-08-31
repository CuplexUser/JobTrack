/**
 * Capture endpoints — the way a posting gets in from somewhere other than the keyboard.
 *
 * `url` and `text` only *parse*: they hand back a draft plus the duplicate verdict and
 * write nothing, so the user always sees what will be saved before it is. `clip` is the one
 * that writes, and it is what the browser extension calls.
 */

import type { FastifyInstance } from 'fastify';
import { ingestTextSchema, ingestUrlSchema, postingDraftSchema } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { clipPosting, ingestText, ingestUrl } from '../services/ingest.service.js';

export async function ingestRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.post('/api/ingest/url', async (request) => {
    const { url } = ingestUrlSchema.parse(request.body);
    return ingestUrl(repos, search, url);
  });

  app.post('/api/ingest/text', async (request) => {
    const { text, url } = ingestTextSchema.parse(request.body);
    return ingestText(repos, search, text, url ?? undefined);
  });

  app.post('/api/ingest/clip', async (request, reply) => {
    const draft = postingDraftSchema.parse(request.body);
    const result = await clipPosting(repos, search, draft);
    // A new opening is new searchable text, same as one created through the openings route.
    search.markStale();
    return reply.status(201).send(result);
  });
}
