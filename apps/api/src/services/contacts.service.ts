/**
 * The user's network: people, the conversations had with them, and the applications and
 * openings they had a part in.
 *
 * A contact's employer is a name plus its `companyKey` rather than a company row (see
 * `contactSchema`), so "who do I know at Spotify" is an equality filter on the key and needs
 * no company to exist. Everything that asks that question goes through `contactsAtCompany`.
 */

import type { TxContext } from 'repolayer';
import {
  canonicalLinkedInUrl,
  companyKey,
  displayName,
  normalizeText,
  parseDateOnly,
  parseLinkedInConnections,
  titleKey,
  todayDateOnly,
  type ContactDetail,
  type ContactFilter,
  type ContactLink,
  type ContactLinkTarget,
  type ContactRole,
  type ContactView,
  type Interaction,
  type LinkedContact,
  type Relationship,
} from '@jobtrack/shared';
import { scopedRepos, type Repos } from '../db/repos.js';
import type { ContactRow } from '../db/schema.js';
import { toContact, toContactLinkTarget, toContactRole, toInteraction } from '../db/mappers.js';
import { badRequest } from '../lib/errors.js';

/**
 * The comparison key for a person's name: case, accents and punctuation folded away, the
 * same normalization job titles get. Two contacts may share one (there is more than one
 * Anna Svensson), so it is only ever used together with something else.
 */
export function personKey(name: string): string {
  return titleKey(name);
}

// ---------------------------------------------------------------- reading

/** Interaction figures for many contacts in one query, never one per contact. */
async function hydrateContacts(repos: Repos, rows: readonly ContactRow[]): Promise<ContactView[]> {
  if (rows.length === 0) return [];
  const interactions = await repos.interactions.findMany({
    where: [{ field: 'contactId', op: 'in', value: rows.map((row) => row.id) }],
  });

  const stats = new Map<string, { count: number; last: string | null }>();
  for (const interaction of interactions) {
    const entry = stats.get(interaction.contactId) ?? { count: 0, last: null };
    entry.count += 1;
    const on = toInteraction(interaction).occurredOn;
    if (entry.last === null || on > entry.last) entry.last = on;
    stats.set(interaction.contactId, entry);
  }

  return rows.map((row) => ({
    ...toContact(row),
    lastInteractionOn: stats.get(row.id)?.last ?? null,
    interactionCount: stats.get(row.id)?.count ?? 0,
  }));
}

/**
 * Contacts, sorted by name, narrowed by `filter`.
 *
 * The database does the equality filters; the free-text `q` runs in memory afterwards,
 * because it spans several columns and repolayer has no OR.
 */
export async function listContacts(
  repos: Repos,
  filter: Partial<ContactFilter> = {},
): Promise<ContactView[]> {
  const where: Record<string, unknown>[] = [];
  if (!filter.includeArchived) where.push({ field: 'archived', op: 'eq', value: false });
  if (filter.relationship && filter.relationship.length > 0) {
    where.push({ field: 'relationship', op: 'in', value: [...filter.relationship] });
  }
  if (filter.company !== undefined) {
    const key = companyKey(filter.company);
    if (!key) return [];
    where.push({ field: 'companyKey', op: 'eq', value: key });
  }
  if (filter.reconnectDue) {
    where.push({ field: 'reconnectOn', op: 'isNull', value: false });
    where.push({ field: 'reconnectOn', op: 'lte', value: parseDateOnly(todayDateOnly()) });
  }

  const rows = await repos.contacts.findMany({
    ...(where.length > 0 ? { where: where as never } : {}),
    orderBy: [{ field: 'name', direction: 'asc' }],
  });

  const words = normalizeText(filter.q ?? '').split(' ').filter(Boolean);
  const matching =
    words.length === 0
      ? rows
      : rows.filter((row) => {
          const haystack = normalizeText(
            [row.name, row.companyName, row.headline, row.email, row.about].filter(Boolean).join(' '),
          );
          return words.every((word) => haystack.includes(word));
        });

  return hydrateContacts(repos, matching.slice(0, filter.limit ?? 500));
}

