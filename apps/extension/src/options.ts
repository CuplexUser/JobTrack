/**
 * Two fields, saved and then verified — in that order, deliberately.
 *
 * The first version had a Save button and a Test button, and testing did not save. Typing a
 * token, seeing "connected", and closing the page therefore stored nothing, and the popup
 * went on to fail with "rejected the token" for a token the user had every reason to think
 * was in place. A setup screen that can report success while leaving nothing configured is
 * worse than one with no test at all, so testing now writes first and says that it did.
 *
 * The check itself goes to `/api/auth/check`, which exists only to answer this question:
 * every other route can be reachable for reasons unrelated to the token, and one of them —
 * a GET, which carries no `Origin` for the guard to judge — is what made the old test pass
 * with anything at all in the box.
 */

import { ApiCallError, callApi, loadSettings, saveSettings, DEFAULT_BASE_URL, type Settings } from './settings.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function setStatus(text: string, kind: 'info' | 'error' | 'ok'): void {
  const element = $('status');
  element.textContent = text;
  element.className = `status ${kind}`;
  element.hidden = text === '';
}

/** Whatever is in the boxes right now, normalized the same way storage normalizes it. */
function typedSettings(): Settings {
  return {
    baseUrl: $<HTMLInputElement>('baseUrl').value.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL,
    token: $<HTMLInputElement>('token').value.trim(),
  };
}

async function saveAndTest(): Promise<void> {
  const settings = typedSettings();
  if (settings.token === '') {
    setStatus('Paste the token from JobTrack’s data/api-token file first.', 'error');
    return;
  }

  await saveSettings(settings);
  setStatus('Saved. Checking…', 'info');

  let version: string;
  try {
    const meta = await callApi<{ version: string }>(settings, '/api/meta');
    version = meta.version;
  } catch (error) {
    // `/api/meta` needs no credentials, so failing here means JobTrack is not answering at
    // all — a different problem from a bad token, and worth saying so.
    setStatus(
      error instanceof Error ? error.message : `Could not reach JobTrack at ${settings.baseUrl}.`,
      'error',
    );
    return;
  }

  try {
    await callApi(settings, '/api/auth/check');
    setStatus(`Saved. Connected to JobTrack ${version}, and the token was accepted.`, 'ok');
  } catch (error) {
    if (error instanceof ApiCallError && error.status === 403) {
      setStatus(
        `JobTrack ${version} is running but did not accept that token. Copy the current one from its data/api-token file.`,
        'error',
      );
      return;
    }
    setStatus(error instanceof Error ? error.message : 'Could not check the token', 'error');
  }
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  $<HTMLInputElement>('baseUrl').value = settings.baseUrl;
  $<HTMLInputElement>('token').value = settings.token;

  if (settings.token === '') {
    setStatus('No token saved yet — paste one and press Save and test.', 'info');
  }

  $('test').addEventListener('click', () => void saveAndTest());
}

void main();
