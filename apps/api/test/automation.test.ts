import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDays, todayDateOnly } from '@jobtrack/shared';
import { buildApp } from '../src/app.js';
import type { Deps } from '../src/deps.js';
import type { RepoBundle } from '../src/db/repos.js';
import { changeStatus, createApplication, getApplication } from '../src/services/applications.service.js';
import { convertOpening, createOpening } from '../src/services/openings.service.js';
import {
  addKnownLocation,
  getJobSources,
  getKnownLocations,
  getProfile,
  getRules,
  removeKnownLocation,
  renameKnownLocation,
  updateJobSources,
  updateProfile,
  updateRules,
} from '../src/services/settings.service.js';
import { autoGhostComment, runAutoGhost } from '../src/services/rules.service.js';
import { rankOpenings, rankPostings } from '../src/services/fit.service.js';
import { startBackgroundJobs } from '../src/jobs/scheduler.js';
import { createSnapshot, currentCounts, isEmpty, restoreSnapshot, validateSnapshot } from '../src/backup/snapshot.js';
import { applicationInput, openingInput, testDeps } from './support/repos.js';

let deps: Deps;
let repos: RepoBundle;
const today = todayDateOnly();

beforeEach(() => {
  deps = testDeps();
  repos = deps.repos as RepoBundle;
});

describe('settings', () => {
  it('starts empty, with every rule off', async () => {
    expect(await getProfile(repos)).toMatchObject({ summary: null, targetTitles: [], salaryFloor: null });
    expect(await getRules(repos)).toEqual({ defaultFollowUpDays: null, autoGhostAfterDays: null });
  });

  it('merges a partial profile update into what is stored', async () => {
    await updateProfile(repos, { targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }] });
    const next = await updateProfile(repos, { salaryFloor: 700000 });
    expect(next).toMatchObject({ targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }], salaryFloor: 700000 });
    // One profile document, plus the known locations its ranked places joined.
    expect(await repos.appSettings.count()).toBe(2);
  });

  it('reads a stored document that no longer fits the schema as unset, rather than failing', async () => {
    await repos.appSettings.create({ settingKey: 'rules', value: { autoGhostAfterDays: 'soon' } });
    expect(await getRules(repos)).toEqual({ defaultFollowUpDays: null, autoGhostAfterDays: null });
  });

  it('reads a profile saved with a flat location list as one priority level', async () => {
    await repos.appSettings.create({ settingKey: 'profile', value: { targetTitles: ['Backend Engineer'], locations: ['Stockholm'] } });
    expect((await getProfile(repos)).locationTiers).toEqual([{ places: ['Stockholm'], share: 100 }]);
  });

  it('starts job sources from the defaults and replaces one list without touching the other', async () => {
    const initial = await getJobSources(repos);
    expect(initial.apis.map((source) => source.name)).toEqual(['JobTech Jobsearch']);
    const next = await updateJobSources(repos, { platforms: [{ name: 'Jobbsafari', url: null, notes: null, enabled: false }] });
    expect(next.platforms).toEqual([{ name: 'Jobbsafari', url: null, notes: null, enabled: false }]);
    expect(next.apis).toEqual(initial.apis);
  });

  it('knows every ranked place, and places added ahead of ranking them', async () => {
    await repos.appSettings.create({ settingKey: 'profile', value: { locations: ['Stockholm'] } });
    expect((await getKnownLocations(repos)).places).toEqual(['Stockholm']);
    await addKnownLocation(repos, 'Lund');
    await updateProfile(repos, { locationTiers: [{ places: ['Stockholm', 'Göteborg'], share: 100 }] });
    expect((await getKnownLocations(repos)).places).toEqual(['Göteborg', 'Lund', 'Stockholm']);
  });

  it('fixes a misspelled place in the known list and in the profile at once', async () => {
    await updateProfile(repos, { locationTiers: [{ places: ['Stockholm'], share: 100 }, { places: ['Upsala'], share: 60 }] });
    const { known, profile } = await renameKnownLocation(repos, 'Upsala', 'Uppsala');
    expect(known.places).toEqual(['Stockholm', 'Uppsala']);
    expect(profile.locationTiers).toEqual([{ places: ['Stockholm'], share: 100 }, { places: ['Uppsala'], share: 60 }]);
    expect(await getProfile(repos)).toEqual(profile);
  });

  it('merges a rename onto a ranked place into the higher level', async () => {
    await updateProfile(repos, { locationTiers: [{ places: ['Stockholm'], share: 100 }, { places: ['Sthlm'], share: 60 }] });
    const { known, profile } = await renameKnownLocation(repos, 'Sthlm', 'stockholm');
    expect(known.places).toEqual(['stockholm']);
    expect(profile.locationTiers).toEqual([{ places: ['Stockholm'], share: 100 }]);
  });

  it('removes a place from the known list and from its level, dropping a level left empty', async () => {
    await updateProfile(repos, { locationTiers: [{ places: ['Stockholm'], share: 100 }, { places: ['Malmö'], share: 60 }] });
    const { known, profile } = await removeKnownLocation(repos, 'malmo');
    expect(known.places).toEqual(['Stockholm']);
    expect(profile.locationTiers).toEqual([{ places: ['Stockholm'], share: 100 }]);
  });

  it('does not count settings when deciding whether the database is empty', async () => {
    await updateProfile(repos, { targetTitles: ['Backend Engineer'] });
    expect(isEmpty(await currentCounts(repos))).toBe(true);
  });

  it('backs settings up with everything else', async () => {
    await updateProfile(repos, { summary: 'Kotlin and payments' });
    const snapshot = await createSnapshot(repos);
    await restoreSnapshot(repos, deps.search, validateSnapshot(JSON.parse(JSON.stringify(snapshot))));
    expect((await getProfile(repos)).summary).toBe('Kotlin and payments');
  });
});