/** Contacts by id, in no particular order, skipping ids that no longer exist. */
export async function contactViewsByIds(repos: Repos, ids: readonly string[]): Promise<ContactView[]> {
  if (ids.length === 0) return [];
  const rows = await repos.contacts.findMany({ where: [{ field: 'id', op: 'in', value: [...ids] }] });
  return hydrateContacts(repos, rows);
}

/** Everyone the user knows at an employer, by name, matched the way companies are. */
export async function contactsAtCompany(repos: Repos, companyName: string): Promise<ContactView[]> {
  return listContacts(repos, { company: companyName });
}

/** Contacts whose reconnect date has arrived, soonest first. */
export async function reconnectsDue(repos: Repos): Promise<ContactView[]> {
  const due = await listContacts(repos, { reconnectDue: true });
  return due.sort((a, b) => (a.reconnectOn ?? '').localeCompare(b.reconnectOn ?? ''));
}

/** "Backend Engineer at Spotify" for each linked application or opening that still exists. */
async function labelsFor(
  repos: Repos,
  links: readonly { targetType: string; targetId: string }[],
): Promise<Map<string, string>> {
  const idsOf = (type: ContactLinkTarget) =>
    links.filter((link) => link.targetType === type).map((link) => link.targetId);
  const applicationIds = idsOf('application');
  const openingIds = idsOf('opening');

  const [applications, openings] = await Promise.all([
    applicationIds.length
      ? repos.applications.findMany({ where: [{ field: 'id', op: 'in', value: applicationIds }] })
      : Promise.resolve([]),
    openingIds.length
      ? repos.jobOpenings.findMany({ where: [{ field: 'id', op: 'in', value: openingIds }] })
      : Promise.resolve([]),
  ]);

  const companyIds = [...new Set([...applications, ...openings].map((row) => row.companyId))];
  const companies = companyIds.length
    ? await repos.companies.findMany({ where: [{ field: 'id', op: 'in', value: companyIds }] })
    : [];
  const companyName = new Map(companies.map((company) => [company.id, company.name]));

  const labels = new Map<string, string>();
  for (const row of applications) {
    labels.set(`application:${row.id}`, `${row.jobTitle} at ${companyName.get(row.companyId) ?? 'unknown company'}`);
  }
  for (const row of openings) {
    labels.set(`opening:${row.id}`, `${row.jobTitle} at ${companyName.get(row.companyId) ?? 'unknown company'}`);
  }
  return labels;
}

export async function getContact(repos: Repos, id: string): Promise<ContactDetail | null> {
  const row = await repos.contacts.findById(id);
  if (!row) return null;

  const [[view], interactions, links] = await Promise.all([
    hydrateContacts(repos, [row]),
    repos.interactions.findMany({
      where: { contactId: id },
      orderBy: [
        { field: 'occurredOn', direction: 'desc' },
        { field: 'createdAt', direction: 'desc' },
      ],
    }),
    repos.contactLinks.findMany({ where: { contactId: id } }),
  ]);

  const labels = await labelsFor(repos, links);
  const wireLinks: ContactLink[] = links.map((link) => ({
    id: link.id,
    contactId: link.contactId,
    targetType: toContactLinkTarget(link.targetType),
    targetId: link.targetId,
    role: toContactRole(link.role),
    targetLabel: labels.get(`${link.targetType}:${link.targetId}`) ?? null,
  }));

  return { ...view!, interactions: interactions.map(toInteraction), links: wireLinks };
}

