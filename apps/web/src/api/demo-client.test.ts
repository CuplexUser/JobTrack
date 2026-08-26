/**
 * There is no headless browser in this environment, so this exercises the demo's actual
 * data path — seed, search, duplicate check, and a localStorage round trip simulating a
 * page reload — directly against `demoApi`, under jsdom (which supplies `localStorage` and
 * `File`, the two browser APIs this module leans on). `vi.resetModules()` between tests
 * re-runs the module's lazy `init()`, which is what a real page reload does; `localStorage`
 * itself survives the reset, exactly as it would in a browser.
 *
 * Node 22+'s own experimental `localStorage` global (gated behind `--localstorage-file`,
 * which Vitest does not pass) shadows jsdom's implementation here, leaving both the bare
 * global and `window.localStorage` undefined. `demo-client.ts` itself just calls
 * `localStorage.getItem`/`setItem`, so a minimal in-memory stand-in is enough to exercise
 * it — this is a test-environment wrinkle, not something the shipped code needs to handle.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

function installLocalStorageStub(): Storage {
  const data = new Map<string, string>();
  const stub: Storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: stub, writable: true, configurable: true });
  return stub;
}

const localStorageStub = installLocalStorageStub();

describe('demo-client', () => {
  beforeEach(() => {
    localStorageStub.clear();
    vi.resetModules();
  });

  it('seeds the demo dataset on first load', async () => {
    const { demoApi } = await import('./demo-client.js');
    const list = await demoApi.listApplications({});
    expect(list.total).toBeGreaterThan(0);

    const { companies } = await demoApi.listCompanies();
    expect(companies.some((c) => c.name === 'Spotify')).toBe(true);
  });

  it('fuses lexical and fake-semantic search results', async () => {
    const { demoApi } = await import('./demo-client.js');
    const result = await demoApi.search('server-side developer');
    const titles = result.results
      .filter((r): r is typeof r & { record: { jobTitle: string } } => 'jobTitle' in r.record)
      .map((r) => r.record.jobTitle);
    expect(titles.some((t) => /backend|platform|server/i.test(t))).toBe(true);
  });

  it('reports prior applications at a company via the duplicate check', async () => {
    const { demoApi } = await import('./demo-client.js');
    const result = await demoApi.checkDuplicates({ company: 'Spotify', title: 'Staff Backend Engineer' });
    expect(result.company?.name).toBe('Spotify');
    expect(result.priorCount).toBeGreaterThan(0);
  });

  it('persists a created application across a simulated reload', async () => {
    const { demoApi: session1 } = await import('./demo-client.js');
    const created = await session1.createApplication({
      companyName: 'Acme Test Co',
      jobTitle: 'Test Engineer',
      appliedOn: '2026-08-01',
    });
    expect(created.jobTitle).toBe('Test Engineer');

    vi.resetModules();
    const { demoApi: session2 } = await import('./demo-client.js');
    const found = await session2.getApplication(created.id);
    expect(found?.jobTitle).toBe('Test Engineer');
  });

  it('rejects an .xlsx import with a demo-scoped error instead of touching exceljs', async () => {
    const { demoApi } = await import('./demo-client.js');
    const file = new File(['irrelevant'], 'applications.xlsx');
    await expect(demoApi.previewImport(file, 'xlsx')).rejects.toThrow(/demo/i);
  });

  it('builds a CSV export entirely client-side', async () => {
    const { demoExportCsv } = await import('./demo-client.js');
    const { filename, blob } = await demoExportCsv({});
    expect(filename).toMatch(/\.csv$/);
    const text = await blob.text();
    expect(text).toContain('Position');
    expect(text.split('\n').length).toBeGreaterThan(1);
  });
});
