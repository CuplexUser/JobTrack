import type { FastifyInstance } from 'fastify';
import { createNoteSchema, patchNoteSchema, noteTargetSchema } from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { notFound } from '../lib/errors.js';
import { createNote, deleteNote, listNotes, updateNote } from '../services/notes.service.js';

export async function noteRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/notes', async (request) => {
    const query = request.query as { targetType?: string; targetId?: string };
    const targetType = query.targetType
      ? noteTargetSchema.parse(query.targetType)
      : undefined;
    return {
      notes: await listNotes(repos, {
        ...(targetType ? { targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
      }),
    };
  });

  app.post('/api/notes', async (request, reply) => {
    const input = createNoteSchema.parse(request.body);
    const note = await createNote(repos, input);
    search.markStale();
    return reply.status(201).send(note);
  });

  app.patch('/api/notes/:id', async (request) => {
    const { id } = request.params as { id: string };
    const patch = patchNoteSchema.parse(request.body);
    const note = await updateNote(repos, id, patch);
    if (!note) throw notFound('No such note');
    search.markStale();
    return note;
  });

  app.delete('/api/notes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteNote(repos, id))) throw notFound('No such note');
    search.markStale();
    return reply.status(204).send();
  });
}
