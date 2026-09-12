import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayDateOnly } from '@jobtrack/shared';
import { buildApp } from '../src/app.js';
import type { Deps } from '../src/deps.js';
import type { RepoBundle } from '../src/db/repos.js';
import { createApplication, deleteApplication } from '../src/services/applications.service.js';
import { findCompanyByName, updateCompany } from '../src/services/companies.service.js';
import { createOpening, deleteOpening } from '../src/services/openings.service.js';
import { checkDuplicates } from '../src/services/duplicates.service.js';
import { getAgenda } from '../src/services/agenda.service.js';
import {
  commitLinkedInImport,
  contactsForTarget,
  createContact,
  deleteContact,
  getContact,
  linkContact,
  listContacts,
  logInteraction,
  previewLinkedInImport,
  updateContact,
  type ContactData,
} from '../src/services/contacts.service.js';
import { createSnapshot, restoreSnapshot, validateSnapshot } from '../src/backup/snapshot.js';
import { resolveHits } from '../src/search/results.js';
import { applicationInput, openingInput, testDeps } from './support/repos.js';

let deps: Deps;
let repos: RepoBundle;

beforeEach(() => {
  deps = testDeps();
  repos = deps.repos as RepoBundle;
});

function person(over: Partial<ContactData> = {}): ContactData {
  return {
    name: 'Maria Lindqvist',
    companyName: 'Spotify',
    headline: 'Engineering Manager',
    email: null,
    phone: null,
    linkedinUrl: null,
    relationship: 'colleague',
    about: null,
    reconnectOn: null,
    ...over,
  };
}

