/**
 * Tags, and the polymorphic links that attach them to companies and applications.
 *
 * Tags are addressed by *name* everywhere in the API, because that is how they are typed
 * into an AntD tags-input. Resolving a name to a row — creating it the first time it is
 * used — happens here, keyed on the normalized `nameKey` so "Remote OK", "remote-ok" and
 * "remote ok" converge on one tag instead of three.
 */

import { UniqueConstraintError } from 'repolayer';
import { tagKey, type LinkTarget, type Tag, type TagScope } from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { toTag } from '../db/mappers.js';
import type { TagRow } from '../db/schema.js';
import { uniqueIds } from '../db/hydrate.js';

/**
 * Find or create a tag for each name, in one batched read plus one insert per genuinely
 * new tag. Order and duplicates in `names` are ignored; the result is deduplicated.
 */
export async function resolveTags(
  repos: Repos,
  names: readonly string[],
  scope: TagScope = 'both',
): Promise<TagRow[]> {
  const wanted = new Map<string, string>(); // nameKey -> display name
  for (const raw of names) {
    const display = raw.trim();
    const key = tagKey(display);
    if (key && !wanted.has(key)) wanted.set(key, display);
  }
  if (wanted.size === 0) return [];

  const existing = await repos.tags.findMany({
    where: [{ field: 'nameKey', op: 'in', value: [...wanted.keys()] }],
  });
  const byKey = new Map(existing.map((row) => [row.nameKey, row]));

  for (const [key, display] of wanted) {
    if (byKey.has(key)) continue;
    byKey.set(key, await createTag(repos, display, key, scope));
  }

  return [...wanted.keys()].map((key) => byKey.get(key)!).filter(Boolean);
}

/**
 * Insert a tag, tolerating the race where something else created the same one first.
 *
 * `nameKey` is unique, so a concurrent insert surfaces as UniqueConstraintError rather
 * than a duplicate row — re-reading is the correct response, not failing the request.
 */
async function createTag(
  repos: Repos,
  name: string,
  key: string,
  scope: TagScope,
): Promise<TagRow> {
  try {
    return await repos.tags.create({ name, nameKey: key, color: null, scope });
  } catch (error) {
    if (!(error instanceof UniqueConstraintError)) throw error;
    const found = await repos.tags.findOne({ where: { nameKey: key } });
    if (!found) throw error;
    return found;
  }
}

/**
 * Make the links for one target match exactly `tagIds`.
 *
 * Diffed rather than delete-all-then-reinsert, so saving a form without touching the tags
 * leaves the rows — and their `createdAt` — alone.
 */
export async function setTagLinks(
  repos: Repos,
  targetType: LinkTarget,
  targetId: string,
  tagIds: readonly string[],
): Promise<void> {
  const desired = new Set(uniqueIds([...tagIds]));

  const current = await repos.tagLinks.findMany({
    where: { targetType, targetId },
  });
  const currentIds = new Set(current.map((l) => l.tagId));

  const toAdd = [...desired].filter((id) => !currentIds.has(id));
  const toRemove = current.filter((l) => !desired.has(l.tagId));

  for (const tagId of toAdd) {
    await repos.tagLinks.create({ tagId, targetType, targetId });
  }
  for (const link of toRemove) {
    await repos.tagLinks.delete(link.id);
  }
}

/** Resolve names and attach them in one step — what the create/update paths actually call. */
export async function applyTagNames(
  repos: Repos,
  targetType: LinkTarget,
  targetId: string,
  names: readonly string[],
): Promise<Tag[]> {
  const rows = await resolveTags(repos, names, targetType);
  await setTagLinks(
    repos,
    targetType,
    targetId,
    rows.map((r) => r.id),
  );
  return rows.map(toTag);
}

/** Every tag, for the filter dropdowns and the tag manager. */
export async function listTags(repos: Repos): Promise<Tag[]> {
  const rows = await repos.tags.findMany({ orderBy: [{ field: 'name', direction: 'asc' }] });
  return rows.map(toTag);
}

/**
 * Remove a tag and every link to it.
 *
 * The links have to go too — repolayer has no cascading deletes, and an orphaned link
 * would keep pointing at a tag that is no longer there.
 */
export async function deleteTag(repos: Repos, tagId: string): Promise<void> {
  await repos.tagLinks.deleteMany({ where: { tagId } });
  await repos.tags.delete(tagId);
}

/**
 * The application ids carrying *every* one of these tag names.
 *
 * Used by the list filter, where selecting two tags means "both", not "either". Returns
 * null when no tag filter was requested, which callers read as "do not restrict".
 */
export async function applicationIdsWithAllTags(
  repos: Repos,
  tagNames: readonly string[] | undefined,
): Promise<string[] | null> {
  if (!tagNames || tagNames.length === 0) return null;

  const keys = tagNames.map(tagKey).filter(Boolean);
  if (keys.length === 0) return null;

  const tagRows = await repos.tags.findMany({
    where: [{ field: 'nameKey', op: 'in', value: keys }],
  });
  // A name that matches no tag can never match an application, so the answer is "nothing".
  if (tagRows.length !== keys.length) return [];

  const links = await repos.tagLinks.findMany({
    where: [
      { field: 'targetType', op: 'eq', value: 'application' },
      { field: 'tagId', op: 'in', value: tagRows.map((t) => t.id) },
    ],
  });

  const hits = new Map<string, Set<string>>();
  for (const link of links) {
    const set = hits.get(link.targetId) ?? new Set<string>();
    set.add(link.tagId);
    hits.set(link.targetId, set);
  }

  return [...hits.entries()]
    .filter(([, set]) => set.size === tagRows.length)
    .map(([targetId]) => targetId);
}
