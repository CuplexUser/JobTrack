/** Note tools — mirrors `notes.routes.ts` minus delete. */

import { z } from 'zod';
import { createNoteSchema, noteTargetSchema, patchNoteSchema } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { createNote, listNotes, updateNote } from '@jobtrack/api/services/notes';
import { toNote } from '@jobtrack/api/db/mappers';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { errorResult, jsonResult } from '../helpers.js';
import { noteSummary } from '../views.js';

export function registerNoteTools(server: McpServer, deps: Deps): void {
  const { repos, search } = deps;

  server.registerTool(
    'list_notes',
    {
      description:
        'List notes, optionally scoped to one target (a company, an application, or standalone notes). Pinned first, then most recently updated. Long bodies come back cut to a preview — get_note has any one of them in full.',
      inputSchema: z.object({
        targetType: noteTargetSchema.optional(),
        targetId: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(25),
      }),
    },
    async ({ targetType, targetId, limit }) => {
      const notes = await listNotes(repos, {
        ...(targetType ? { targetType } : {}),
        ...(targetId ? { targetId } : {}),
      });
      return jsonResult({
        notes: notes.slice(0, limit).map(noteSummary),
        total: notes.length,
        hasMore: notes.length > limit,
      });
    },
  );

  server.registerTool(
    'get_note',
    {
      description: 'Get one note by id, with its body in full.',
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async ({ id }) => {
      const row = await repos.notes.findById(id);
      return row ? jsonResult(toNote(row)) : errorResult(`No note with id ${id}`);
    },
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