/** `n` days from today (negative for the past), as YYYY-MM-DD. */
function daysFromToday(n: number): string {
  const date = new Date(`${todayDateOnly()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

describe('creating and listing people', () => {
  it('stores the employer as a name and a company key, without creating a company', async () => {
    const contact = await createContact(repos, person({ companyName: '  Spotify AB ' }));
    expect(contact).toMatchObject({ companyName: 'Spotify AB', companyKey: 'spotify', interactionCount: 0 });
    expect(await repos.companies.count()).toBe(0);
  });

  it('finds everyone at an employer however its name is spelled', async () => {
    await createContact(repos, person({ name: 'Maria', companyName: 'Spotify AB' }));
    await createContact(repos, person({ name: 'Olle', companyName: 'spotify' }));
    await createContact(repos, person({ name: 'Johan', companyName: 'Klarna' }));

    const atSpotify = await listContacts(repos, { company: 'Spotify, Inc.' });
    expect(atSpotify.map((c) => c.name)).toEqual(['Maria', 'Olle']);
  });

  it('filters by words, relationship and reconnect date', async () => {
    await createContact(repos, person({ name: 'Maria', about: 'Met at a Kotlin meetup', reconnectOn: daysFromToday(-1) }));
    await createContact(repos, person({ name: 'Johan', companyName: 'Klarna', relationship: 'recruiter', reconnectOn: daysFromToday(10) }));

    expect((await listContacts(repos, { q: 'kotlin spotify' })).map((c) => c.name)).toEqual(['Maria']);
    expect((await listContacts(repos, { relationship: ['recruiter'] })).map((c) => c.name)).toEqual(['Johan']);
    expect((await listContacts(repos, { reconnectDue: true })).map((c) => c.name)).toEqual(['Maria']);
  });

  it('canonicalizes LinkedIn profile links', async () => {
    const contact = await createContact(repos, person({ linkedinUrl: 'https://se.linkedin.com/in/MariaL/?trk=1' }));
    expect(contact.linkedinUrl).toBe('https://www.linkedin.com/in/marial');
  });

  it('recomputes the company key when the employer changes', async () => {
    const contact = await createContact(repos, person());
    const moved = await updateContact(repos, contact.id, { companyName: 'Klarna Bank AB' });
    expect(moved).toMatchObject({ companyName: 'Klarna Bank AB', companyKey: 'klarna bank' });
    expect(await updateContact(repos, 'missing', { name: 'x' })).toBeNull();
  });
});

describe('conversations', () => {
  it('logs a conversation, counts it, and moves the reminder in the same step', async () => {
    const contact = await createContact(repos, person({ reconnectOn: daysFromToday(-3) }));
    await logInteraction(repos, contact.id, {
      occurredOn: '2026-08-09',
      channel: 'linkedin',
      direction: 'outbound',
      summary: 'Asked about the EM role',
      applicationId: null,
      reconnectOn: '2026-09-20',
    });

    const detail = await getContact(repos, contact.id);
    expect(detail).toMatchObject({ interactionCount: 1, lastInteractionOn: '2026-08-09', reconnectOn: '2026-09-20' });
    expect(detail!.interactions[0]!.summary).toBe('Asked about the EM role');
  });

  it('leaves the reminder alone when no reconnect date is given', async () => {
    const contact = await createContact(repos, person({ reconnectOn: '2026-12-01' }));
    await logInteraction(repos, contact.id, { channel: 'email', direction: 'inbound', summary: 'Replied', applicationId: null });
    expect((await getContact(repos, contact.id))!.reconnectOn).toBe('2026-12-01');
  });

  it('refuses a conversation about an application that does not exist', async () => {
    const contact = await createContact(repos, person());
    await expect(
      logInteraction(repos, contact.id, {
        channel: 'email',
        direction: 'inbound',
        summary: 'x',
        applicationId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow(/No such application/);
    expect(await logInteraction(repos, 'missing', { channel: 'email', direction: 'inbound', summary: 'x', applicationId: null })).toBeNull();
  });
});

describe('links to applications and openings', () => {
  it('links a person with a role, labels the link, and relinking changes the role', async () => {
    const application = await createApplication(repos, applicationInput({ jobTitle: 'Engineering Manager' }));
    const contact = await createContact(repos, person());

    await linkContact(repos, contact.id, { targetType: 'application', targetId: application.id, role: 'contact' });
    const relinked = await linkContact(repos, contact.id, { targetType: 'application', targetId: application.id, role: 'referral' });

    expect(relinked).toMatchObject({ role: 'referral', targetLabel: 'Engineering Manager at Spotify' });
    expect(await repos.contactLinks.count()).toBe(1);
    const linked = await contactsForTarget(repos, 'application', application.id);
    expect(linked.map((c) => [c.name, c.role])).toEqual([['Maria Lindqvist', 'referral']]);
  });

  it('refuses to link to something that does not exist', async () => {
    const contact = await createContact(repos, person());
    await expect(
      linkContact(repos, contact.id, { targetType: 'opening', targetId: '00000000-0000-4000-8000-000000000000', role: 'contact' }),
    ).rejects.toThrow(/No such opening/);
  });

  it('deleting an application removes its links but keeps the conversation, unpointed', async () => {
    const application = await createApplication(repos, applicationInput());
    const contact = await createContact(repos, person());
    await linkContact(repos, contact.id, { targetType: 'application', targetId: application.id, role: 'referral' });
    await logInteraction(repos, contact.id, { channel: 'email', direction: 'inbound', summary: 'About the role', applicationId: application.id });

    await deleteApplication(repos, application.id);

    const detail = await getContact(repos, contact.id);
    expect(detail!.links).toEqual([]);
    expect(detail!.interactions).toHaveLength(1);
    expect(detail!.interactions[0]!.applicationId).toBeNull();
  });

  it('deleting an opening removes its links', async () => {
    const opening = await createOpening(repos, openingInput());
    const contact = await createContact(repos, person());
    await linkContact(repos, contact.id, { targetType: 'opening', targetId: opening.id, role: 'contact' });

    await deleteOpening(repos, opening.id);
    expect(await repos.contactLinks.count()).toBe(0);
  });

  it('deleting a person removes their conversations and links', async () => {
    const application = await createApplication(repos, applicationInput());
    const contact = await createContact(repos, person());
    await linkContact(repos, contact.id, { targetType: 'application', targetId: application.id, role: 'referral' });
    await logInteraction(repos, contact.id, { channel: 'email', direction: 'inbound', summary: 'Hi', applicationId: null });

    expect(await deleteContact(repos, contact.id)).toBe(true);
    expect(await repos.interactions.count()).toBe(0);
    expect(await repos.contactLinks.count()).toBe(0);
    expect(await deleteContact(repos, contact.id)).toBe(false);
  });
});

describe('people and companies', () => {
  it('keeps people at a company when the company is renamed', async () => {
    await createApplication(repos, applicationInput({ companyName: 'Spotify' }));
    await createContact(repos, person({ companyName: 'Spotify AB' }));
    const company = await findCompanyByName(repos, 'Spotify');

    await updateCompany(repos, company!.id, { name: 'Spotify Technology' });

    expect((await listContacts(repos, { company: 'Spotify Technology' })).map((c) => c.companyName)).toEqual([
      'Spotify Technology',
    ]);
  });

  it('names the people you know in a duplicate check, even for a company you never applied to', async () => {
    await createContact(repos, person({ name: 'Johan', companyName: 'Klarna', relationship: 'connection' }));
    await createContact(repos, person({ name: 'Lina', companyName: 'Klarna', relationship: 'recruiter' }));

    const check = await checkDuplicates(repos, null, { company: 'Klarna AB', title: 'Platform Engineer' });
    expect(check.verdict).toBe('none');
    // A recruiter is worth mentioning before a connection nobody has spoken to.
    expect(check.contacts.map((c) => c.name)).toEqual(['Lina', 'Johan']);
  });

  it('puts people due a reconnect on the agenda', async () => {
    await createContact(repos, person({ name: 'Due', reconnectOn: daysFromToday(-2) }));
    await createContact(repos, person({ name: 'Later', reconnectOn: daysFromToday(5) }));
    expect((await getAgenda(repos)).reconnect.map((c) => c.name)).toEqual(['Due']);
  });
});

describe('LinkedIn connections import', () => {
  const header = 'First Name,Last Name,URL,Email Address,Company,Position,Connected On';
  const csv = [
    'Notes:',
    '"Some email addresses may be missing."',
    '',
    header,
    'Maria,Lindqvist,https://www.linkedin.com/in/marial,,Spotify,Engineering Manager,12 Mar 2024',
    'Johan,Berg,,,Klarna,Recruiter,03 Jan 2023',
    'Johan,Berg,,,Klarna,Recruiter,03 Jan 2023',
    ',,,,,,',
    'Erik,Holm,https://www.linkedin.com/in/erikholm,,Tibber,Designer,01 Feb 2022',
  ].join('\n');

  it('previews without writing, and flags people at companies already in JobTrack', async () => {
    await createApplication(repos, applicationInput({ companyName: 'Spotify AB' }));
    const preview = await previewLinkedInImport(repos, csv);

    expect(await repos.contacts.count()).toBe(0);
    expect(preview.totals).toEqual({ new: 3, duplicate: 1, error: 0, atKnownCompanies: 1 });
    expect(preview.rows.find((row) => row.name === 'Maria Lindqvist')!.knownCompany).toBe(true);
  });

  it('commits the new rows, and a second import of the same file adds nobody', async () => {
    const first = await commitLinkedInImport(repos, csv);
    expect(first).toMatchObject({ created: 3, skipped: 1 });

    const maria = (await listContacts(repos, { q: 'maria' }))[0]!;
    expect(maria).toMatchObject({ relationship: 'connection', connectedOn: '2024-03-12', companyKey: 'spotify' });

    const second = await commitLinkedInImport(repos, csv);
    expect(second.created).toBe(0);
    expect(await repos.contacts.count()).toBe(3);
  });

  it('recognizes a person already added by hand through their profile link', async () => {
    await createContact(repos, person({ name: 'Maria L.', linkedinUrl: 'https://linkedin.com/in/MariaL' }));
    const preview = await previewLinkedInImport(repos, csv);
    expect(preview.rows.find((row) => row.name === 'Maria Lindqvist')!.verdict).toBe('duplicate');
  });
});

describe('search, backup and routes', () => {
  it('finds a person by what was said to them', async () => {
    const contact = await createContact(repos, person({ name: 'Johan Berg', companyName: 'Klarna', headline: 'Recruiter' }));
    await logInteraction(repos, contact.id, { channel: 'email', direction: 'inbound', summary: 'Payments team is hiring', applicationId: null });
    await deps.search.rebuild();

    const outcome = await deps.search.search('payments recruiter', { types: ['contact'] });
    const hits = await resolveHits(repos, outcome.hits);
    expect(hits[0]).toMatchObject({ type: 'contact', record: { name: 'Johan Berg' } });
  });

  it('backs people up and restores them, and restores a backup made before they existed', async () => {
    const contact = await createContact(repos, person());
    await logInteraction(repos, contact.id, { channel: 'email', direction: 'inbound', summary: 'Hi', applicationId: null });
    const snapshot = await createSnapshot(repos);

    await restoreSnapshot(repos, deps.search, validateSnapshot(JSON.parse(JSON.stringify(snapshot))));
    expect((await getContact(repos, contact.id))!.interactions).toHaveLength(1);

    const { contacts: _c, interactions: _i, contactLinks: _l, ...olderTables } = snapshot.tables;
    const older = validateSnapshot({ ...snapshot, tables: olderTables });
    await restoreSnapshot(repos, deps.search, older);
    expect(await repos.contacts.count()).toBe(0);
  });

  describe('over HTTP', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = await buildApp(deps);
    });

    afterEach(async () => {
      await app.close();
    });

    it('creates, lists, logs and links through the routes', async () => {
      const application = await createApplication(repos, applicationInput());

      const created = await app.inject({ method: 'POST', url: '/api/contacts', payload: { name: 'Maria', companyName: 'Spotify' } });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;

      const logged = await app.inject({
        method: 'POST',
        url: `/api/contacts/${id}/interactions`,
        payload: { summary: 'Coffee', channel: 'meeting' },
      });
      expect(logged.statusCode).toBe(201);

      const linked = await app.inject({
        method: 'POST',
        url: `/api/contacts/${id}/links`,
        payload: { targetType: 'application', targetId: application.id, role: 'referral' },
      });
      expect(linked.statusCode).toBe(201);

      const list = await app.inject({ method: 'GET', url: '/api/contacts?company=spotify%20ab' });
      expect(list.json().contacts).toHaveLength(1);

      const forApplication = await app.inject({ method: 'GET', url: `/api/contacts/linked/application/${application.id}` });
      expect(forApplication.json().contacts[0]).toMatchObject({ name: 'Maria', role: 'referral' });

      expect((await app.inject({ method: 'GET', url: '/api/contacts/nope' })).statusCode).toBe(404);
    });

    it('accepts a LinkedIn export larger than the default body limit', async () => {
      const rows = Array.from(
        { length: 12000 },
        (_, i) => `Person,Number${i},https://www.linkedin.com/in/person-number-${i},,Company ${i % 50},Senior Software Engineer,01 Jan 2024`,
      );
      const csv = ['First Name,Last Name,URL,Email Address,Company,Position,Connected On', ...rows].join('\n');
      expect(csv.length).toBeGreaterThan(1024 * 1024);

      const response = await app.inject({ method: 'POST', url: '/api/contacts/import/linkedin?mode=preview', payload: { csv } });
      expect(response.statusCode).toBe(200);
      expect(response.json().totals.new).toBe(12000);
    });
  });
});
