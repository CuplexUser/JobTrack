import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Decrypter, type Identity, type Stanza } from 'age-encryption';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupScheduleSchema, type BackupRunState } from '@jobtrack/shared';
import { buildApp } from '../src/app.js';
import { decodeBackup, decodeSnapshot, encodeSnapshot } from '../src/backup/codec.js';
import { BackupConfigStore, EMPTY_STATE } from '../src/backup/config-store.js';
import { checkRecipient, decryptBackup, encryptBackup, generateKey, isAgeEncrypted } from '../src/backup/crypto.js';
import { FolderDestination } from '../src/backup/destinations/folder.js';
import { pluginNameOf, type PluginLauncher } from '../src/backup/plugin-recipient.js';
import { backupFileName, expiredBackups, nextDue, parseBackupFileName } from '../src/backup/schedule.js';
import { runAutoBackup, runScheduledBackup } from '../src/backup/auto-backup.js';
import { createSnapshot, validateSnapshot } from '../src/backup/snapshot.js';
import { createApplication } from '../src/services/applications.service.js';
import { applicationInput, testDeps } from './support/repos.js';
import type { Deps } from '../src/deps.js';

const FAKE_PLUGIN = resolve(fileURLToPath(new URL('.', import.meta.url)), 'support/fake-age-plugin.mjs');
const fakeLauncher: PluginLauncher = () => ({ command: process.execPath, args: [FAKE_PLUGIN] });
/** A plugin recipient for `age-plugin-fake`; the fake plugin does not look at its payload. */
const FAKE_RECIPIENT = 'age1fake1qqqqqqqqqqqqqqqqqqqqqqqqqqqq';