/** The contacts linked to one application or opening, with the part each played. */
export async function contactsForTarget(
  repos: Repos,
  targetType: ContactLinkTarget,
  targetId: string,
): Promise<LinkedContact[]> {
  const links = await repos.contactLinks.findMany({ where: { targetType, targetId } });
  if (links.length === 0) return [];

  const rows = await repos.contacts.findMany({
    where: [{ field: 'id', op: 'in', value: links.map((link) => link.contactId) }],
  });
  const views = new Map((await hydrateContacts(repos, rows)).map((view) => [view.id, view]));

  return links
    .map((link) => {
      const view = views.get(link.contactId);
      return view ? { ...view, linkId: link.id, role: toContactRole(link.role) } : null;
    })
    .filter((entry): entry is LinkedContact => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- writing

export interface ContactData {
  name: string;
  companyName: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  relationship: Relationship;
  about: string | null;
  reconnectOn: string | null;
  connectedOn?: string | null;
}

/** The derived columns for a name and an employer, written in exactly one place. */
function identityFields(name: string, companyName: string | null) {
  const display = displayName(name);
  const company = companyName ? displayName(companyName) : null;
  return {
    name: display,
    nameKey: personKey(display),
    companyName: company || null,
    companyKey: company ? companyKey(company) || null : null,
  };
}

export async function createContact(repos: Repos, data: ContactData): Promise<ContactView> {
  const row = await repos.contacts.create({
    ...identityFields(data.name, data.companyName),
    headline: data.headline,
    email: data.email,
    phone: data.phone,
    linkedinUrl: canonicalLinkedInUrl(data.linkedinUrl),
    relationship: data.relationship,
    about: data.about,
    reconnectOn: data.reconnectOn ? parseDateOnly(data.reconnectOn) : null,
    connectedOn: data.connectedOn ? parseDateOnly(data.connectedOn) : null,
    archived: false,
  });
  return (await hydrateContacts(repos, [row]))[0]!;
}

export interface PatchContactData {
  name?: string;
  companyName?: string | null;
  headline?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  relationship?: Relationship;
  about?: string | null;
  reconnectOn?: string | null;
  archived?: boolean;
}

export async function updateContact(
  repos: Repos,
  id: string,
  patch: PatchContactData,
): Promise<ContactView | null> {
  const existing = await repos.contacts.findById(id);
  if (!existing) return null;

  const changes: Record<string, unknown> = {};
  if (patch.name !== undefined || patch.companyName !== undefined) {
    Object.assign(
      changes,
      identityFields(
        patch.name ?? existing.name,
        patch.companyName !== undefined ? patch.companyName : existing.companyName,
      ),
    );
  }
  if (patch.headline !== undefined) changes.headline = patch.headline;
  if (patch.email !== undefined) changes.email = patch.email;
  if (patch.phone !== undefined) changes.phone = patch.phone;
  if (patch.linkedinUrl !== undefined) changes.linkedinUrl = canonicalLinkedInUrl(patch.linkedinUrl);
  if (patch.relationship !== undefined) changes.relationship = patch.relationship;
  if (patch.about !== undefined) changes.about = patch.about;
  if (patch.reconnectOn !== undefined) {
    changes.reconnectOn = patch.reconnectOn ? parseDateOnly(patch.reconnectOn) : null;
  }
  if (patch.archived !== undefined) changes.archived = patch.archived;

  const row = Object.keys(changes).length > 0 ? await repos.contacts.update(id, changes as never) : existing;
  return (await hydrateContacts(repos, [row]))[0]!;
}

/** A contact and everything hanging off them, in one transaction. */
export async function deleteContact(repos: Repos, id: string): Promise<boolean> {
  const existing = await repos.contacts.findById(id);
  if (!existing) return false;

  await repos.contacts.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);
    await scoped.interactions.deleteMany({ where: { contactId: id } });
    await scoped.contactLinks.deleteMany({ where: { contactId: id } });
    await scoped.contacts.delete(id);
  });
  return true;
}

export interface InteractionData {
  occurredOn?: string;
  channel: string;
  direction: string;
  summary: string;
  applicationId: string | null;
  /** Moves the contact's reconnect date in the same step; null clears it, undefined leaves it. */
  reconnectOn?: string | null;
}

