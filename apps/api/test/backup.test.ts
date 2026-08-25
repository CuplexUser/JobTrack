import { beforeEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '../src/db/repos.js';
import { createApplication } from '../src/services/applications.service.js';
import { createNote } from '../src/services/notes.service.js';
import { createOpening } from '../src/services/openings.service.js';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  clearDatabase,
  countRows,
  createSnapshot,
  currentCounts,
  isEmpty,
  restoreSnapshot,
  validateSnapshot,
} from '../src/backup/snapshot.js';
import { decodeSnapshot, encodeSnapshot } from '../src/backup/codec.js';
import { applicationInput, createMemoryRepos, createTestSearch, openingInput } from './support/repos.js';
import type { SearchIndex } from '../src/search/index.js';

let repos: RepoBundle;
let search: SearchIndex;

beforeEach(() => {
  repos = createMemoryRepos();
  search = createTestSearch(repos);
});

async function seed() {
  const app1 = await createApplication(
    repos,
    applicationInput({ companyName: 'Spotify', jobTitle: 'Backend Engineer', tags: ['music', 'dream-job'] }),
  );
  const app2 = await createApplication(
    repos,
    applicationInput({ companyName: 'Klarna', jobTitle: 'Platform Engineer', tags: ['fintech'] }),
  );
  const note = await createNote(repos, {
    title: 'Reminder',
    body: 'Follow up next week.',
    targetType: 'application',
    targetId: app1.id,
    pinned: true,
  });
  const opening = await createOpening(repos, openingInput({ companyName: 'Tink', jobTitle: 'Staff Engineer' }));
  return { app1, app2, note, opening };
}

describe('createSnapshot / restoreSnapshot', () => {
  it('round-trips every table, ids included, so relations survive', async () => {
    const { app1, note, opening } = await seed();

    const snapshot = await createSnapshot(repos);

    expect(snapshot.format).toBe(BACKUP_FORMAT);
    expect(snapshot.version).toBe(BACKUP_VERSION);
    expect(snapshot.tables.applications).toHaveLength(2);
    expect(snapshot.tables.tags).toHaveLength(3);
    expect(snapshot.tables.tagLinks).toHaveLength(3);
    expect(snapshot.tables.notes).toHaveLength(1);
    expect(snapshot.tables.jobOpenings).toHaveLength(1);
    // The status event each createApplication writes on the way in.
    expect(snapshot.tables.statusEvents).toHaveLength(2);

    // Prove restore *replaces* rather than merges: add something the snapshot doesn't know about.
    await createNote(repos, { title: 'Junk', body: 'Should not survive restore', targetType: 'standalone', targetId: null, pinned: false });
    expect(await repos.notes.count()).toBe(2);

    const result = await restoreSnapshot(repos, search, snapshot);
    expect(result.counts.applications).toBe(2);
    expect(result.counts.notes).toBe(1);

    // The junk note is gone — restore wiped the table before recreating it from the snapshot.
    const notesAfter = await repos.notes.findMany({});
    expect(notesAfter).toHaveLength(1);
    expect(notesAfter[0]!.id).toBe(note.id);
    expect(notesAfter[0]!.body).toBe('Follow up next week.');

    // Ids are preserved, which is what keeps the note's targetId pointing at the right application.
    const restoredApp = await repos.applications.findById(app1.id);
    expect(restoredApp).not.toBeNull();
    expect(restoredApp!.jobTitle).toBe('Backend Engineer');
    // Business dates round-trip exactly...
    expect(restoredApp!.appliedOn.toISOString().slice(0, 10)).toBe(applicationInput().appliedOn);

    const restoredOpening = await repos.jobOpenings.findById(opening.id);
    expect(restoredOpening?.jobTitle).toBe('Staff Engineer');
  });

  it('resets createdAt/updatedAt to the restore time — a documented repolayer limitation, not a bug', async () => {
    const { app1 } = await seed();
    const before = await repos.applications.findById(app1.id);

    // Backdate the snapshot's copy so a real difference would be visible if it *did* round-trip.
    const snapshot = await createSnapshot(repos);
    const stale = new Date('2020-01-01T00:00:00.000Z').toISOString();
    (snapshot.tables.applications[0] as unknown as { createdAt: string }).createdAt = stale;

    await restoreSnapshot(repos, search, snapshot);
    const after = await repos.applications.findById(app1.id);

    expect(after!.createdAt.toISOString()).not.toBe(stale);
    expect(after!.createdAt.getTime()).toBeGreaterThanOrEqual(before!.createdAt.getTime());
  });

  it('rejects an unrecognized format or version before touching the database', async () => {
    expect(() => validateSnapshot({ format: 'something-else', version: 1, tables: {} })).toThrow();
    expect(() => validateSnapshot({ format: BACKUP_FORMAT, version: 999, tables: {} })).toThrow();
    expect(() => validateSnapshot({ format: BACKUP_FORMAT, version: BACKUP_VERSION, tables: { companies: [] } })).toThrow(
      /applications/,
    );
  });

  it('counts rows without needing a database', async () => {
    await seed();
    const snapshot = await createSnapshot(repos);
    const counts = countRows(snapshot);
    expect(counts).toMatchObject({ applications: 2, notes: 1, jobOpenings: 1 });
  });
});

describe('currentCounts / isEmpty / clearDatabase', () => {
  it('reports an empty database as empty', async () => {
    const counts = await currentCounts(repos);
    expect(isEmpty(counts)).toBe(true);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });

  it('reports a seeded database as not empty', async () => {
    await seed();
    const counts = await currentCounts(repos);
    expect(isEmpty(counts)).toBe(false);
    expect(counts.applications).toBe(2);
  });

  it('wipes every table without recreating anything', async () => {
    await seed();
    const result = await clearDatabase(repos, search);

    expect(result.counts.applications).toBe(2);
    expect(result.counts.notes).toBe(1);
    expect(result.counts.jobOpenings).toBe(1);

    const after = await currentCounts(repos);
    expect(isEmpty(after)).toBe(true);
  });
});

describe('encodeSnapshot / decodeSnapshot', () => {
  it('round-trips through gzip + obfuscation', async () => {
    await seed();
    const snapshot = await createSnapshot(repos);

    const encoded = encodeSnapshot(snapshot);
    // Obfuscated, not plain gzip — the gzip magic bytes must not appear at the start.
    expect(encoded[0]).not.toBe(0x1f);

    // decodeSnapshot returns raw parsed JSON — dates are still ISO strings at this point;
    // reviving them into `Date`s is restoreSnapshot's job, not decodeSnapshot's.
    const decoded = decodeSnapshot(encoded);
    expect(decoded).toEqual(JSON.parse(JSON.stringify(snapshot)));
  });

  it('rejects garbage input with a clean error rather than throwing a raw parse exception', () => {
    expect(() => decodeSnapshot(Buffer.from('not a backup file'))).toThrow(/not a JobTrack backup/);
  });
});
