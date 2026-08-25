/**
 * Assembling the rows an export writes.
 *
 * The list view carries a note *count*, which is all a table cell needs. An export needs
 * the note text itself, so it is fetched here — in one batched query for the whole export
 * rather than one per application, the same rule the hydrate layer follows.
 */

import type { JobApplicationView } from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';

export interface ExportRow extends JobApplicationView {
  /** Every note attached to this application, or an empty string when there are none. */
  notesText: string;
}

export async function withNotes(
  repos: Repos,
  rows: readonly JobApplicationView[],
): Promise<ExportRow[]> {
  if (rows.length === 0) return [];

  const notes = await repos.notes.findMany({
    where: [
      { field: 'targetType', op: 'eq', value: 'application' },
      { field: 'targetId', op: 'in', value: rows.map((row) => row.id) },
    ],
    orderBy: [
      { field: 'pinned', direction: 'desc' },
      { field: 'createdAt', direction: 'asc' },
    ],
  });

  const byApplication = new Map<string, string[]>();
  for (const note of notes) {
    if (!note.targetId) continue;
    const bodies = byApplication.get(note.targetId) ?? [];
    // The body alone: notes created from the application form are titled "Notes — {role}",
    // which would just repeat the Position column in every cell.
    const text = note.body.trim();
    if (text) bodies.push(text);
    byApplication.set(note.targetId, bodies);
  }

  return rows.map((row) => ({
    ...row,
    // A blank line between notes so several remain readable in one cell.
    notesText: (byApplication.get(row.id) ?? []).join('\n\n'),
  }));
}