/** Record a conversation. Returns null when the contact does not exist. */
export async function logInteraction(
  repos: Repos,
  contactId: string,
  data: InteractionData,
): Promise<Interaction | null> {
  const contact = await repos.contacts.findById(contactId);
  if (!contact) return null;
  if (data.applicationId && !(await repos.applications.findById(data.applicationId))) {
    throw badRequest('No such application');
  }

  const row = await repos.interactions.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);
    const created = await scoped.interactions.create({
      contactId,
      occurredOn: parseDateOnly(data.occurredOn ?? todayDateOnly()),
      channel: data.channel,
      direction: data.direction,
      summary: data.summary,
      applicationId: data.applicationId,
    });
    if (data.reconnectOn !== undefined) {
      await scoped.contacts.update(contactId, {
        reconnectOn: data.reconnectOn ? parseDateOnly(data.reconnectOn) : null,
      } as never);
    }
    return created;
  });
  return toInteraction(row);
}

export async function deleteInteraction(repos: Repos, id: string): Promise<boolean> {
  const existing = await repos.interactions.findById(id);
  if (!existing) return false;
  await repos.interactions.delete(id);
  return true;
}

/**
 * Link a contact to an application or opening. Linking the same pair again changes the role
 * rather than adding a second link. Returns null when the contact does not exist.
 */
export async function linkContact(
  repos: Repos,
  contactId: string,
  input: { targetType: ContactLinkTarget; targetId: string; role: ContactRole },
): Promise<ContactLink | null> {
  const contact = await repos.contacts.findById(contactId);
  if (!contact) return null;

  const target =
    input.targetType === 'application'
      ? await repos.applications.findById(input.targetId)
      : await repos.jobOpenings.findById(input.targetId);
  if (!target) throw badRequest(`No such ${input.targetType}`);

  const existing = await repos.contactLinks.findOne({
    where: { contactId, targetType: input.targetType, targetId: input.targetId },
  });
  const row = existing
    ? await repos.contactLinks.update(existing.id, { role: input.role } as never)
    : await repos.contactLinks.create({ contactId, ...input });

  const labels = await labelsFor(repos, [row]);
  return {
    id: row.id,
    contactId: row.contactId,
    targetType: toContactLinkTarget(row.targetType),
    targetId: row.targetId,
    role: toContactRole(row.role),
    targetLabel: labels.get(`${row.targetType}:${row.targetId}`) ?? null,
  };
}

export async function unlinkContact(repos: Repos, linkId: string): Promise<boolean> {
  const existing = await repos.contactLinks.findById(linkId);
  if (!existing) return false;
  await repos.contactLinks.delete(linkId);
  return true;
}

/**
 * What deleting an application or opening has to do to the network: its links go, and
 * conversations that were about an application keep their history but lose the pointer.
 * Takes repos already scoped to the caller's transaction.
 */
export async function detachTarget(scoped: Repos, targetType: ContactLinkTarget, targetId: string): Promise<void> {
  await scoped.contactLinks.deleteMany({ where: { targetType, targetId } });
  if (targetType === 'application') {
    await scoped.interactions.updateMany({ where: { applicationId: targetId } }, { applicationId: null } as never);
  }
}

/**
 * Keep contacts pointing at a company through a rename. Contacts match companies by key, so
 * renaming "Spotify" to "Spotify Technology" would otherwise leave everyone who works there
 * behind under the old key.
 */
export async function followCompanyRename(repos: Repos, oldKey: string, newName: string): Promise<void> {
  const newKey = companyKey(newName);
  if (!oldKey || !newKey || oldKey === newKey) return;
  await repos.contacts.updateMany(
    { where: { companyKey: oldKey } },
    { companyKey: newKey, companyName: displayName(newName) } as never,
  );
}

// ---------------------------------------------------------------- LinkedIn import

export type ImportVerdict = 'new' | 'duplicate' | 'error';

export interface LinkedInPreviewRow {
  rowNumber: number;
  name: string;
  companyName: string | null;
  headline: string | null;
  connectedOn: string | null;
  verdict: ImportVerdict;
  /** Why a row is a duplicate or an error. */
  reason: string | null;
  /** True when the employer is a company already in JobTrack, which is what makes this person useful. */
  knownCompany: boolean;
}