describe('the default follow-up rule', () => {
  it('leaves the date blank while the rule is off', async () => {
    const created = await createApplication(repos, applicationInput({ appliedOn: today }));
    expect(created.followUpOn).toBeNull();
  });

  it('dates a new application, but never overrides a date that was given or dates old history', async () => {
    await updateRules(repos, { defaultFollowUpDays: 7 });

    expect((await createApplication(repos, applicationInput({ jobTitle: 'New', appliedOn: today }))).followUpOn).toBe(
      addDays(today, 7),
    );
    expect(
      (await createApplication(repos, applicationInput({ jobTitle: 'Given', appliedOn: today, followUpOn: addDays(today, 2) })))
        .followUpOn,
    ).toBe(addDays(today, 2));
    expect((await createApplication(repos, applicationInput({ jobTitle: 'Old', appliedOn: '2024-01-10' }))).followUpOn).toBeNull();
  });

  it('applies to an opening converted into an application', async () => {
    await updateRules(repos, { defaultFollowUpDays: 10 });
    const opening = await createOpening(repos, openingInput());
    const application = await convertOpening(repos, opening.id, { appliedOn: today });
    expect(application!.followUpOn).toBe(addDays(today, 10));
  });
});

describe('the auto-ghost rule', () => {
  async function silentFor(days: number, over: Record<string, unknown> = {}) {
    return createApplication(repos, applicationInput({ jobTitle: `Silent ${days}`, appliedOn: addDays(today, -days), ...over }));
  }

  it('does nothing while the rule is off', async () => {
    await silentFor(200);
    expect(await runAutoGhost(repos)).toEqual({ afterDays: null, candidates: [], changed: 0 });
  });

  it('previews without changing anything, then ghosts with a note in the history', async () => {
    await updateRules(repos, { autoGhostAfterDays: 30 });
    const old = await silentFor(40);
    await silentFor(10);

    const preview = await runAutoGhost(repos, { dryRun: true });
    expect(preview.candidates.map((c) => [c.id, c.silentDays])).toEqual([[old.id, 40]]);
    expect((await getApplication(repos, old.id))!.status).toBe('applied');

    const run = await runAutoGhost(repos);
    expect(run.changed).toBe(1);
    const detail = await getApplication(repos, old.id);
    expect(detail!.status).toBe('ghosted');
    expect(detail!.statusEvents.at(-1)).toMatchObject({ toStatus: 'ghosted', comment: autoGhostComment(30) });
  });

  it('is safe to run again and again', async () => {
    await updateRules(repos, { autoGhostAfterDays: 30 });
    const old = await silentFor(40);
    await runAutoGhost(repos);
    expect((await runAutoGhost(repos)).changed).toBe(0);
    expect((await getApplication(repos, old.id))!.statusEvents).toHaveLength(2);
  });

  it('counts silence from the last status change, and leaves interviews and planned follow-ups alone', async () => {
    await updateRules(repos, { autoGhostAfterDays: 30 });
    const moved = await silentFor(90);
    await changeStatus(repos, moved.id, { status: 'screening', occurredOn: addDays(today, -5), comment: null });
    const interviewing = await silentFor(90);
    await changeStatus(repos, interviewing.id, { status: 'interview', occurredOn: addDays(today, -60), comment: null });
    await silentFor(90, { followUpOn: addDays(today, 3) });

    expect((await runAutoGhost(repos, { dryRun: true })).candidates).toEqual([]);
  });

  it('runs from the background jobs, and marks search stale when it changed something', async () => {
    await updateRules(repos, { autoGhostAfterDays: 30 });
    const old = await silentFor(45);
    const messages: string[] = [];
    const jobs = startBackgroundJobs(deps, { log: (message) => messages.push(message), initialDelayMs: 60_000 });
    try {
      await jobs.runNow();
    } finally {
      jobs.stop();
    }
    expect((await getApplication(repos, old.id))!.status).toBe('ghosted');
    expect(messages).toEqual(['auto-ghost marked 1 application ghosted after 30 silent days']);
  });
});

