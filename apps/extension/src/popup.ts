/**
 * The popup: read the tab, show what was found, save it.
 *
 * Deliberately one screen with one button. The fields are editable because every parse is a
 * guess, and the duplicate verdict the API returns is shown *before* the save as well as
 * after, because "you applied here in March" is worth knowing at exactly the moment you are
 * about to save another posting from the same company.
 */

import { isUsableDraft, type PostingDraft } from '@jobtrack/shared/posting';
// Types only, so the root entry point (and the zod it carries) never reaches this bundle.
import type { DuplicateCheck } from '@jobtrack/shared';
import { canReachJobTrack, ext, NO_ACCESS_MESSAGE } from './browser-api.js';
import { buildDraft, simplifyLocation } from './extract.js';
import { readPage, type PageSnapshot } from './page-reader.js';
import { rulesFor } from './sites.js';
import { ApiCallError, callApi, loadSettings, type Settings } from './settings.js';

interface ClipResponse {
  duplicate: DuplicateCheck & { company: { name: string } | null };
  opening: { id: string };
}

interface IngestUrlResponse {
  draft: PostingDraft;
}

/**
 * Sites whose own page carries none of the posting — Platsbanken renders it entirely
 * client-side after load — so reading the tab's DOM cannot win here even in principle. The
 * server can, since it now knows to ask Arbetsförmedlingen's own API instead of fetching the
 * page (see `ingestUrl` in the API), and it is the same request the web app's "Paste a link"
 * tab makes.
 */
const SERVER_READ_HOSTS = ['arbetsformedlingen.se'];

function needsServerRead(hostname: string): boolean {
  return SERVER_READ_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

/** Applies the **Settings → Show city only** preference, wherever the draft came from. */
function applyLocationPreference(target: PostingDraft): void {
  if (settings.locationCityOnly && target.location) {
    target.location = simplifyLocation(target.location);
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const NO_TOKEN = 'Not connected to JobTrack yet. Open Settings and press Connect to JobTrack.';

let settings: Settings;
let draft: PostingDraft | null = null;

function setStatus(text: string, kind: 'info' | 'error' | 'ok' | 'warn' = 'info'): void {
  const element = $('status');
  element.textContent = text;
  element.className = `status ${kind}`;
  element.hidden = text === '';
}

function fillForm(values: PostingDraft): void {
  $<HTMLInputElement>('company').value = values.companyName;
  $<HTMLInputElement>('title').value = values.jobTitle;
  $<HTMLInputElement>('location').value = values.location ?? '';
  $<HTMLInputElement>('source').value = values.sourceName ?? '';
}

/** The form is the truth at save time — the user may have corrected the parse. */
function readForm(): PostingDraft {
  return {
    ...(draft ?? {
      companyName: '',
      jobTitle: '',
      jobUrl: null,
      location: null,
      workMode: 'unspecified' as const,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      sourceName: null,
      notes: null,
    }),
    companyName: $<HTMLInputElement>('company').value.trim(),
    jobTitle: $<HTMLInputElement>('title').value.trim(),
    location: $<HTMLInputElement>('location').value.trim() || null,
    sourceName: $<HTMLInputElement>('source').value.trim() || null,
  };
}

/** Say what a verdict means in one line — the popup has no room for the full history. */
function describeDuplicate(check: ClipResponse['duplicate']): string {
  const company = check.company?.name ?? 'this company';
  switch (check.verdict) {
    case 'exact':
      return `Heads up: you have already applied for this exact role at ${company}.`;
    case 'similar':
      return `Heads up: you have applied for a very similar role at ${company}.`;
    case 'company':
      return `Note: you have applied to ${company} ${check.priorCount === 1 ? 'once' : `${check.priorCount} times`} before.`;
    default:
      return '';
  }
}

async function readCurrentTab(): Promise<void> {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('No page to read.', 'error');
    return;
  }

  let hostname = '';
  try {
    hostname = new URL(tab.url ?? '').hostname;
  } catch {
    hostname = '';
  }

  if (tab.url && needsServerRead(hostname) && settings.token) {
    try {
      const result = await callApi<IngestUrlResponse>(settings, '/api/ingest/url', { url: tab.url });
      if (isUsableDraft(result.draft)) {
        draft = result.draft;
        applyLocationPreference(draft);
        fillForm(draft);
        $('method').textContent = 'Read from Arbetsförmedlingen’s own job data.';
        setStatus('', 'info');
        return;
      }
    } catch {
      // Falls through to the ordinary page read below.
    }
  }

  const rules = rulesFor(hostname);

  let snapshot: PageSnapshot;
  try {
    const [injection] = await ext.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPage,
      args: [
        {
          ...(rules?.title ? { title: rules.title } : {}),
          ...(rules?.company ? { company: rules.company } : {}),
          ...(rules?.location ? { location: rules.location } : {}),
          ...(rules?.salary ? { salary: rules.salary } : {}),
          ...(rules?.description ? { description: rules.description } : {}),
        },
      ],
    });
    snapshot = injection!.result;
  } catch {
    // Browsers refuse injection on their own pages, their add-on stores, and PDF viewers.
    setStatus('This page cannot be read by an extension. Try the posting’s own page.', 'error');
    return;
  }

  const extraction = buildDraft(snapshot);
  draft = extraction.draft;
  applyLocationPreference(draft);
  fillForm(draft);

  $('method').textContent = `Read from ${extraction.method}.`;
  if (!draft.companyName || !draft.jobTitle) {
    setStatus('Could not make out the company or title. Fill them in below.', 'error');
  } else {
    // Never clear the setup warning: reading the page says nothing about whether this
    // extension can reach JobTrack, and silently dropping it is what let a save be
    // attempted with no token and fail with a message about the wrong thing.
    setStatus(settings.token ? '' : NO_TOKEN, settings.token ? 'info' : 'error');
  }
}

