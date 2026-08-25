import type { FastifyInstance } from 'fastify';
import { createTagSchema } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { deleteTag, listTags, resolveTags } from '../services/tags.service.js';
import { toTag } from '../db/mappers.js';

export async function tagRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/tags', async () => ({ tags: await listTags(repos) }));

  app.post('/api/tags', async (request, reply) => {
    const input = createTagSchema.parse(request.body);
    const [row] = await resolveTags(repos, [input.name], input.scope);
    if (!row) throw new Error('Tag could not be created');
    search.markStale();
    return reply.status(201).send(toTag(row));
  });

  app.delete('/api/tags/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteTag(repos, id);
    search.markStale();
    return reply.status(204).send();
  });
}
