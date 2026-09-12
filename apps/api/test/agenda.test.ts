import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { todayDateOnly } from '@jobtrack/shared';
import { buildApp } from '../src/app.js';
import type { Deps } from '../src/deps.js';
import { OPENING_IDLE_DAYS, getAgenda } from '../src/services/agenda.service.js';
import { STALE_AFTER_DAYS } from '../src/services/dashboard.service.js';
import { createApplication } from '../src/services/applications.service.js';
import { createOpening, updateOpening } from '../src/services/openings.service.js';
import { applicationInput, openingInput, testDeps } from './support/repos.js';

/** `n` days before today, as YYYY-MM-DD. */
function daysAgo(n: number): string {
  const date = new Date(`${todayDateOnly()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

let deps: Deps;

beforeEach(() => {
  deps = testDeps();
});

describe('getAgenda', () => {
  it('is empty for an empty database', async () => {
    const agenda = await getAgenda(deps.repos);
    expect(agenda).toEqual({ today: todayDateOnly(), followUps: [], goneQuiet: [], idleOpenings: [], reconnect: [] });
  });

  it('lists due follow-ups and quiet applications, the same lists the dashboard shows', async () => {
    await createApplication(deps.repos, applicationInput({ jobTitle: 'Due', appliedOn: daysAgo(10), followUpOn: daysAgo(1) }));
    await createApplication(deps.repos, applicationInput({ jobTitle: 'Later', appliedOn: daysAgo(10), followUpOn: daysAgo(-5) }));
    await createApplication(deps.repos, applicationInput({ jobTitle: 'Quiet', appliedOn: daysAgo(STALE_AFTER_DAYS + 3) }));

    const agenda = await getAgenda(deps.repos);
    expect(agenda.followUps.map((a) => a.jobTitle)).toEqual(['Due']);
    expect(agenda.goneQuiet.map((a) => a.jobTitle)).toEqual(['Quiet']);
    expect(agenda.goneQuiet[0]!.silentDays).toBe(STALE_AFTER_DAYS + 3);
  });

  it('lists openings left sitting, oldest first, and leaves fresh and archived ones out', async () => {
    await createOpening(deps.repos, openingInput({ jobTitle: 'Fresh', savedOn: daysAgo(2) }));
    await createOpening(deps.repos, openingInput({ jobTitle: 'Old', savedOn: daysAgo(OPENING_IDLE_DAYS) }));
    await createOpening(deps.repos, openingInput({ jobTitle: 'Older', savedOn: daysAgo(OPENING_IDLE_DAYS + 30) }));
    const archived = await createOpening(deps.repos, openingInput({ jobTitle: 'Archived', savedOn: daysAgo(90) }));
    await updateOpening(deps.repos, archived.id, { archived: true });

    const agenda = await getAgenda(deps.repos);
    expect(agenda.idleOpenings.map((o) => [o.jobTitle, o.idleDays])).toEqual([
      ['Older', OPENING_IDLE_DAYS + 30],
      ['Old', OPENING_IDLE_DAYS],
    ]);
  });
});

describe('agenda and openings routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(deps);
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the agenda', async () => {
    await createApplication(deps.repos, applicationInput({ appliedOn: daysAgo(40) }));
    const response = await app.inject({ method: 'GET', url: '/api/agenda' });
    expect(response.statusCode).toBe(200);
    expect(response.json().goneQuiet).toHaveLength(1);
  });

  it('filters openings by location and keeps the archived=true switch working', async () => {
    await createOpening(deps.repos, openingInput({ jobTitle: 'A', location: 'Stockholm, Sweden' }));
    await createOpening(deps.repos, openingInput({ jobTitle: 'B', location: 'Lund' }));
    const gone = await createOpening(deps.repos, openingInput({ jobTitle: 'C', location: 'Lund' }));
    await updateOpening(deps.repos, gone.id, { archived: true });

    const stockholm = await app.inject({
      method: 'GET',
      url: `/api/openings?location=${encodeURIComponent('Stockholm, Sweden|Umeå')}`,
    });
    expect(stockholm.json().openings.map((o: { jobTitle: string }) => o.jobTitle)).toEqual(['A']);

    const lund = await app.inject({ method: 'GET', url: '/api/openings?location=lund&archived=true' });
    expect(lund.json().openings.map((o: { jobTitle: string }) => o.jobTitle).sort()).toEqual(['B', 'C']);
  });
});