describe('ranking openings by fit', () => {
  beforeEach(async () => {
    await createOpening(repos, openingInput({ jobTitle: 'Graphic Designer', location: 'Malmö', workMode: 'onsite', savedOn: addDays(today, -1) }));
    await createOpening(repos, openingInput({ jobTitle: 'Senior Backend Engineer', location: 'Stockholm', savedOn: addDays(today, -3) }));
    await createOpening(repos, openingInput({ jobTitle: 'Platform Engineer', location: 'Remote', workMode: 'remote', savedOn: addDays(today, -2) }));
  });

  it('keeps every fit null, and the usual order, without a profile', async () => {
    const openings = await rankOpenings(repos, deps.search, { sort: 'fit', minFit: 90 });
    expect(openings.map((o) => o.fit)).toEqual([null, null, null]);
    expect(openings.map((o) => o.jobTitle)).toEqual(['Graphic Designer', 'Platform Engineer', 'Senior Backend Engineer']);
  });

  it('scores every opening, sorts best first, and drops weak matches', async () => {
    await updateProfile(repos, { targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }], workModes: ['hybrid', 'remote'] });

    const ranked = await rankOpenings(repos, null, { sort: 'fit' });
    expect(ranked[0]).toMatchObject({ jobTitle: 'Senior Backend Engineer', fit: { score: 100 } });
    expect(ranked.at(-1)!.jobTitle).toBe('Graphic Designer');

    const strong = await rankOpenings(repos, null, { minFit: 90 });
    expect(strong.map((o) => o.jobTitle)).toEqual(['Senior Backend Engineer']);
  });

  it('compares the profile summary by meaning when the index can', async () => {
    await updateProfile(repos, { summary: 'backend engineer building payment systems' });
    const ranked = await rankOpenings(repos, deps.search, { sort: 'fit' });
    expect(ranked.every((o) => o.fit?.semanticUsed)).toBe(true);
    expect(ranked[0]!.jobTitle).toBe('Senior Backend Engineer');
  });
});

describe('scoring postings that are not saved', () => {
  const posting = (over: Record<string, unknown>) => ({
    companyName: null,
    location: null,
    workMode: 'unspecified' as const,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    description: null,
    jobTitle: 'Backend Engineer',
    ...over,
  });

  it('has no scores without a profile', async () => {
    const result = await rankPostings(repos, deps.search, [posting({})]);
    expect(result).toEqual({
      hasProfile: false,
      summaryCompared: false,
      postings: [{ index: 0, companyName: null, jobTitle: 'Backend Engineer', fit: null }],
    });
  });

  it('ranks best first, keeps each input position, and reads the description', async () => {
    await updateProfile(repos, { targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }], excludeKeywords: ['crypto'] });
    const result = await rankPostings(repos, deps.search, [
      posting({ jobTitle: 'Graphic Designer', location: 'Malmö' }),
      posting({ location: 'Stockholm', description: 'Build our crypto exchange.' }),
      posting({ companyName: 'Spotify', location: 'Stockholm' }),
    ]);

    expect(result.hasProfile).toBe(true);
    expect(result.postings.map((p) => p.index)).toEqual([2, 1, 0]);
    expect(result.postings[0]!.fit!.score).toBe(100);
    expect(result.postings[1]!.fit!.reasons[0]!.factor).toBe('excluded');
    expect(await repos.jobOpenings.count()).toBe(0);
  });
});

