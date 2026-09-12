/**
 * People tools — the network behind the applications. Mirrors `contacts.routes.ts` minus the
 * deletes and the LinkedIn import, which stay in the web app: an import is a file the user
 * chooses, and removing a person is theirs to decide.
 */

import { z } from 'zod';
import {
  contactFilterSchema,
  contactLinkTargetSchema,
  createContactSchema,
  createInteractionSchema,
  linkContactSchema,
  patchContactSchema,
} from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import {
  contactsForTarget,
  createContact,
  getContact,
  linkContact,
  listContacts,
  logInteraction,
  updateContact,
} from '@jobtrack/api/services/contacts';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult, jsonResult } from '../helpers.js';
import { contactSummary } from '../views.js';

export function registerContactTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'list_contacts',
    {
      description:
        "List people in the user's network, sorted by name. Filter with `company` (everyone at an employer, matched the way company names are, so \"Spotify AB\" finds Spotify), `q` (words that must all appear in the name, employer, job title, email or notes), `relationship`, and `reconnectDue` (people whose reconnect date has arrived). Rows are summarized; call get_contact for one person with their conversation history and links.",
      inputSchema: contactFilterSchema,
    },
    async (filter) => jsonResult((await listContacts(repos, filter)).map(contactSummary)),
  );

  server.registerTool(
    'get_contact',
    {
      description: 'Get one person by id, with every logged conversation (newest first) and the applications and openings they are linked to.',
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async ({ id }) => {
      const contact = await getContact(repos, id);
      return contact ? jsonResult(contact) : errorResult(`No person with id ${id}`);
    },
  );

  server.registerTool(
    'list_linked_contacts',
    {
      description: 'The people linked to one application or opening, with the part each played (referral, recruiter, interviewer, contact).',
      inputSchema: z.object({ targetType: contactLinkTargetSchema, targetId: z.string().min(1) }),
    },
    async ({ targetType, targetId }) =>
      jsonResult(
        (await contactsForTarget(repos, targetType, targetId)).map((contact) => ({
          ...contactSummary(contact),
          linkId: contact.linkId,
          role: contact.role,
        })),
      ),
  );

  server.registerTool(
    'create_contact',
    {
      description:
        "Add a person to the network. Only the name is required. Call list_contacts with their name or employer first, since the user may already have them (a LinkedIn import brings in whole networks). `companyName` is free text and does not create a company.",
      inputSchema: createContactSchema,
    },
    async (input) => {
      const created = await createContact(repos, input);
      search.markStale();
      return jsonResult(contactSummary(created));
    },
  );

  server.registerTool(
    'update_contact',
    {
      description: "Update fields on a person. Only the fields set in `patch` are changed. Set `reconnectOn` to remind the user to get back in touch on that date, or null to clear it.",
      inputSchema: z.object({ id: z.string().min(1), patch: patchContactSchema }),
    },
    async ({ id, patch }) => {
      const updated = await updateContact(repos, id, patch);
      if (!updated) return errorResult(`No person with id ${id}`);
      search.markStale();
      return jsonResult(contactSummary(updated));
    },
  );

  server.registerTool(
    'log_interaction',
    {
      description:
        "Record a conversation with a person: when (`occurredOn`, default today), how (`channel`), who reached out (`direction`: outbound means the user did), a short `summary`, and optionally the `applicationId` it was about. `reconnectOn` sets the person's next reminder in the same step. Only log something the user says actually happened.",
      inputSchema: z.object({ contactId: z.string().min(1), interaction: createInteractionSchema }),
    },
    async ({ contactId, interaction }) => {
      try {
        const logged = await logInteraction(repos, contactId, interaction);
        if (!logged) return errorResult(`No person with id ${contactId}`);
        search.markStale();
        return jsonResult(logged);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : 'Could not log that interaction');
      }
    },
  );

  server.registerTool(
    'link_contact',
    {
      description:
        "Link a person to an application or opening with the part they played: 'referral' (referred the user), 'recruiter', 'interviewer' or 'contact'. Linking the same pair again changes the role.",
      inputSchema: z.object({ contactId: z.string().min(1), link: linkContactSchema }),
    },
    async ({ contactId, link }) => {
      try {
        const created = await linkContact(repos, contactId, link);
        return created ? jsonResult(created) : errorResult(`No person with id ${contactId}`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : 'Could not link that person');
      }
    },
  );
}