/** Undoes the fake plugin's wrap, standing in for the YubiKey at restore time. */
const fakeIdentity: Identity = {
  unwrapFileKey(stanzas: Stanza[]) {
    const own = stanzas.find((stanza) => stanza.args[0] === 'fake');
    return own ? own.body.map((b) => b ^ 0xff) : null;
  },
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jobtrack-backup-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const plain = new Uint8Array(Buffer.from('a backup payload'));

describe('encryption', () => {
  it('round-trips with a passphrase, and refuses a wrong one', async () => {
    const encrypted = await encryptBackup(plain, { kind: 'passphrase', passphrase: 'correct horse' }, { scryptWorkFactor: 10 });
    expect(isAgeEncrypted(encrypted)).toBe(true);
    expect(await decryptBackup(encrypted, { passphrase: 'correct horse' })).toEqual(Buffer.from(plain));
    await expect(decryptBackup(encrypted, { passphrase: 'wrong' })).rejects.toThrow(/Could not decrypt/);
    await expect(decryptBackup(encrypted, {})).rejects.toThrow(/encrypted/);
  });

  it('encrypts to several keys, any one of which opens it', async () => {
    const a = await generateKey();
    const b = await generateKey();
    const encrypted = await encryptBackup(plain, { kind: 'recipients', recipients: [a.recipient, b.recipient] });
    expect(await decryptBackup(encrypted, { identity: `# key b\n${b.identity}\n` })).toEqual(Buffer.from(plain));
    expect(await decryptBackup(encrypted, { identity: a.identity })).toEqual(Buffer.from(plain));
    const stranger = await generateKey();
    await expect(decryptBackup(encrypted, { identity: stranger.identity })).rejects.toThrow(/Could not decrypt/);
  });

  it('wraps for a plugin key by speaking the age plugin protocol', async () => {
    const other = await generateKey();
    const encrypted = await encryptBackup(
      plain,
      { kind: 'recipients', recipients: [FAKE_RECIPIENT, other.recipient] },
      { launch: fakeLauncher },
    );
    const decrypter = new Decrypter();
    decrypter.addIdentity(fakeIdentity);
    expect(Buffer.from(await decrypter.decrypt(encrypted))).toEqual(Buffer.from(plain));
  });

  it('reports a missing plugin, a plugin error, and a malformed key', async () => {
    expect(await checkRecipient(FAKE_RECIPIENT, { launch: fakeLauncher })).toBeNull();
    expect(await checkRecipient('age1nosuchplugin1qqqqqqqqqqqqqqqq')).toMatch(/age-plugin-nosuchplugin was not found/);
    process.env.FAKE_PLUGIN_MODE = 'error';
    try {
      expect(await checkRecipient(FAKE_RECIPIENT, { launch: fakeLauncher })).toMatch(/no key in slot/);
    } finally {
      delete process.env.FAKE_PLUGIN_MODE;
    }
    expect(await checkRecipient('age1qqqqqqqqqqqqqqqqqqqq')).not.toBeNull();
  });

  it('tells plugin keys apart from native ones', () => {
    expect(pluginNameOf('age1yubikey1qwerty')).toBe('yubikey');
    expect(pluginNameOf('age1fido2-hmac1qwerty')).toBe('fido2-hmac');
    expect(pluginNameOf('age1qwerty')).toBeNull();
    expect(pluginNameOf('age1pq1qwerty')).toBeNull();
    expect(pluginNameOf('age1tag1qwerty')).toBeNull();
  });

  it('opens both encrypted and legacy files, so old backups still restore', async () => {
    const deps = testDeps();
    const legacy = encodeSnapshot(await createSnapshot(deps.repos));
    const key = await generateKey();
    const wrapped = await encryptBackup(legacy, { kind: 'recipients', recipients: [key.recipient] });
    expect(validateSnapshot(await decodeBackup(legacy)).format).toBe('jobtrack-backup');
    expect(validateSnapshot(await decodeBackup(wrapped, { identity: key.identity })).format).toBe('jobtrack-backup');
    // What `age -d` gives back is exactly a legacy file.
    expect(decodeSnapshot(await decryptBackup(wrapped, { identity: key.identity }))).toMatchObject({ format: 'jobtrack-backup' });
  });
});

describe('schedule', () => {
  const state = (over: Partial<BackupRunState> = {}): BackupRunState => ({ ...EMPTY_STATE, ...over });
  const daily = backupScheduleSchema.parse({ frequency: 'daily', time: '02:00' });
  const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

  it('runs a daily backup at its time, and catches up on a missed one', () => {
    const now = local(2026, 9, 25, 10);
    // Done after today's 02:00: next is tomorrow.
    expect(nextDue(daily, state({ lastSuccessAt: local(2026, 9, 25, 2, 1).toISOString() }), now)).toEqual(local(2026, 9, 26, 2));
    // Last done yesterday, so today's 02:00 was missed: due now (a time in the past).
    expect(nextDue(daily, state({ lastSuccessAt: local(2026, 9, 24, 2).toISOString() }), now)).toEqual(local(2026, 9, 25, 2));
    // A skip counts as done.
    expect(nextDue(daily, state({ lastSkippedAt: local(2026, 9, 25, 2).toISOString() }), now)).toEqual(local(2026, 9, 26, 2));
  });

  it('runs weekly only on the chosen days', () => {
    // 2026-09-25 is a Friday; Monday and Wednesday are chosen.
    const weekly = backupScheduleSchema.parse({ frequency: 'weekly', time: '21:30', weekdays: [3, 1] });
    const now = local(2026, 9, 25, 10);
    const done = state({ lastSuccessAt: local(2026, 9, 23, 21, 31).toISOString() });
    expect(nextDue(weekly, done, now)).toEqual(local(2026, 9, 28, 21, 30));
  });

  it('runs hourly every N hours, starting right away', () => {
    const hourly = backupScheduleSchema.parse({ frequency: 'hourly', everyHours: 6 });
    const now = local(2026, 9, 25, 10);
    expect(nextDue(hourly, state(), now)).toEqual(now);
    expect(nextDue(hourly, state({ lastSuccessAt: local(2026, 9, 25, 9).toISOString() }), now)).toEqual(local(2026, 9, 25, 15));
  });

  it('waits an hour after a failure before trying again', () => {
    const now = local(2026, 9, 25, 10);
    const failed = state({
      lastSuccessAt: local(2026, 9, 23, 2).toISOString(),
      lastRunAt: local(2026, 9, 25, 9, 50).toISOString(),
      lastError: 'offline',
    });
    expect(nextDue(daily, failed, now)).toEqual(local(2026, 9, 25, 10, 50));
  });
});

describe('names and retention', () => {
  it('names files by target and UTC time, and reads them back', () => {
    const at = new Date('2026-09-25T02:00:00.000Z');
    const name = backupFileName('work db', at, true);
    expect(name).toBe('jobtrack-work_db-20260925T020000Z.jtbak.age');
    expect(parseBackupFileName(name)).toEqual({ target: 'work_db', at, encrypted: true });
    expect(parseBackupFileName('holiday.jpg')).toBeNull();
  });

  it('keeps the newest N, drops old ones, and never touches other files or targets', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    const day = (n: number) => backupFileName('default', new Date(now.getTime() - n * 86_400_000), false);
    const names = [day(0), day(1), day(2), day(3), day(100), 'notes.txt', backupFileName('other', new Date(0), false)];

    expect(expiredBackups(names, 'default', { keepLast: 3, maxAgeDays: null }, now)).toEqual([day(3), day(100)]);
    expect(expiredBackups(names, 'default', { keepLast: null, maxAgeDays: 90 }, now)).toEqual([day(100)]);
    expect(expiredBackups(names, 'default', { keepLast: null, maxAgeDays: null }, now)).toEqual([]);
    // Even when every backup is too old, the newest one stays.
    expect(expiredBackups([day(100), day(200)], 'default', { keepLast: 1, maxAgeDays: 1 }, now)).toEqual([day(200)]);
  });
});

