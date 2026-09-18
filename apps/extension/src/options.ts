/**
 * The settings page: an address, a **Connect to JobTrack** button, and the old paste-the-token
 * form folded away underneath for the cases connecting cannot cover.
 *
 * Connecting (`connect.ts`) is the way in for nearly everyone. The manual form stays for a
 * JobTrack older than 1.3.0, which has no connect page, and for anyone whose setup the
 * connect page cannot reach.
 *
 * Both paths save and then verify, in that order, deliberately. The first version had a Save
 * button and a Test button, and testing did not save. Typing a token, seeing "connected", and
 * closing the page therefore stored nothing. A setup screen that can report success while
 * leaving nothing configured is worse than one with no test at all.
 *
 * The check itself goes to `/api/auth/check`, which exists only to answer this question:
 * every other route can be reachable for reasons unrelated to the token, and one of them (a
 * GET, which carries no `Origin` for the guard to judge) is what made the old test pass with
 * anything at all in the box.
 */

import { canReachJobTrack, NO_ACCESS_MESSAGE, requestJobTrackAccess } from './browser-api.js';
import { connectToJobTrack } from './connect.js';
import { ApiCallError, callApi, loadSettings, saveSettings, DEFAULT_BASE_URL, type Settings } from './settings.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setStatus(text: string, kind: 'info' | 'error' | 'ok'): void {
  const element = $('status');
  element.textContent = text;
  element.className = `status ${kind}`;
  element.hidden = text === '';
}

function typedBaseUrl(): string {
  return $<HTMLInputElement>('baseUrl').value.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

/** Whatever is in the boxes right now, normalized the same way storage normalizes it. */
function typedSettings(): Settings {
  return {
    baseUrl: typedBaseUrl(),
    token: $<HTMLInputElement>('token').value.trim(),
    locationCityOnly: $<HTMLInputElement>('locationCityOnly').checked,
  };
}

/**
 * Report whether saved settings work, without changing them. Returns the JobTrack version
 * when they do, or a sentence saying what is wrong.
 */
async function check(settings: Settings): Promise<{ ok: true; version: string } | { ok: false; message: string }> {
  let version: string;
  try {
    version = (await callApi<{ version: string }>(settings, '/api/meta')).version;
  } catch (error) {
    // `/api/meta` needs no credentials, so failing here means JobTrack is not answering at
    // all, a different problem from a bad token and worth saying so.
    return { ok: false, message: error instanceof Error ? error.message : `Could not reach JobTrack at ${settings.baseUrl}.` };
  }

  try {
    await callApi(settings, '/api/auth/check');
    return { ok: true, version };
  } catch (error) {
    if (error instanceof ApiCallError && error.status === 403) {
      return { ok: false, message: `JobTrack ${version} is running but did not accept the saved token. Press Connect to JobTrack again.` };
    }
    return { ok: false, message: error instanceof Error ? error.message : 'Could not check the token' };
  }
}

async function connect(): Promise<void> {
  // First, before any other await: Firefox only prompts from inside the click itself.
  const access = requestJobTrackAccess();
  const button = $<HTMLButtonElement>('connect');
  button.disabled = true;
  try {
    if (!(await access)) {
      setStatus(NO_ACCESS_MESSAGE, 'error');
      return;
    }
    setStatus('Opening JobTrack. Press Allow on the page that opens.', 'info');
    const result = await connectToJobTrack(typedBaseUrl());
    if (result.ok) {
      $<HTMLInputElement>('token').value = result.token;
      setStatus(`Connected to JobTrack ${result.version}. You can close this page.`, 'ok');
    } else {
      setStatus(result.message, 'error');
      if (result.reason === 'too-old') $<HTMLDetailsElement>('manual').open = true;
    }
  } finally {
    button.disabled = false;
  }
}

async function saveAndTest(): Promise<void> {
  const access = requestJobTrackAccess();
  const settings = typedSettings();
  if (!(await access)) {
    setStatus(NO_ACCESS_MESSAGE, 'error');
    return;
  }
  if (settings.token === '') {
    setStatus('Paste the token from JobTrack’s data/api-token file first.', 'error');
    return;
  }

  await saveSettings(settings);
  setStatus('Saved. Checking…', 'info');

  const result = await check(settings);
  setStatus(
    result.ok ? `Saved. Connected to JobTrack ${result.version}, and the token was accepted.` : `Saved. ${result.message}`,
    result.ok ? 'ok' : 'error',
  );
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  $<HTMLInputElement>('baseUrl').value = settings.baseUrl;
  $<HTMLInputElement>('token').value = settings.token;
  $<HTMLInputElement>('locationCityOnly').checked = settings.locationCityOnly;

  $('connect').addEventListener('click', () => void connect());
  $('test').addEventListener('click', () => void saveAndTest());
  // Saved the moment it changes, independent of the address/token below: it is not part of
  // connecting, and making someone press "Save and test" — which needs a token typed in — to
  // store an unrelated preference would be a strange thing to require.
  $<HTMLInputElement>('locationCityOnly').addEventListener('change', (event) => {
    void loadSettings().then((current) =>
      saveSettings({ ...current, locationCityOnly: (event.target as HTMLInputElement).checked }),
    );
  });

  if (settings.token === '') {
    setStatus('Not connected yet. Start JobTrack, then press Connect to JobTrack.', 'info');
    return;
  }

  // Without access every request fails as if JobTrack were down, so say which it is.
  if (!(await canReachJobTrack())) {
    setStatus(`${NO_ACCESS_MESSAGE} Press Connect to JobTrack to be asked.`, 'error');
    return;
  }

  const result = await check(settings);
  setStatus(result.ok ? `Connected to JobTrack ${result.version}.` : result.message, result.ok ? 'ok' : 'error');
}

void main();
