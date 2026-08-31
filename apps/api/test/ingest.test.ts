/**
 * The capture path, exercised through the real Fastify app rather than the services alone —
 * these are the first route-level tests in the suite, because two of the things worth
 * asserting here (the origin guard, the shape of an error the UI has to read) only exist at
 * the HTTP boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createOpening } from '../src/services/openings.service.js';
import { createApplication } from '../src/services/applications.service.js';
import { testDeps, applicationInput } from './support/repos.js';
import type { Deps } from '../src/deps.js';

const GREENHOUSE_PAGE = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@type": "JobPosting",
  "title": "Senior Backend Engineer",
  "hiringOrganization": { "name": "Acme Robotics" },
  "jobLocation": { "address": { "addressLocality": "Stockholm", "addressCountry": "SE" } }
}
</script></head><body></body></html>`;

let app: FastifyInstance;
let deps: Deps;

/** A `fetch` that answers one page, so no test in this file touches the network. */
function stubFetch(body: string, init: { status?: number } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status: init.status ?? 200 })),
  );
}

beforeEach(async () => {
  deps = testDeps();
  app = await buildApp(deps);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
});

describe('POST /api/ingest/url', () => {
  it('turns a JSON-LD posting into a draft without saving anything', async () => {
    stubFetch(GREENHOUSE_PAGE);

    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/url',
      payload: { url: 'https://boards.greenhouse.io/acme/jobs/7' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.draft.companyName).toBe('Acme Robotics');
    expect(body.draft.jobTitle).toBe('Senior Backend Engineer');
    expect(body.draft.sourceName).toBe('Greenhouse');
    expect(body.draft.jobUrl).toBe('https://boards.greenhouse.io/acme/jobs/7');
    expect(body.duplicate.verdict).toBe('none');

    expect(await deps.repos.jobOpenings.findMany({})).toHaveLength(0);
  });

  it('reports a blocking site as a 422 that names the way out', async () => {
    stubFetch('<html>Sorry</html>', { status: 999 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/url',
      payload: { url: 'https://www.linkedin.com/jobs/view/12345' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('ingest_blocked');
    expect(response.json().message).toMatch(/extension|paste/i);
  });

  it('says so when a page carries no structured job data', async () => {
    stubFetch('<html><body><h1>Careers</h1></body></html>');

    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/url',
      payload: { url: 'https://example.com/careers' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toMatch(/paste the posting text/i);
  });

  it('rejects a non-http scheme', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/url',
      payload: { url: 'file:///etc/passwd' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/ingest/text', () => {
  it('parses pasted text and never touches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/text',
      payload: {
        text: 'Backend Engineer at Spotify\nStockholm — hybrid',
        url: 'https://www.linkedin.com/jobs/view/1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = response.json();
    expect(body.draft.companyName).toBe('Spotify');
    expect(body.draft.sourceName).toBe('LinkedIn');
  });

  it('carries the duplicate verdict for a company already applied to', async () => {
    await createApplication(deps.repos, applicationInput({ companyName: 'Spotify' }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/text',
      payload: { text: 'Backend Engineer at Spotify' },
    });

    const body = response.json();
    expect(body.duplicate.verdict).toBe('exact');
    expect(body.duplicate.priorCount).toBe(1);
  });
});

/** The two fields that decide whether two clips are the same posting. */
const clipped = { companyName: 'Spotify', jobTitle: 'Backend Engineer' };

/** That same posting, already in the database — spelled out the way `createOpening` wants it. */
const alreadySaved = (jobUrl: string) => ({
  ...clipped,
  jobUrl,
  location: null,
  workMode: 'unspecified',
  sourceName: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  notes: null,
});

describe('POST /api/ingest/clip', () => {
  it('creates exactly one opening and reports what it collided with', async () => {
    await createApplication(deps.repos, applicationInput({ companyName: 'Spotify' }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/clip',
      payload: {
        companyName: 'Spotify',
        jobTitle: 'Platform Engineer',
        jobUrl: 'https://jobs.example.com/1',
        location: 'Stockholm',
        workMode: 'remote',
        sourceName: 'LinkedIn',
        notes: 'Looks interesting',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.opening.company.name).toBe('Spotify');
    expect(body.opening.workMode).toBe('remote');
    // A different role at a company you have applied to: worth saying, not worth blocking.
    expect(body.duplicate.verdict).toBe('company');
    expect(await deps.repos.jobOpenings.findMany({})).toHaveLength(1);
  });

  it('refuses a posting it has already saved, and names the one it has', async () => {
    // Pressing Save twice on one tab is the case: the second press used to write a second
    // identical opening and say nothing about it.
    await createOpening(deps.repos, alreadySaved('https://jobs.example.com/spotify/7'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/clip',
      payload: { ...clipped, jobUrl: 'https://www.jobs.example.com/spotify/7/?utm_source=mail' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('duplicate_opening');
    expect(response.json().message).toMatch(/already saved/i);
    expect(await deps.repos.jobOpenings.findMany({})).toHaveLength(1);
  });

  it('saves a different posting at a company already captured from', async () => {
    await createOpening(deps.repos, alreadySaved('https://jobs.example.com/spotify/7'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/clip',
      payload: { ...clipped, jobUrl: 'https://jobs.example.com/spotify/8' },
    });

    expect(response.statusCode).toBe(201);
    expect(await deps.repos.jobOpenings.findMany({})).toHaveLength(2);
  });

  it('refuses a draft with no company, which nothing could be resolved from', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ingest/clip',
      payload: { companyName: '', jobTitle: 'Backend Engineer' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('validation_error');
  });
});
