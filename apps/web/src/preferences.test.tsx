/**
 * Remembered preferences: how long each group is kept, and how a URL-driven page gets its sort
 * and filters back. Storage is stubbed for the reason given in `api/demo-client.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { RememberParams } from './components/RememberParams.js';
import {
  APPLICATIONS_PARAMS,
  countPreferences,
  forgetPreferences,
  loadRememberModes,
  parse,
  readPreference,
  setRememberMode,
  usePreference,
  writePreference,
} from './preferences.js';

function stubStorage(name: 'localStorage' | 'sessionStorage'): Storage {
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
  Object.defineProperty(window, name, { value: stub, writable: true, configurable: true });
  return stub;
}

const local = stubStorage('localStorage');
const session = stubStorage('sessionStorage');

beforeEach(() => {
  local.clear();
  session.clear();
});

describe('remember modes', () => {
  it('keeps sorting always and filters for the tab by default', () => {
    expect(loadRememberModes()).toEqual({ view: 'always', filters: 'session' });
    writePreference('view', 'openings.order', 'fit');
    writePreference('filters', 'openings.locations', ['Stockholm']);
    expect(local.getItem('jobtrack.pref.view.openings.order')).toBe('"fit"');
    expect(session.getItem('jobtrack.pref.filters.openings.locations')).toBe('["Stockholm"]');
  });

  it('moves what is remembered when the mode changes, and drops it when turned off', () => {
    writePreference('filters', 'notes.search', 'recruiter');
    setRememberMode('filters', 'always');
    expect(session.length).toBe(0);
    expect(readPreference('filters', 'notes.search')).toBe('recruiter');

    setRememberMode('filters', 'off');
    expect(local.getItem('jobtrack.pref.filters.notes.search')).toBeNull();
    writePreference('filters', 'notes.search', 'again');
    expect(readPreference('filters', 'notes.search')).toBeUndefined();
  });

  it('forgets values but keeps the chosen modes and anything else on the origin', () => {
    local.setItem('jobtrack-theme', 'dark');
    setRememberMode('view', 'session');
    writePreference('view', 'companies.pageSize', 50);
    writePreference('filters', 'companies.search', 'acme');
    expect(countPreferences()).toBe(2);

    forgetPreferences();
    expect(countPreferences()).toBe(0);
    expect(loadRememberModes().view).toBe('session');
    expect(local.getItem('jobtrack-theme')).toBe('dark');
  });
});

describe('usePreference', () => {
  it('starts from what was stored and removes the value when set back to the default', () => {
    writePreference('view', 'openings.order', 'fit');
    const { result } = renderHook(() =>
      usePreference('view', 'openings.order', 'newest', parse.oneOf(['newest', 'fit'])),
    );
    expect(result.current[0]).toBe('fit');

    act(() => result.current[1]('newest'));
    expect(result.current[0]).toBe('newest');
    expect(local.getItem('jobtrack.pref.view.openings.order')).toBeNull();
  });

  it('ignores a stored value it does not recognize', () => {
    writePreference('view', 'openings.order', 'oldest');
    const { result } = renderHook(() =>
      usePreference('view', 'openings.order', 'newest', parse.oneOf(['newest', 'fit'])),
    );
    expect(result.current[0]).toBe('newest');
  });
});

describe('RememberParams', () => {
  function Probe() {
    const location = useLocation();
    const [, setParams] = useSearchParams();
    return (
      <>
        <output>{location.search}</output>
        <button onClick={() => setParams(new URLSearchParams(), { replace: true })}>clear</button>
        <button onClick={() => setParams(new URLSearchParams('status=offer&sort=company'), { replace: true })}>
          change
        </button>
      </>
    );
  }

  const renderAt = (url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/applications"
            element={
              <RememberParams spec={APPLICATIONS_PARAMS}>
                <Probe />
              </RememberParams>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

  it('saves the sort and filters, and restores them on a bare visit', () => {
    const first = renderAt('/applications?status=interview&sort=company&direction=asc');
    first.unmount();

    renderAt('/applications');
    expect(screen.getByRole('status').textContent).toBe('?sort=company&direction=asc&status=interview');
  });

  it('lets a link with filters keep them, while still restoring the sort', () => {
    renderAt('/applications?status=interview&sort=company').unmount();
    renderAt('/applications?tags=remote');
    expect(screen.getByRole('status').textContent).toBe('?tags=remote&sort=company');
  });

  it('does not bring cleared filters back', () => {
    renderAt('/applications?status=interview');
    act(() => screen.getByText('clear').click());
    expect(screen.getByRole('status').textContent).toBe('');
    act(() => screen.getByText('change').click());
    expect(screen.getByRole('status').textContent).toBe('?status=offer&sort=company');
    expect(readPreference('filters', 'applications')).toEqual({ status: 'offer' });
  });
});
