/**
 * What the web UI remembers between visits: sort orders, page sizes and tabs ("view"), and
 * searches and filters ("filters"). Kept in the browser only, never in the database, so each
 * browser remembers its own.
 *
 * The user picks, per group, how long it is kept (Settings > Remembered in this browser):
 *
 * - `always`: `localStorage`, until they choose to forget it.
 * - `session`: `sessionStorage`, until the tab is closed.
 * - `off`: nothing is written, and the page starts from its defaults every time.
 *
 * Values live under `jobtrack.pref.<group>.<name>`, so a group can be moved between storages or
 * dropped by prefix without touching anything else on the origin (the theme, the demo data).
 *
 * Storage can be missing or throw (private windows, blocked site data). Every access is guarded
 * and a failure only means the preference is not remembered; the page works regardless.
 */

import { useCallback, useState } from 'react';

export type PreferenceGroup = 'view' | 'filters';
export type RememberMode = 'always' | 'session' | 'off';
export type RememberModes = Record<PreferenceGroup, RememberMode>;

export const PREFERENCE_GROUPS: readonly PreferenceGroup[] = ['view', 'filters'];

/** Sorting persists across visits; filters only for the tab, so a new day starts unfiltered. */
export const DEFAULT_REMEMBER_MODES: RememberModes = { view: 'always', filters: 'session' };

const MODES_KEY = 'jobtrack.remember';
const VALUE_PREFIX = 'jobtrack.pref.';

function storageFor(mode: RememberMode): Storage | null {
  if (mode === 'off') return null;
  try {
    return (mode === 'always' ? window.localStorage : window.sessionStorage) ?? null;
  } catch {
    return null;
  }
}

function isMode(value: unknown): value is RememberMode {
  return value === 'always' || value === 'session' || value === 'off';
}

export function loadRememberModes(): RememberModes {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MODES_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object') {
      const stored = parsed as Record<string, unknown>;
      return {
        view: isMode(stored.view) ? stored.view : DEFAULT_REMEMBER_MODES.view,
        filters: isMode(stored.filters) ? stored.filters : DEFAULT_REMEMBER_MODES.filters,
      };
    }
  } catch {
    // Unreadable or corrupt: the defaults apply.
  }
  return { ...DEFAULT_REMEMBER_MODES };
}

function keysInGroup(storage: Storage, group: PreferenceGroup): string[] {
  const prefix = `${VALUE_PREFIX}${group}.`;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/**
 * Changes how long one group is kept. What is already remembered moves to the new storage, so
 * switching from "until the tab closes" to "always" keeps the current sort rather than losing
 * it; switching to `off` forgets it.
 */
export function setRememberMode(group: PreferenceGroup, mode: RememberMode): void {
  const modes = loadRememberModes();
  const from = storageFor(modes[group]);
  const to = storageFor(mode);
  try {
    if (from && from !== to) {
      for (const key of keysInGroup(from, group)) {
        const value = from.getItem(key);
        if (to && value !== null) to.setItem(key, value);
        from.removeItem(key);
      }
    }
    window.localStorage.setItem(MODES_KEY, JSON.stringify({ ...modes, [group]: mode }));
  } catch {
    // Not remembered; the setting reverts to what could be read on the next visit.
  }
}

/** Forgets every remembered value in both storages. How long things are kept stays as chosen. */
export function forgetPreferences(): void {
  for (const mode of ['always', 'session'] as const) {
    const storage = storageFor(mode);
    if (!storage) continue;
    try {
      for (const group of PREFERENCE_GROUPS) {
        for (const key of keysInGroup(storage, group)) storage.removeItem(key);
      }
    } catch {
      // Nothing more can be done about storage that refuses to be read.
    }
  }
}

/** How many values are remembered right now, for the Settings card. */
export function countPreferences(): number {
  let count = 0;
  for (const mode of ['always', 'session'] as const) {
    const storage = storageFor(mode);
    if (!storage) continue;
    try {
      for (const group of PREFERENCE_GROUPS) count += keysInGroup(storage, group).length;
    } catch {
      // Counted as nothing.
    }
  }
  return count;
}

export function readPreference(group: PreferenceGroup, name: string): unknown {
  const storage = storageFor(loadRememberModes()[group]);
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(`${VALUE_PREFIX}${group}.${name}`);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** `undefined` removes the value, which is also how a preference goes back to its default. */
export function writePreference(group: PreferenceGroup, name: string, value: unknown): void {
  const storage = storageFor(loadRememberModes()[group]);
  if (!storage) return;
  const key = `${VALUE_PREFIX}${group}.${name}`;
  try {
    if (value === undefined) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the value lives on in the page's state until it is left.
  }
}

/**
 * `useState` that is remembered. `parse` turns whatever was stored (possibly written by an
 * older version, or edited by hand) into a valid value, or `undefined` to use the fallback.
 * Setting the fallback removes the stored value rather than writing it.
 */
export function usePreference<T>(
  group: PreferenceGroup,
  name: string,
  fallback: T,
  parse: (stored: unknown) => T | undefined,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readPreference(group, name);
    return stored === undefined ? fallback : (parse(stored) ?? fallback);
  });

  // `fallback` is a fresh literal on every render at most call sites; compared by value.
  const fallbackJson = JSON.stringify(fallback);
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writePreference(group, name, JSON.stringify(next) === fallbackJson ? undefined : next);
    },
    [group, name, fallbackJson],
  );

  return [value, update];
}