describe('folder destination', () => {
  it('writes whole files, lists only its own, and refuses to delete anything else', async () => {
    const folder = new FolderDestination(dir);
    await folder.test();
    const name = backupFileName('default', new Date(), false);
    await folder.write(name, plain);
    writeFileSync(join(dir, 'unrelated.docx'), 'x');

    expect(readdirSync(dir).sort()).toEqual([name, 'unrelated.docx'].sort());
    expect((await folder.list()).map((entry) => entry.name)).toEqual([name]);
    await expect(folder.remove('unrelated.docx')).rejects.toThrow(/did not write/);
    await folder.remove(name);
    expect(readdirSync(dir)).toEqual(['unrelated.docx']);
  });

  it('explains a missing or relative folder', async () => {
    await expect(new FolderDestination(join(dir, 'missing')).test()).rejects.toThrow(/does not exist/);
    await expect(new FolderDestination('relative/path').test()).rejects.toThrow(/full path/);
  });
});

describe('automatic backups', () => {
  let deps: Deps;
  let store: BackupConfigStore;
  let out: string;

  beforeEach(async () => {
    deps = testDeps({ config: { dataDir: join(dir, 'app') } });
    store = new BackupConfigStore(deps.config.dataDir);
    out = join(dir, 'OneDrive');
    mkdirSync(out);
    await createApplication(deps.repos, applicationInput());
  });

  const context = (now: Date) => ({ repos: deps.repos, store, target: 'default', now: () => now });

  it('writes when due, skips when nothing changed, and applies retention', async () => {
    store.updateConfig({ enabled: true, destination: { kind: 'folder', path: out }, retention: { keepLast: 2, maxAgeDays: null } });
    const at = (hours: number) => new Date(Date.UTC(2026, 8, 25, hours));

    const first = await runScheduledBackup(context(at(1)));
    expect(first).toMatchObject({ outcome: 'written' });
    // Not due again straight away.
    expect(await runScheduledBackup(context(at(1)))).toBeNull();

    // Due a day later, but nothing changed.
    expect(await runScheduledBackup(context(at(30)))).toMatchObject({ outcome: 'skipped' });

    // "Back up now" always writes; retention keeps two.
    await runAutoBackup(context(at(31)), { force: true });
    const third = await runAutoBackup(context(at(32)), { force: true });
    expect(third.removed).toEqual([first!.file]);
    expect(readdirSync(out)).toHaveLength(2);

    const written = readFileSync(join(out, third.file!));
    expect(validateSnapshot(await decodeBackup(written)).tables.applications).toHaveLength(1);
  });

  it('encrypts to the configured keys, and records a failure', async () => {
    const key = await generateKey();
    store.updateConfig({
      enabled: true,
      destination: { kind: 'folder', path: out },
      encryption: { mode: 'recipients', recipients: [{ label: 'Offline', recipient: key.recipient }] },
    });
    const result = await runAutoBackup(context(new Date()));
    expect(result.file).toMatch(/\.jtbak\.age$/);
    const file = readFileSync(join(out, result.file!));
    expect(validateSnapshot(await decodeBackup(file, { identity: key.identity })).tables.applications).toHaveLength(1);

    store.updateConfig({ destination: { kind: 'folder', path: join(dir, 'gone') } });
    await expect(runAutoBackup(context(new Date()), { force: true })).rejects.toThrow(/does not exist/);
    expect(store.getState().lastError).toMatch(/does not exist/);
  });
});