export interface LinkedInPreview {
  fileErrors: string[];
  totals: { new: number; duplicate: number; error: number; atKnownCompanies: number };
  rows: LinkedInPreviewRow[];
}

export interface LinkedInCommitResult {
  fileErrors: string[];
  created: number;
  skipped: number;
}

/**
 * Classify every row of a Connections.csv without writing anything.
 *
 * A row is a duplicate when its profile link is already on a contact, or, for a row without a
 * link, when a contact with the same name already works at the same employer. Repeats inside
 * the file itself are caught the same way.
 */
export async function previewLinkedInImport(repos: Repos, csv: string): Promise<LinkedInPreview> {
  const parsed = parseLinkedInConnections(csv);
  const [contacts, companies] = await Promise.all([repos.contacts.findMany({}), repos.companies.findMany({})]);

  const knownUrls = new Set(contacts.map((row) => row.linkedinUrl).filter((url): url is string => Boolean(url)));
  const knownPeople = new Set(contacts.map((row) => `${row.nameKey}|${row.companyKey ?? ''}`));
  const companyKeys = new Set(companies.map((row) => row.nameKey));

  const rows: LinkedInPreviewRow[] = parsed.rows.map((connection) => {
    const key = connection.companyName ? companyKey(connection.companyName) : '';
    const base = {
      rowNumber: connection.rowNumber,
      name: connection.name,
      companyName: connection.companyName,
      headline: connection.headline,
      connectedOn: connection.connectedOn,
      knownCompany: key !== '' && companyKeys.has(key),
    };

    if (!connection.name.trim()) {
      return { ...base, verdict: 'error' as const, reason: 'No name' };
    }

    const person = `${personKey(connection.name)}|${key}`;
    const duplicate = connection.linkedinUrl ? knownUrls.has(connection.linkedinUrl) : knownPeople.has(person);
    if (duplicate) {
      return { ...base, verdict: 'duplicate' as const, reason: 'Already in your people' };
    }

    if (connection.linkedinUrl) knownUrls.add(connection.linkedinUrl);
    knownPeople.add(person);
    return { ...base, verdict: 'new' as const, reason: null };
  });

  return {
    fileErrors: parsed.errors,
    totals: {
      new: rows.filter((row) => row.verdict === 'new').length,
      duplicate: rows.filter((row) => row.verdict === 'duplicate').length,
      error: rows.filter((row) => row.verdict === 'error').length,
      atKnownCompanies: rows.filter((row) => row.verdict === 'new' && row.knownCompany).length,
    },
    rows,
  };
}

/** Create every row the preview calls new. Re-classifies rather than trusting a stale preview. */
export async function commitLinkedInImport(repos: Repos, csv: string): Promise<LinkedInCommitResult> {
  const preview = await previewLinkedInImport(repos, csv);
  const parsed = new Map(parseLinkedInConnections(csv).rows.map((row) => [row.rowNumber, row]));

  const records = preview.rows
    .filter((row) => row.verdict === 'new')
    .map((row) => {
      const connection = parsed.get(row.rowNumber)!;
      return {
        ...identityFields(connection.name, connection.companyName),
        headline: connection.headline,
        email: connection.email,
        phone: null,
        linkedinUrl: connection.linkedinUrl,
        relationship: 'connection',
        about: null,
        reconnectOn: null,
        connectedOn: connection.connectedOn ? parseDateOnly(connection.connectedOn) : null,
        archived: false,
      };
    });

  // One transaction, in batches: a network export runs to thousands of rows, and inserting
  // them one round trip at a time would keep the user waiting for no benefit. All or nothing,
  // so a failure part-way leaves no half-imported network to untangle.
  const BATCH = 500;
  await repos.contacts.withTransaction(async (_tx, ctx: TxContext) => {
    const scoped = scopedRepos(repos, ctx);
    for (let i = 0; i < records.length; i += BATCH) {
      await scoped.contacts.createMany(records.slice(i, i + BATCH));
    }
  });

  return {
    fileErrors: preview.fileErrors,
    created: records.length,
    skipped: preview.totals.duplicate + preview.totals.error,
  };
}
