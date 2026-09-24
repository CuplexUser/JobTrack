/**
 * The MCP server as a client sees it: every tool module and the prompts registered on one
 * server, reached through a real MCP `Client` over an in-memory transport, backed by the
 * API's in-memory repos. This is what catches a tool whose schema cannot be advertised, or
 * a result shape that only breaks once it is serialized.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { todayDateOnly } from '@jobtrack/shared';
import type { Deps } from '@jobtrack/api/deps';
import { createApplication } from '@jobtrack/api/services/applications';
import { testDeps, applicationInput } from '../../api/test/support/repos.js';
import { registerApplicationTools } from '../src/tools/applications.js';
import { registerCompanyTools } from '../src/tools/companies.js';
import { registerNoteTools } from '../src/tools/notes.js';
import { registerTagTools } from '../src/tools/tags.js';
import { registerOpeningTools } from '../src/tools/openings.js';
import { registerSearchTool } from '../src/tools/search.js';
import { registerDashboardTool } from '../src/tools/dashboard.js';
import { registerAgendaTool } from '../src/tools/agenda.js';
import { registerCaptureTool } from '../src/tools/capture.js';
import { registerContactTools } from '../src/tools/contacts.js';
import { registerProfileTools } from '../src/tools/profile.js';
import { registerSourceTools } from '../src/tools/sources.js';
import { PROMPT_NAMES, registerPrompts } from '../src/prompts.js';

let deps: Deps;
let client: Client;

beforeEach(async () => {
  deps = testDeps();
  const server = new McpServer({ name: 'jobtrack-test', version: '0.0.0' });
  registerApplicationTools(server, deps);
  registerCompanyTools(server, deps);
  registerNoteTools(server, deps);
  registerTagTools(server, deps);
  registerOpeningTools(server, deps);
  registerSearchTool(server, deps);
  registerDashboardTool(server, deps);
  registerAgendaTool(server, deps);
  registerCaptureTool(server, deps);
  registerContactTools(server, deps);
  registerProfileTools(server, deps);
  registerSourceTools(server, deps);
  registerPrompts(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
});

/** Call a tool and parse its JSON text result. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; body: any }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  const text = result.content[0]!.text;
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // An error result is plain prose.
  }
  return { isError: result.isError === true, body };
}

/** `n` days before today, as YYYY-MM-DD. */
function daysAgo(n: number): string {
  const date = new Date(`${todayDateOnly()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

const POSTING = `Backend Engineer at Acme Robotics
Stockholm, hybrid
We build warehouse robots and need someone who likes Postgres.`;

describe('discovery', () => {
  it('advertises the new tools alongside the existing ones', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of [
      'capture_posting',
      'get_agenda',
      'bulk_change_status',
      'find_duplicate_groups',
      'list_openings',
      'list_contacts',
      'get_contact',
      'create_contact',
      'update_contact',
      'log_interaction',
      'link_contact',
      'list_linked_contacts',
      'get_profile',
      'update_profile',
      'rank_openings',
      'score_postings',
      'get_job_sources',
      'update_job_sources',
      'get_statistics',
    ]) {
      expect(names).toContain(name);
    }
  });

  it('offers every workflow prompt, and renders one with its argument', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([...PROMPT_NAMES].sort());

    const rendered = await client.getPrompt({
      name: 'log_email_update',
      arguments: { email: 'Unfortunately we have decided to move on.' },
    });
    const message = rendered.messages[0]!.content as { type: string; text: string };
    expect(message.text).toContain('Unfortunately we have decided to move on.');
    expect(message.text).toContain('change_application_status');
  });
});

describe('capture_posting', () => {
  it('parses text into a draft without saving unless asked', async () => {
    const { isError, body } = await call('capture_posting', { text: POSTING });
    expect(isError).toBe(false);
    expect(body.saved).toBe(false);
    expect(body.draft.companyName).toBe('Acme Robotics');
    expect(body.duplicate.verdict).toBe('none');
    expect((await call('list_openings')).body).toEqual([]);
  });

  it('saves when asked, and refuses the same posting a second time', async () => {
    const first = await call('capture_posting', { text: POSTING, save: true });
    expect(first.body.saved).toBe(true);
    expect(first.body.opening.company).toBe('Acme Robotics');

    const second = await call('capture_posting', { text: POSTING, save: true });
    expect(second.body.saved).toBe(false);
    expect(second.body.existing.id).toBe(first.body.opening.id);
  });

  it('refuses to save a posting already applied to, unless told to', async () => {
    await createApplication(deps.repos, applicationInput({ companyName: 'Acme Robotics', jobTitle: 'Backend Engineer' }));

    const draft = await call('capture_posting', { text: POSTING });
    expect(draft.body.alreadyApplied).toMatchObject({ company: 'Acme Robotics' });

    const refused = await call('capture_posting', { text: POSTING, save: true });
    expect(refused.body).toMatchObject({ saved: false, existingKind: 'application' });

    const forced = await call('capture_posting', { text: POSTING, save: true, allowDuplicate: true });
    expect(forced.body.saved).toBe(true);
  });

  it('rejects a call with neither url nor text', async () => {
    const { isError } = await call('capture_posting', {});
    expect(isError).toBe(true);
  });
});

describe('list_openings', () => {
  it('filters by location and returns compact rows', async () => {
    await call('create_opening', { companyName: 'Axis', jobTitle: 'Firmware', location: 'Lund', notes: 'x'.repeat(1000) });
    await call('create_opening', { companyName: 'Spotify', jobTitle: 'Backend', location: 'Stockholm' });

    const { body } = await call('list_openings', { location: ['lund'] });
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ company: 'Axis', notesTruncated: true });
    expect(body[0].notes.length).toBeLessThan(1000);
  });
});

describe('create_opening duplicates', () => {
  it('refuses the same opening twice, and saves it when allowed', async () => {
    const first = await call('create_opening', { companyName: 'Axis', jobTitle: 'Firmware Engineer' });
    expect(first.body.id).toBeDefined();

    const second = await call('create_opening', { companyName: 'AXIS AB', jobTitle: 'firmware engineer' });
    expect(second.body).toMatchObject({ saved: false, existingKind: 'opening', existing: { id: first.body.id } });

    const forced = await call('create_opening', { companyName: 'Axis', jobTitle: 'Firmware Engineer', allowDuplicate: true });
    expect(forced.body.id).not.toBe(first.body.id);
    expect(await deps.repos.jobOpenings.findMany({})).toHaveLength(2);
  });

  it('decides on the link when both sides have one', async () => {
    const posting = { companyName: 'Axis', jobTitle: 'Firmware Engineer' };
    await call('create_opening', { ...posting, jobUrl: 'https://jobs.example.com/axis/1' });

    const tracked = await call('create_opening', { ...posting, jobUrl: 'https://www.jobs.example.com/axis/1/?utm_source=mail' });
    expect(tracked.body.saved).toBe(false);

    const otherAd = await call('create_opening', { ...posting, jobUrl: 'https://jobs.example.com/axis/2' });
    expect(otherAd.body.id).toBeDefined();
  });

  it('refuses a posting already applied to', async () => {
    const applied = await createApplication(deps.repos, applicationInput({ companyName: 'Spotify', jobTitle: 'Backend Engineer' }));

    const { body } = await call('create_opening', { companyName: 'Spotify', jobTitle: 'Backend Engineer' });
    expect(body).toMatchObject({ saved: false, existingKind: 'application', existing: { id: applied.id } });
    expect(body.reason).toMatch(/you applied to/i);
  });
});

describe('get_statistics', () => {
  it('counts a range and names its applications', async () => {
    await createApplication(deps.repos, applicationInput({ appliedOn: todayDateOnly() }));
    await createApplication(deps.repos, applicationInput({ appliedOn: daysAgo(40), jobTitle: 'Earlier' }));

    const { isError, body } = await call('get_statistics', { from: daysAgo(6), to: todayDateOnly() });
    expect(isError).toBe(false);
    expect(body.totals.applications).toBe(1);
    expect(body.quick.find((w: { key: string }) => w.key === 'today').count).toBe(1);
    expect(body.applications).toEqual([expect.objectContaining({ company: 'Spotify', jobTitle: 'Backend Engineer' })]);
    expect(body.calendar).toBeUndefined();
  });
});

describe('get_agenda and bulk_change_status', () => {
  it('surfaces a quiet application, then marks it ghosted in bulk', async () => {
    const quiet = await createApplication(deps.repos, applicationInput({ appliedOn: daysAgo(45) }));

    const agenda = await call('get_agenda');
    expect(agenda.body.goneQuiet).toHaveLength(1);
    expect(agenda.body.goneQuiet[0]).toMatchObject({ id: quiet.id, silentDays: 45 });

    const bulk = await call('bulk_change_status', { ids: [quiet.id], status: 'ghosted', comment: 'No reply' });
    expect(bulk.body.changed[0]).toMatchObject({ id: quiet.id, status: 'ghosted' });

    expect((await call('get_agenda')).body.goneQuiet).toEqual([]);
  });
});

describe('find_duplicate_groups', () => {
  it('groups exact repeats with summarized members', async () => {
    await createApplication(deps.repos, applicationInput());
    await createApplication(deps.repos, applicationInput({ appliedOn: '2026-04-01' }));

    const { body } = await call('find_duplicate_groups');
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].kind).toBe('exact');
    expect(body.groups[0].members[0]).not.toHaveProperty('titleKey');
  });
});

describe('people', () => {
  it('adds a person, finds them by employer, and names them in a duplicate check', async () => {
    const created = await call('create_contact', { name: 'Lina Ahmadi', companyName: 'Klarna AB', relationship: 'recruiter' });
    expect(created.body).toMatchObject({ name: 'Lina Ahmadi', company: 'Klarna AB', relationship: 'recruiter' });

    const listed = await call('list_contacts', { company: 'klarna' });
    expect(listed.body.map((c: { name: string }) => c.name)).toEqual(['Lina Ahmadi']);

    const check = await call('check_duplicate', { company: 'Klarna', title: 'Platform Engineer' });
    expect(check.body.contacts).toEqual([expect.objectContaining({ name: 'Lina Ahmadi' })]);
    expect(check.body.contacts[0]).not.toHaveProperty('nameKey');
  });

  it('logs a conversation, links the person, and puts them on the agenda when due', async () => {
    const application = await createApplication(deps.repos, applicationInput({ companyName: 'Klarna' }));
    const { body: contact } = await call('create_contact', { name: 'Johan Berg', companyName: 'Klarna' });

    const logged = await call('log_interaction', {
      contactId: contact.id,
      interaction: { summary: 'Asked for a referral', channel: 'email', reconnectOn: daysAgo(1) },
    });
    expect(logged.isError).toBe(false);

    const linked = await call('link_contact', {
      contactId: contact.id,
      link: { targetType: 'application', targetId: application.id, role: 'referral' },
    });
    expect(linked.body).toMatchObject({ role: 'referral' });

    const people = await call('list_linked_contacts', { targetType: 'application', targetId: application.id });
    expect(people.body[0]).toMatchObject({ name: 'Johan Berg', role: 'referral' });

    const agenda = await call('get_agenda');
    expect(agenda.body.reconnect.map((c: { name: string }) => c.name)).toEqual(['Johan Berg']);

    const detail = await call('get_contact', { id: contact.id });
    expect(detail.body.interactions[0].summary).toBe('Asked for a referral');
  });

  it('reports a bad link as an error result rather than failing the call', async () => {
    const { body: contact } = await call('create_contact', { name: 'Someone' });
    const result = await call('link_contact', {
      contactId: contact.id,
      link: { targetType: 'opening', targetId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(result.isError).toBe(true);
    expect(result.body).toMatch(/No such opening/);
  });

  it('finds people through search_jobtrack', async () => {
    await call('create_contact', { name: 'Sara Nystrom', companyName: 'Anthropic', headline: 'Staff Engineer' });
    await deps.search.rebuild();
    const { body } = await call('search_jobtrack', { q: 'Sara Nystrom', types: ['contact'] });
    expect(body.results[0]).toMatchObject({ type: 'contact', record: { name: 'Sara Nystrom' } });
  });

  it('renders the outreach prompt with its target', async () => {
    const rendered = await client.getPrompt({ name: 'draft_outreach', arguments: { target: 'Spotify' } });
    const message = rendered.messages[0]!.content as { type: string; text: string };
    expect(message.text).toContain('Spotify');
    expect(message.text).toContain('list_contacts');
  });
});

describe('profile and fit', () => {
  it('scores a lower-priority location for part of the location weight', async () => {
    await call('update_profile', {
      locationTiers: [
        { places: ['Stockholm'], share: 100 },
        { places: ['Uppsala'], share: 40 },
      ],
    });
    const { body } = await call('score_postings', { postings: [{ jobTitle: 'Backend Engineer', location: 'Uppsala' }] });
    expect(body.postings[0].fit.score).toBe(40);
  });

  it('updates part of the profile without touching the rest', async () => {
    await call('update_profile', { targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }] });
    const { body } = await call('update_profile', { salaryFloor: 700000 });
    expect(body).toMatchObject({ targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }], salaryFloor: 700000 });
    expect((await call('get_profile')).body.locationTiers).toEqual([{ places: ['Stockholm'], share: 100 }]);
  });

  it('ranks openings best first with readable reasons, and says when there is no profile', async () => {
    await call('create_opening', { companyName: 'Axis', jobTitle: 'Graphic Designer', location: 'Lund' });
    await call('create_opening', { companyName: 'Spotify', jobTitle: 'Senior Backend Engineer', location: 'Stockholm' });

    const before = await call('rank_openings');
    expect(before.body.hasProfile).toBe(false);

    await call('update_profile', { targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }] });
    const after = await call('rank_openings', { limit: 5 });
    expect(after.body.hasProfile).toBe(true);
    expect(after.body.openings[0]).toMatchObject({ company: 'Spotify', fit: { score: 100 } });
    expect(after.body.openings[0].fit.reasons).toContain('+ In Stockholm');

    const listed = await call('list_openings', { sort: 'fit', minFit: 90 });
    expect(listed.body.map((o: { company: string }) => o.company)).toEqual(['Spotify']);
  });

  it('scores postings best first without saving them', async () => {
    const before = await call('score_postings', { postings: [{ jobTitle: 'Backend Engineer' }] });
    expect(before.body).toEqual({ hasProfile: false, postings: [{ index: 0, jobTitle: 'Backend Engineer' }] });

    await call('update_profile', { targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }], excludeKeywords: ['crypto'] });
    const { body } = await call('score_postings', {
      postings: [
        { companyName: 'Axis', jobTitle: 'Graphic Designer', location: 'Lund' },
        { companyName: 'Coinly', jobTitle: 'Backend Engineer', location: 'Stockholm', description: 'Build our crypto exchange.' },
        { companyName: 'Spotify', jobTitle: 'Senior Backend Engineer', location: 'Stockholm' },
      ],
    });

    expect(body.hasProfile).toBe(true);
    expect(body.postings.map((p: { index: number }) => p.index)).toEqual([2, 1, 0]);
    expect(body.postings[0]).toMatchObject({ company: 'Spotify', fit: { score: 100 } });
    expect(body.postings[1].fit.reasons[0]).toMatch(/^- Mentions crypto/);
    expect((await call('list_openings')).body).toEqual([]);
  });

  it('carries fit on a captured draft and on a single opening', async () => {
    await call('update_profile', { targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }] });

    const captured = await call('capture_posting', { text: POSTING });
    expect(captured.body.saved).toBe(false);
    expect(captured.body.fit.score).toBeGreaterThan(50);

    const created = await call('create_opening', { companyName: 'Axis', jobTitle: 'Graphic Designer', location: 'Lund' });
    expect(created.body.fit.reasons).toContain('- Title is not one you are looking for');
    expect((await call('get_opening', { id: created.body.id })).body.fit).toEqual(created.body.fit);
  });
});

describe('job sources', () => {
  it('lists enabled sources in priority order, and replaces one list without touching the other', async () => {
    const initial = (await call('get_job_sources')).body;
    expect(initial.apis[0]).toMatchObject({ priority: 1, name: 'JobTech Jobsearch' });

    await call('update_job_sources', {
      platforms: [
        { name: 'Jobbsafari', url: 'https://jobbsafari.se/', enabled: false },
        { name: 'Platsbanken', url: 'https://arbetsformedlingen.se/platsbanken/' },
      ],
    });
    const enabled = (await call('get_job_sources')).body;
    expect(enabled.platforms).toEqual([
      { priority: 1, name: 'Platsbanken', url: 'https://arbetsformedlingen.se/platsbanken/', notes: null, enabled: true },
    ]);
    expect(enabled.apis).toEqual(initial.apis);
    expect((await call('get_job_sources', { includeDisabled: true })).body.platforms.map((p: { name: string }) => p.name)).toEqual([
      'Jobbsafari',
      'Platsbanken',
    ]);
  });
});
