/**
 * The user's profile and automation rules, stored as whole documents in `app_settings`.
 *
 * Every read goes through the document's zod schema, so a document written by an older
 * version, or edited by hand, comes back with defaults filled in rather than as a shape the
 * rest of the app has to second-guess. A document that no longer parses at all is treated as
 * unset: losing a stale preference is better than taking down the openings page over it.
 */

import { profileSchema, rulesSchema, type Profile, type Rules } from '@jobtrack/shared';
import type { z } from 'zod';
import type { Repos } from '../db/repos.js';

const PROFILE_KEY = 'profile';
const RULES_KEY = 'rules';

async function readSetting<S extends z.ZodType>(repos: Repos, key: string, schema: S): Promise<z.output<S>> {
  const row = await repos.appSettings.findOne({ where: { settingKey: key } });
  const parsed = schema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

/** A partial update without its unsent fields, so a field left out never resets to its default. */
function sentFields<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

async function writeSetting(repos: Repos, key: string, value: unknown): Promise<void> {
  const existing = await repos.appSettings.findOne({ where: { settingKey: key } });
  if (existing) await repos.appSettings.update(existing.id, { value } as never);
  else await repos.appSettings.create({ settingKey: key, value });
}

export async function getProfile(repos: Repos): Promise<Profile> {
  return readSetting(repos, PROFILE_KEY, profileSchema);
}

/**
 * Merge `patch` into the stored profile. A merge rather than a replacement, so a caller that
 * only knows one field (an MCP client adding a target title) cannot wipe the others.
 */
export async function updateProfile(repos: Repos, patch: Partial<Profile>): Promise<Profile> {
  const next = profileSchema.parse({ ...(await getProfile(repos)), ...sentFields(patch) });
  await writeSetting(repos, PROFILE_KEY, next);
  return next;
}

export async function getRules(repos: Repos): Promise<Rules> {
  return readSetting(repos, RULES_KEY, rulesSchema);
}

export async function updateRules(repos: Repos, patch: Partial<Rules>): Promise<Rules> {
  const next = rulesSchema.parse({ ...(await getRules(repos)), ...sentFields(patch) });
  await writeSetting(repos, RULES_KEY, next);
  return next;
}