describe('over HTTP', () => {
  let app: FastifyInstance;
  let out: string;

  beforeEach(async () => {
    const deps = testDeps({ config: { dataDir: join(dir, 'app') } });
    await createApplication(deps.repos, applicationInput());
    out = join(dir, 'share');
    mkdirSync(out);
    app = await buildApp(deps);
  });

  afterEach(async () => {
    await app.close();
  });

  it('saves settings, tests them, backs up now and lists the result', async () => {
    const initial = await app.inject({ method: 'GET', url: '/api/backup/auto' });
    expect(initial.json()).toMatchObject({ config: { enabled: false }, hasPassphrase: false, nextRunAt: null });

    const noFolder = await app.inject({ method: 'PUT', url: '/api/backup/auto', payload: { enabled: true } });
    expect(noFolder.statusCode).toBe(400);
    expect(noFolder.json().message).toMatch(/Choose a folder/);

    const saved = await app.inject({ method: 'PUT', url: '/api/backup/auto', payload: { enabled: true, destination: { path: out } } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().nextRunAt).not.toBeNull();

    expect((await app.inject({ method: 'POST', url: '/api/backup/auto/test', payload: {} })).json()).toEqual({ ok: true, problems: [] });

    const run = await app.inject({ method: 'POST', url: '/api/backup/auto/run' });
    expect(run.json()).toMatchObject({ outcome: 'written' });
    const files = await app.inject({ method: 'GET', url: '/api/backup/auto/files' });
    expect(files.json()).toHaveLength(1);
    expect(files.json()[0]).toMatchObject({ name: run.json().file, encrypted: false });
  });

  it('keeps the sections a save leaves out', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/backup/auto',
      payload: { enabled: true, destination: { path: out }, retention: { keepLast: 3, maxAgeDays: null } },
    });
    const saved = await app.inject({ method: 'PUT', url: '/api/backup/auto', payload: { skipUnchanged: false } });
    expect(saved.json().config).toMatchObject({
      enabled: true,
      destination: { path: out },
      retention: { keepLast: 3, maxAgeDays: null },
      skipUnchanged: false,
    });
  });

  it('refuses passphrase mode without a passphrase, and never returns the passphrase', async () => {
    const refused = await app.inject({
      method: 'PUT',
      url: '/api/backup/auto',
      payload: { enabled: true, destination: { path: out }, encryption: { mode: 'passphrase' } },
    });
    expect(refused.json().message).toMatch(/Save a passphrase/);

    const set = await app.inject({ method: 'PUT', url: '/api/backup/auto/passphrase', payload: { passphrase: 'long enough phrase' } });
    expect(set.json().hasPassphrase).toBe(true);
    expect(set.body).not.toContain('long enough phrase');
  });

  it('rejects a malformed key on save', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/backup/auto',
      payload: { encryption: { mode: 'recipients', recipients: [{ recipient: 'age1qqqqqqqqqqqqqqqqqqqq' }] } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('exports encrypted when keys are set, and restores with the secret key in a header', async () => {
    const key = (await app.inject({ method: 'POST', url: '/api/backup/auto/keypair' })).json();
    expect(key.identity).toMatch(/^AGE-SECRET-KEY-1/);
    await app.inject({
      method: 'PUT',
      url: '/api/backup/auto',
      payload: { encryption: { mode: 'recipients', recipients: [{ label: 'Paper', recipient: key.recipient }] } },
    });

    const exported = await app.inject({ method: 'GET', url: '/api/backup/export' });
    expect(exported.headers['content-disposition']).toMatch(/\.jtbak\.age"/);
    const body = exported.rawPayload;

    const locked = await app.inject({ method: 'POST', url: '/api/backup/import', payload: body, headers: { 'content-type': 'application/octet-stream' } });
    expect(locked.statusCode).toBe(400);
    expect(locked.json().error).toBe('backup_encrypted');

    const opened = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      payload: body,
      headers: { 'content-type': 'application/octet-stream', 'x-backup-identity': encodeURIComponent(`# my key\n${key.identity}`) },
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ mode: 'preview', counts: { applications: 1 } });
  });
});
