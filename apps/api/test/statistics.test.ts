/**
 * The statistics route over the real Fastify app: the query is validated, archived
 * applications count unless asked otherwise, and a converted opening is dated by the
 * application it became. The counting rules themselves are tested in the shared package.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createApplication, patchApplication } from '../src/services/applications.service.js';
import { convertOpening, createOpening } from '../src/services/openings.service.js';
import { getStatistics } from '../src/services/statistics.service.js';
import type { Deps } from '../src/deps.js';
import { applicationInput, openingInput, testDeps } from './support/repos.js';

let app: FastifyInstance;
let deps: Deps;

beforeEach(async () => {
  deps = testDeps();
  app = await buildApp(deps);
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/statistics', () => {
  it('counts a range and lists its applications newest first', async () => {
    await createApplication(deps.repos, applicationInput({ appliedOn: '2026-09-14', jobTitle: 'Backend Engineer' }));
    await createApplication(deps.repos, applicationInput({ appliedOn: '2026-09-15', companyName: 'Axis', jobTitle: 'Firmware', location: 'Lund' }));
    await createApplication(deps.repos, applicationInput({ appliedOn: '2026-08-01', jobTitle: 'Old one' }));

    const response = await app.inject({ method: 'GET', url: '/api/statistics?from=2026-09-14&to=2026-09-20' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.totals.applications).toBe(2);
    expect(body.range.granularity).toBe('day');
    expect(body.applications.map((row: { jobTitle: string }) => row.jobTitle)).toEqual(['Firmware', 'Backend Engineer']);
    expect(body.applications[0].company.name).toBe('Axis');
    expect(body.byLocation.map((row: { label: string }) => row.label).sort()).toEqual(['Lund', 'Stockholm']);
  });

  it('rejects a range that ends before it starts', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/statistics?from=2026-09-20&to=2026-09-14' });
    expect(response.statusCode).toBe(400);
  });
});

describe('getStatistics', () => {
  it('counts archived applications unless told not to', async () => {
    const archived = await createApplication(deps.repos, applicationInput({ appliedOn: '2026-09-14' }));
    await patchApplication(deps.repos, archived.id, { archived: true });
    const query = { from: '2026-09-01', to: '2026-09-30' };

    expect((await getStatistics(deps.repos, { ...query, archived: 'all' }, '2026-09-15')).totals.applications).toBe(1);
    expect((await getStatistics(deps.repos, { ...query, archived: 'false' }, '2026-09-15')).totals.applications).toBe(0);
  });

  it('dates a converted opening by the application it became', async () => {
    const opening = await createOpening(deps.repos, openingInput({ savedOn: '2026-08-20' }));
    await convertOpening(deps.repos, opening.id, { appliedOn: '2026-09-14' });

    const stats = await getStatistics(deps.repos, { from: '2026-09-01', to: '2026-09-30', archived: 'all' }, '2026-09-15');
    expect(stats.totals.openingsSaved).toBe(0);
    expect(stats.totals.openingsConverted).toBe(1);
  });
});
