import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TARGET_NAME,
  loadDbTargets,
  readActiveTargetName,
  writeActiveTargetName,
} from '../src/db/targets.js';

describe('loadDbTargets', () => {
  it('synthesizes exactly one "default" target from DB_DRIVER/DB_FILE when DB_TARGETS is unset', () => {
    const targets = loadDbTargets({ DB_DRIVER: 'sqlite', DB_FILE: './data/jobtrack.db' });
    expect(targets).toEqual([{ name: DEFAULT_TARGET_NAME, driver: 'sqlite', databaseFile: './data/jobtrack.db' }]);
  });

  it('appends named targets from DB_TARGETS', () => {
    const targets = loadDbTargets({
      DB_DRIVER: 'sqlite',
      DB_FILE: './data/jobtrack.db',
      DB_TARGETS: JSON.stringify([{ name: 'cloud', driver: 'postgres', url: 'postgres://host/db' }]),
    });
    expect(targets).toHaveLength(2);
    expect(targets[1]).toEqual({ name: 'cloud', driver: 'postgres', databaseUrl: 'postgres://host/db' });
  });

  it('rejects a target named "default" — that name is reserved', () => {
    expect(() =>
      loadDbTargets({
        DB_TARGETS: JSON.stringify([{ name: 'default', driver: 'sqlite', file: './x.db' }]),
      }),
    ).toThrow(/reserved/);
  });

  it('rejects two targets with the same name', () => {
    expect(() =>
      loadDbTargets({
        DB_TARGETS: JSON.stringify([
          { name: 'a', driver: 'sqlite', file: './a.db' },
          { name: 'a', driver: 'sqlite', file: './b.db' },
        ]),
      }),
    ).toThrow(/more than one target named "a"/);
  });

  it('rejects a sqlite target with no file', () => {
    expect(() =>
      loadDbTargets({ DB_TARGETS: JSON.stringify([{ name: 'a', driver: 'sqlite' }]) }),
    ).toThrow(/needs a "file"/);
  });

  it('rejects a postgres target with no url', () => {
    expect(() =>
      loadDbTargets({ DB_TARGETS: JSON.stringify([{ name: 'a', driver: 'postgres' }]) }),
    ).toThrow(/needs a "url"/);
  });

  it('rejects malformed JSON', () => {
    expect(() => loadDbTargets({ DB_TARGETS: 'not json' })).toThrow(/not valid JSON/);
  });

  it('rejects an invalid DB_DRIVER', () => {
    expect(() => loadDbTargets({ DB_DRIVER: 'oracle' })).toThrow(/DB_DRIVER must be/);
  });
});

describe('active target pointer file', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobtrack-active-db-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const targets = [
    { name: DEFAULT_TARGET_NAME, driver: 'sqlite' as const, databaseFile: './data/jobtrack.db' },
    { name: 'cloud', driver: 'postgres' as const, databaseUrl: 'postgres://host/db' },
  ];

  it('falls back to "default" when no pointer file exists yet', () => {
    expect(readActiveTargetName(dir, targets)).toBe(DEFAULT_TARGET_NAME);
  });

  it('remembers what was written', () => {
    writeActiveTargetName(dir, 'cloud');
    expect(readActiveTargetName(dir, targets)).toBe('cloud');
  });

  it('falls back to "default" when the pointer names a target that no longer exists', () => {
    writeActiveTargetName(dir, 'cloud');
    // As if `.env` had DB_TARGETS edited to remove "cloud" after the switch.
    expect(readActiveTargetName(dir, [targets[0]!])).toBe(DEFAULT_TARGET_NAME);
  });

  it('creates the data directory if it does not exist yet', () => {
    const fresh = join(dir, 'nested');
    writeActiveTargetName(fresh, 'cloud');
    expect(readActiveTargetName(fresh, targets)).toBe('cloud');
  });
});
