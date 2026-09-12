/**
 * Turning ranked search hits back into records.
 *
 * The index hands back ids and types; the rows are fetched here in one batched `in` query per
 * type and put back in ranking order, since the database has no idea what relevance is. The
 * REST route, the MCP tool and the demo build all go through this, so a new searchable type
 * is added in one place.
 */

import type { Company, ContactView, JobApplicationView, Note } from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import { hydrateApplications } from '../db/hydrate.js';
import { toCompany, toNote } from '../db/mappers.js';
import { contactViewsByIds } from '../services/contacts.service.js';
import type { SearchHit } from './index.js';

export type SearchRecord =
  | { type: 'application'; record: JobApplicationView }
  | { type: 'company'; record: Company }
  | { type: 'note'; record: Note }
  | { type: 'contact'; record: ContactView };

export type ResolvedHit = Omit<SearchHit, 'type'> & SearchRecord;

export async function resolveHits(repos: Repos, hits: readonly SearchHit[]): Promise<ResolvedHit[]> {
  const idsOf = (type: SearchHit['type']) => hits.filter((hit) => hit.type === type).map((hit) => hit.entityId);
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  const inIds = (ids: string[]) => ({ where: [{ field: 'id' as const, op: 'in' as const, value: ids }] });

  const applicationIds = idsOf('application');
  const companyIds = idsOf('company');
  const noteIds = idsOf('note');

  const [applicationRows, companyRows, noteRows, contacts] = await Promise.all([
    applicationIds.length ? repos.applications.findMany(inIds(applicationIds)) : Promise.resolve([]),
    companyIds.length ? repos.companies.findMany(inIds(companyIds)) : Promise.resolve([]),
    noteIds.length ? repos.notes.findMany(inIds(noteIds)) : Promise.resolve([]),
    contactViewsByIds(repos, idsOf('contact')),
  ]);

  const applications = byId(await hydrateApplications(repos, applicationRows));
  const companies = byId(companyRows.map(toCompany));
  const notes = byId(noteRows.map(toNote));
  const people = byId(contacts);

  const resolved: ResolvedHit[] = [];
  for (const hit of hits) {
    const { type, ...rest } = hit;
    switch (type) {
      case 'application': {
        const record = applications.get(hit.entityId);
        if (record) resolved.push({ ...rest, type, record });
        break;
      }
      case 'company': {
        const record = companies.get(hit.entityId);
        if (record) resolved.push({ ...rest, type, record });
        break;
      }
      case 'note': {
        const record = notes.get(hit.entityId);
        if (record) resolved.push({ ...rest, type, record });
        break;
      }
      case 'contact': {
        const record = people.get(hit.entityId);
        if (record) resolved.push({ ...rest, type, record });
        break;
      }
    }
  }
  return resolved;
}
