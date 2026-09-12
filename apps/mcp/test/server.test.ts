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
    for (const name of ['capture_posting', 'get_agenda', 'bulk_change_status', 'find_duplicate_groups', 'list_openings']) {
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