describe('over HTTP', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(deps);
  });

  afterEach(async () => {
    await app.close();
  });

  it('saves a partial profile without wiping the rest, and ranks openings with it', async () => {
    await app.inject({ method: 'PUT', url: '/api/profile', payload: { targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }] } });
    const saved = await app.inject({ method: 'PUT', url: '/api/profile', payload: { salaryFloor: 650000 } });
    expect(saved.json()).toMatchObject({ targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }], salaryFloor: 650000 });

    await createOpening(repos, openingInput({ jobTitle: 'Backend Engineer' }));
    const openings = await app.inject({ method: 'GET', url: '/api/openings?sort=fit' });
    expect(openings.json().openings[0].fit.score).toBeGreaterThan(0);
  });

  it('scores postings without saving them, and puts fit on a single opening', async () => {
    const noProfile = await app.inject({ method: 'POST', url: '/api/openings/score', payload: { postings: [{ jobTitle: 'Backend Engineer' }] } });
    expect(noProfile.json()).toMatchObject({ hasProfile: false, postings: [{ index: 0, fit: null }] });

    await app.inject({ method: 'PUT', url: '/api/profile', payload: { targetTitles: ['Backend Engineer'], locationTiers: [{ places: ['Stockholm'], share: 100 }] } });
    const scored = await app.inject({
      method: 'POST',
      url: '/api/openings/score',
      payload: { postings: [{ jobTitle: 'Graphic Designer' }, { companyName: 'Spotify', jobTitle: 'Backend Engineer', location: 'Stockholm' }] },
    });
    expect(scored.statusCode).toBe(200);
    expect(scored.json().postings[0]).toMatchObject({ index: 1, companyName: 'Spotify', fit: { score: 100 } });
    expect((await app.inject({ method: 'GET', url: '/api/openings' })).json().openings).toEqual([]);

    expect((await app.inject({ method: 'POST', url: '/api/openings/score', payload: { postings: [] } })).statusCode).toBe(400);

    const created = await app.inject({ method: 'POST', url: '/api/openings', payload: { companyName: 'Axis', jobTitle: 'Backend Engineer', location: 'Lund' } });
    expect(created.statusCode).toBe(201);
    expect(created.json().fit.score).toBeGreaterThan(0);
    const fetched = await app.inject({ method: 'GET', url: `/api/openings/${created.json().id}` });
    expect(fetched.json().fit).toEqual(created.json().fit);
  });

  it('refuses a profile with a place in two levels, and renames known locations', async () => {
    const twice = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      payload: { locationTiers: [{ places: ['Stockholm'], share: 100 }, { places: ['Stockholm'], share: 50 }] },
    });
    expect(twice.statusCode).toBe(400);
    await app.inject({ method: 'POST', url: '/api/known-locations', payload: { place: 'Upsala' } });
    const renamed = await app.inject({ method: 'POST', url: '/api/known-locations/rename', payload: { from: 'Upsala', to: 'Uppsala' } });
    expect(renamed.json().known.places).toEqual(['Uppsala']);
    const removed = await app.inject({ method: 'POST', url: '/api/known-locations/remove', payload: { place: 'Uppsala' } });
    expect(removed.json().known.places).toEqual([]);
  });

  it('reads and saves job sources', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/job-sources' })).json().platforms.length).toBeGreaterThan(0);
    const saved = await app.inject({ method: 'PUT', url: '/api/job-sources', payload: { apis: [] } });
    expect(saved.json().apis).toEqual([]);
    expect((await app.inject({ method: 'PUT', url: '/api/job-sources', payload: { apis: [{ name: '' }] } })).statusCode).toBe(400);
  });

  it('rejects a rule outside its range, and previews and runs auto-ghost', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/rules', payload: { autoGhostAfterDays: 3 } })).statusCode).toBe(400);

    await app.inject({ method: 'PUT', url: '/api/rules', payload: { autoGhostAfterDays: 21 } });
    await createApplication(repos, applicationInput({ appliedOn: addDays(today, -30) }));

    const preview = await app.inject({ method: 'GET', url: '/api/rules/auto-ghost' });
    expect(preview.json()).toMatchObject({ afterDays: 21, changed: 0 });
    expect(preview.json().candidates).toHaveLength(1);

    const run = await app.inject({ method: 'POST', url: '/api/rules/auto-ghost/run' });
    expect(run.json().changed).toBe(1);
  });
});
