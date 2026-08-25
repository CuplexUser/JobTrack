/** Note tools — mirrors `notes.routes.ts` minus delete. */

import { z } from 'zod';
import { createNoteSchema, noteTargetSchema, patchNoteSchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { createNote, listNotes, updateNote } from '@jobtrack/api/services/notes';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult, jsonResult } from '../helpers.js';

export function registerNoteTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'list_notes',
    {
      description: 'List notes, optionally scoped to one target (a company, an application, or standalone notes).',
      inputSchema: z.object({
        targetType: noteTargetSchema.optional(),
        targetId: z.string().optional(),
      }),
    },
    async ({ targetType, targetId }) =>
      jsonResult(await listNotes(repos, { ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) })),
  );

  server.registerTool(
    'create_note',
    {
      description: 'Create a note, optionally linked to a company or application by id (or standalone).',
      inputSchema: createNoteSchema,
    },
    async (input) => {
      const note = await createNote(repos, input);
      search.markStale();
      return jsonResult(note);
    },
  );

  server.registerTool(
    'update_note',
    {
      description: 'Update fields on an existing note. Only the fields set in `patch` are changed.',
      inputSchema: z.object({ id: z.string().min(1), patch: patchNoteSchema }),
    },
    async ({ id, patch }) => {
      const note = await updateNote(repos, id, patch);
      if (!note) return errorResult(`No note with id ${id}`);
      search.markStale();
      return jsonResult(note);
    },
  );
}