/** Parsers for `usePreference`. */
export const parse = {
  oneOf:
    <T extends string>(values: readonly T[]) =>
    (stored: unknown): T | undefined =>
      values.includes(stored as T) ? (stored as T) : undefined,
  string: (stored: unknown): string | undefined => (typeof stored === 'string' ? stored : undefined),
  strings: (stored: unknown): string[] | undefined =>
    Array.isArray(stored) && stored.every((item) => typeof item === 'string') ? stored : undefined,
  pageSize: (stored: unknown): number | undefined =>
    typeof stored === 'number' && Number.isInteger(stored) && stored > 0 && stored <= 500 ? stored : undefined,
};

/**
 * Pages whose filters live in the URL, and which of their query parameters belong to which
 * group. Anything not listed (a one-off like a highlighted row) is never remembered.
 */
export interface RememberedParams {
  page: string;
  view: readonly string[];
  filters: readonly string[];
}

export const APPLICATIONS_PARAMS: RememberedParams = {
  page: 'applications',
  view: ['sort', 'direction'],
  filters: ['q', 'status', 'workMode', 'tags', 'source', 'location', 'from', 'to', 'year', 'month'],
};

export const CONTACTS_PARAMS: RememberedParams = {
  page: 'people',
  view: [],
  filters: ['q', 'relationship', 'view'],
};

export const STATISTICS_PARAMS: RememberedParams = {
  page: 'statistics',
  view: ['granularity', 'archived'],
  filters: ['from', 'to', 'all'],
};

/**
 * The query string to arrive at, or `null` when the URL should stay as it is.
 *
 * Each group is judged on its own: a link that carries a filter (the dashboard's "interviews"
 * link, a bookmark) keeps exactly those filters, but still gets the remembered sort order.
 */
export function restoreParams(spec: RememberedParams, current: URLSearchParams): string | null {
  const next = new URLSearchParams(current);
  let changed = false;
  for (const group of PREFERENCE_GROUPS) {
    const keys = spec[group];
    if (keys.length === 0 || keys.some((key) => current.has(key))) continue;
    const stored = readPreference(group, spec.page);
    if (!stored || typeof stored !== 'object') continue;
    for (const key of keys) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === 'string' && value !== '') {
        next.set(key, value);
        changed = true;
      }
    }
  }
  return changed ? next.toString() : null;
}

export function saveParams(spec: RememberedParams, current: URLSearchParams): void {
  for (const group of PREFERENCE_GROUPS) {
    const keys = spec[group];
    if (keys.length === 0) continue;
    const values: Record<string, string> = {};
    for (const key of keys) {
      const value = current.get(key);
      if (value) values[key] = value;
    }
    writePreference(group, spec.page, Object.keys(values).length > 0 ? values : undefined);
  }
}
