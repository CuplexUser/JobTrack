/**
 * The network: people, conversations with them, links to applications and openings, and the
 * LinkedIn connections import. Every write marks the search index stale, since a person and
 * what was said to them are both searchable.
 */

import type { FastifyInstance } from 'fastify';
import {
  contactFilterSchema,
  contactLinkTargetSchema,
  createContactSchema,
  createInteractionSchema,
  linkContactSchema,
  linkedInImportSchema,
  patchContactSchema,
} from '@jobtrack/shared';
import type { Deps } from '../deps.js';
import { notFound } from '../lib/errors.js';
import {
  commitLinkedInImport,
  contactsForTarget,
  createContact,
  deleteContact,
  deleteInteraction,
  getContact,
  linkContact,
  listContacts,
  logInteraction,
  previewLinkedInImport,
  unlinkContact,
  updateContact,
} from '../services/contacts.service.js';

/** A LinkedIn export of a large network is a few megabytes of CSV, well past Fastify's 1 MB default. */
const IMPORT_BODY_LIMIT = 25 * 1024 * 1024;

export async function contactRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { repos, search } = deps;

  app.get('/api/contacts', async (request) => {
    const filter = contactFilterSchema.parse(request.query);
    return { contacts: await listContacts(repos, filter) };
  });

  /** Preview with `mode=preview` (the default) and write nothing; `mode=commit` creates the new rows. */
  app.post('/api/contacts/import/linkedin', { bodyLimit: IMPORT_BODY_LIMIT }, async (request) => {
    const { csv } = linkedInImportSchema.parse(request.body);
    const mode = (request.query as { mode?: string }).mode === 'commit' ? 'commit' : 'preview';
    if (mode === 'preview') return { mode, ...(await previewLinkedInImport(repos, csv)) };

    const result = await commitLinkedInImport(repos, csv);
    if (result.created > 0) search.markStale();
    return { mode, ...result };
  });

  /** The people linked to one application or opening, with the part each played. */
  app.get('/api/contacts/linked/:targetType/:targetId', async (request) => {
    const params = request.params as { targetType: string; targetId: string };
    const targetType = contactLinkTargetSchema.parse(params.targetType);
    return { contacts: await contactsForTarget(repos, targetType, params.targetId) };
  });

  app.get('/api/contacts/:id', async (request) => {
    const { id } = request.params as { id: string };
    const contact = await getContact(repos, id);
    if (!contact) throw notFound('No such person');
    return contact;
  });

  app.post('/api/contacts', async (request, reply) => {
    const input = createContactSchema.parse(request.body);
    const created = await createContact(repos, input);
    search.markStale();
    return reply.status(201).send(created);
  });

  app.patch('/api/contacts/:id', async (request) => {
    const { id } = request.params as { id: string };
    const patch = patchContactSchema.parse(request.body);
    const updated = await updateContact(repos, id, patch);
    if (!updated) throw notFound('No such person');
    search.markStale();
    return updated;
  });

  app.delete('/api/contacts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteContact(repos, id))) throw notFound('No such person');
    search.markStale();
    return reply.status(204).send();
  });

  app.post('/api/contacts/:id/interactions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = createInteractionSchema.parse(request.body);
    const interaction = await logInteraction(repos, id, input);
    if (!interaction) throw notFound('No such person');
    search.markStale();
    return reply.status(201).send(interaction);
  });

  app.delete('/api/interactions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteInteraction(repos, id))) throw notFound('No such interaction');
    search.markStale();
    return reply.status(204).send();
  });

  app.post('/api/contacts/:id/links', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = linkContactSchema.parse(request.body);
    const link = await linkContact(repos, id, input);
    if (!link) throw notFound('No such person');
    return reply.status(201).send(link);
  });

  app.delete('/api/contact-links/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await unlinkContact(repos, id))) throw notFound('No such link');
    return reply.status(204).send();
  });
}