async function save(): Promise<void> {
  const payload = readForm();
  if (!payload.companyName || !payload.jobTitle) {
    setStatus('A company and a job title are needed to save.', 'error');
    return;
  }

  if (!settings.token) {
    setStatus(NO_TOKEN, 'error');
    return;
  }

  const button = $<HTMLButtonElement>('save');
  button.disabled = true;
  setStatus('Saving…');

  try {
    const result = await callApi<ClipResponse>(settings, '/api/ingest/clip', payload);
    const warning = describeDuplicate(result.duplicate);
    setStatus(warning ? `Saved. ${warning}` : 'Saved to JobTrack.', warning ? 'info' : 'ok');
    button.textContent = 'Saved';
  } catch (error) {
    if (error instanceof ApiCallError && error.status === 409) {
      // The posting is already in JobTrack, which is an answer rather than a failure — and
      // it is the same answer every subsequent press would get, so the button stays down
      // instead of inviting a third copy that the API would only refuse again.
      setStatus(error.message, 'warn');
      button.textContent = 'Already saved';
      return;
    }
    if (error instanceof ApiCallError && error.status === 403) {
      setStatus('JobTrack did not accept the saved token. Open Settings and press Connect to JobTrack again.', 'error');
    } else {
      setStatus(error instanceof Error ? error.message : 'Could not save', 'error');
    }
    button.disabled = false;
  }
}

async function main(): Promise<void> {
  settings = await loadSettings();
  $('options').addEventListener('click', () => void ext.runtime.openOptionsPage());
  $('save').addEventListener('click', () => void save());

  if (!settings.token) setStatus(NO_TOKEN, 'error');
  await readCurrentTab();

  // Checked after reading the page, which needs no access to JobTrack, and shown over any
  // other status: without access, saving fails in a way that looks like JobTrack is down.
  if (!(await canReachJobTrack())) setStatus(NO_ACCESS_MESSAGE, 'error');
}

void main();
