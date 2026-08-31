import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import { getDashboard, STALE_AFTER_DAYS } from '../src/services/dashboard.service.js';
import { changeStatus, createApplication } from '../src/services/applications.service.js';
import { todayDateOnly } from '@jobtrack/shared';
import { applicationInput, createMemoryRepos } from './support/repos.js';

let repos: RepoBundle;

beforeEach(() => {
  repos = createMemoryRepos();
});

/** `n` days before today, as YYYY-MM-DD. */
function daysAgo(n: number): string {
  const date = new Date(`${todayDateOnly()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

const stageCount = (funnel: { status: string; count: number }[], status: string): number =>
  funnel.find((stage) => stage.status === status)?.count ?? 0;

describe('the funnel', () => {
  it('counts what an application reached, not only where it ended up', async () => {
    const application = await createApplication(repos, applicationInput());
    await changeStatus(repos, application.id, { status: 'screening' });
    await changeStatus(repos, application.id, { status: 'interview' });
    await changeStatus(repos, application.id, { status: 'rejected' });

    const { stats, funnel } = await getDashboard(repos);

    // The misleading version of this chart: current status alone says interview = 0.
    expect(stats.byStatus.interview ?? 0).toBe(0);
    expect(stageCount(funnel, 'applied')).toBe(1);
    expect(stageCount(funnel, 'screening')).toBe(1);
    expect(stageCount(funnel, 'interview')).toBe(1);
    expect(stageCount(funnel, 'offer')).toBe(0);
  });

  it('reports conversion between consecutive stages', async () => {
    for (let i = 0; i < 4; i += 1) {
      await createApplication(repos, applicationInput({ jobTitle: `Role ${i}` }));
    }
    const rows = await repos.applications.findMany({});
    await changeStatus(repos, rows[0]!.id, { status: 'screening' });
    await changeStatus(repos, rows[1]!.id, { status: 'screening' });

    const { funnel } = await getDashboard(repos);
    expect(funnel[0]!.conversion).toBeNull();
    expect(funnel[1]!.count).toBe(2);
    expect(funnel[1]!.conversion).toBeCloseTo(0.5);
  });

  it('does not invent stages an imported application never recorded', async () => {
    await createApplication(repos, applicationInput({ status: 'interview' }));

    const { funnel } = await getDashboard(repos);
    expect(stageCount(funnel, 'interview')).toBe(1);
    // Nothing says this one was ever screened, so nothing claims it was.
    expect(stageCount(funnel, 'screening')).toBe(0);
  });

  it('leaves every stage at zero for an empty database', async () => {
    const { funnel } = await getDashboard(repos);
    expect(funnel).toHaveLength(4);
    expect(funnel.every((stage) => stage.count === 0)).toBe(true);
    expect(funnel[1]!.conversion).toBeNull();
  });
});

describe('volume', () => {
  it('covers 24 months ending this month, including the empty ones', async () => {
    await createApplication(repos, applicationInput({ appliedOn: todayDateOnly() }));

    const { volume } = await getDashboard(repos);
    expect(volume).toHaveLength(24);

    const last = volume.at(-1)!;
    const now = new Date(`${todayDateOnly()}T00:00:00Z`);
    expect(last.year).toBe(now.getUTCFullYear());
    expect(last.month).toBe(now.getUTCMonth() + 1);
    expect(last.count).toBe(1);
  });

  it('rolls the year over correctly rather than producing month 0', async () => {
    const { volume } = await getDashboard(repos);
    expect(volume.every((point) => point.month >= 1 && point.month <= 12)).toBe(true);
    // 24 consecutive months means exactly two of each month number.
    const counts = new Map<number, number>();
    for (const point of volume) counts.set(point.month, (counts.get(point.month) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
  });
});

describe('going quiet', () => {
  it('lists a live application with no movement and no follow-up date', async () => {
    await createApplication(
      repos,
      applicationInput({ appliedOn: daysAgo(STALE_AFTER_DAYS + 9), followUpOn: null }),
    );

    const { stale } = await getDashboard(repos);
    expect(stale).toHaveLength(1);
    expect(stale[0]!.silentDays).toBe(STALE_AFTER_DAYS + 9);
    expect(stale[0]!.silentSince).toBe(daysAgo(STALE_AFTER_DAYS + 9));
  });

  it('leaves alone anything with a follow-up date — that is the other list', async () => {
    await createApplication(
      repos,
      applicationInput({ appliedOn: daysAgo(60), followUpOn: daysAgo(1) }),
    );

    const { stale } = await getDashboard(repos);
    expect(stale).toHaveLength(0);
  });

  it('counts silence from the last status change, not from the application date', async () => {
    const application = await createApplication(repos, applicationInput({ appliedOn: daysAgo(90) }));
    await changeStatus(repos, application.id, { status: 'screening', occurredOn: daysAgo(2) });

    const { stale } = await getDashboard(repos);
    expect(stale).toHaveLength(0);
  });

  it('ignores concluded applications — silence there is the end of the story', async () => {
    const application = await createApplication(repos, applicationInput({ appliedOn: daysAgo(120) }));
    await changeStatus(repos, application.id, { status: 'rejected', occurredOn: daysAgo(100) });

    const { stale } = await getDashboard(repos);
    expect(stale).toHaveLength(0);
  });

  it('puts the longest silence first', async () => {
    await createApplication(repos, applicationInput({ jobTitle: 'Newer', appliedOn: daysAgo(30) }));
    await createApplication(repos, applicationInput({ jobTitle: 'Older', appliedOn: daysAgo(75) }));

    const { stale } = await getDashboard(repos);
    expect(stale.map((entry) => entry.jobTitle)).toEqual(['Older', 'Newer']);
  });
});
