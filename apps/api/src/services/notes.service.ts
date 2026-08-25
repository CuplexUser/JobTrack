/**
 * Notes.
 *
 * A note either hangs off a company, hangs off an application, or floats free. The target
 * is polymorphic (`targetType` + `targetId`), so listing notes with a readable label for
 * what they are attached to means resolving two different tables — done in two batched
 * reads rather than one per note.
 */

import type { Note, NoteTarget, NoteWithTarget } from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { toNote } from '../db/mappers.js';
import { uniqueIds } from '../db/hydrate.js';

export interface ListNotesOptions {
  targetType?: NoteTarget;
  targetId?: string;
  search?: string;
}

export async function listNotes(
  repos: Repos,
  options: ListNotesOptions = {},
): Promise<NoteWithTarget[]> {
  const where: Record<string, unknown> = {};
  if (options.targetType) where.targetType = options.targetType;
  if (options.targetId) where.targetId = options.targetId;

  const rows = await repos.notes.findMany({
    ...(Object.keys(where).length > 0 ? { where: where as never } : {}),
    orderBy: [
      { field: 'pinned', direction: 'desc' },
      { field: 'updatedAt', direction: 'desc' },
    ],
  });

  return attachLabels(repos, rows.map(toNote));
}

/**
 * Resolve each note's target to a human-readable label.
 *
 * Two queries total — one for the companies, one for the applications — regardless of how
 * many notes there are.
 */
async function attachLabels(repos: Repos, notes: Note[]): Promise<NoteWithTarget[]> {
  const companyIds = uniqueIds(
    notes.filter((n) => n.targetType === 'company' && n.targetId).map((n) => n.targetId!),
  );
  const applicationIds = uniqueIds(
    notes.filter((n) => n.targetType === 'application' && n.targetId).map((n) => n.targetId!),
  );

  const [companies, applications] = await Promise.all([
    companyIds.length > 0
      ? repos.companies.findMany({ where: [{ field: 'id', op: 'in', value: companyIds }] })
      : Promise.resolve([]),
    applicationIds.length > 0
      ? repos.applications.findMany({ where: [{ field: 'id', op: 'in', value: applicationIds }] })
      : Promise.resolve([]),
  ]);

  const companyNames = new Map(companies.map((c) => [c.id, c.name]));
  const applicationTitles = new Map(applications.map((a) => [a.id, a.jobTitle]));

  return notes.map((note) => ({
    ...note,
    targetLabel:
      note.targetType === 'company'
        ? (companyNames.get(note.targetId ?? '') ?? null)
        : note.targetType === 'application'
          ? (applicationTitles.get(note.targetId ?? '') ?? null)
          : null,
  }));
}

export async function createNote(
  repos: Repos,
  input: { title: string; body: string; targetType: NoteTarget; targetId: string | null; pinned: boolean },
): Promise<Note> {
  // A standalone note must not carry a dangling target id.
  const targetId = input.targetType === 'standalone' ? null : input.targetId;
  const row = await repos.notes.create({ ...input, targetId });
  return toNote(row);
}

export async function updateNote(
  repos: Repos,
  id: string,
  patch: {
    title?: string;
    body?: string;
    targetType?: NoteTarget;
    targetId?: string | null;
    pinned?: boolean;
  },
): Promise<Note | null> {
  const existing = await repos.notes.findById(id);
  if (!existing) return null;

  const changes: Record<string, unknown> = {};
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.body !== undefined) changes.body = patch.body;
  if (patch.pinned !== undefined) changes.pinned = patch.pinned;
  if (patch.targetType !== undefined) {
    changes.targetType = patch.targetType;
    // Re-targeting to standalone clears the id, even if the caller did not say so.
    if (patch.targetType === 'standalone') changes.targetId = null;
  }
  if (patch.targetId !== undefined && changes.targetId === undefined) {
    changes.targetId = patch.targetId;
  }

  if (Object.keys(changes).length === 0) return toNote(existing);
  return toNote(await repos.notes.update(id, changes as never));
}

export async function deleteNote(repos: Repos, id: string): Promise<boolean> {
  const existing = await repos.notes.findById(id);
  if (!existing) return false;
  await repos.notes.delete(id);
  return true;
}
