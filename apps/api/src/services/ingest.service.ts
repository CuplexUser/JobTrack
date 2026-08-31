/**
 * Capturing a posting from the web.
 *
 * Three routes in, one shape out. A URL is fetched and read for `schema.org/JobPosting`
 * JSON-LD; pasted text is parsed heuristically; the browser extension sends a draft it
 * built from the page the user was looking at. All three produce a `PostingDraft`, and all
 * three get the *same* duplicate verdict the New Application form shows while you type —
 * which is the point of routing capture through here rather than straight at
 * `POST /api/openings`: the moment you save something is exactly the moment worth being
 * told you already applied to this company in March.
 *
 * Parsing itself lives in `@jobtrack/shared`, not here, because the extension and the web
 * app run the same code in a browser.
 */

import {
  parseJsonLdPosting,
  parsePostingText,
  sourceFromUrl,
  type JobOpeningView,
  type PostingDraft,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import type { SearchIndex } from '../search/index.js';
import { HttpError } from '../lib/errors.js';
import { checkDuplicates, type DuplicateCheckResult } from './duplicates.service.js';
import { createOpening, findMatchingOpening } from './openings.service.js';

/** How long to wait on a job site before giving up. Long enough for a slow ATS, short enough to feel broken-fast rather than hung. */
const FETCH_TIMEOUT_MS = 10_000;

/** A posting page is text. Anything past this is not one, and is not worth buffering. */
const MAX_BYTES = 2 * 1024 * 1024;

const MAX_REDIRECTS = 3;

/**
 * A real browser's User-Agent. Not an attempt to disguise anything — the request is made on
 * the user's explicit instruction, one page at a time — but many sites serve a stripped or
 * empty page to a client that announces itself as a script, and a stripped page has no
 * JSON-LD in it.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 JobTrack';

/** Sites known to refuse this, so the message can name the way out instead of guessing. */
const KNOWN_BLOCKERS = ['linkedin.com', 'indeed.com', 'glassdoor.com'];

/**
 * "This posting could not be read from here" — as opposed to "your request was wrong".
 *
 * 422 rather than 502: the request was fine and nothing is broken on this side. A site
 * declining to be read by a program is an expected outcome of this feature, and the UI
 * treats it as a signpost to the paste-the-text tab rather than as a failure.
 */
export class IngestBlockedError extends HttpError {
  constructor(message: string) {
    super(422, message, undefined, 'ingest_blocked');
    this.name = 'IngestBlockedError';
  }
}

/**
 * How to name the opening a capture just collided with.
 *
 * Says *when* it was saved and what became of it, because "already saved" on its own
 * invites the reasonable next question of whether it is still sitting in the list.
 */
function alreadySavedMessage(existing: JobOpeningView): string {
  const what = `“${existing.jobTitle}” at ${existing.company.name}`;
  if (existing.convertedApplicationId !== null) {
    return `${what} is already saved — captured on ${existing.savedOn}, and you have since applied to it.`;
  }
  if (existing.archived) {
    return `${what} is already saved — captured on ${existing.savedOn}, and archived since.`;
  }
  return `${what} is already saved — it has been in JobTrack since ${existing.savedOn}.`;
}

/**
 * "This posting is already saved."
 *
 * 409 rather than 422: the request was well-formed and the state of the world is what
 * refuses it. `duplicate_opening` lets the extension tell this apart from a rejected token
 * or an unreachable API and stop offering the button again, without matching on prose.
 */
export class DuplicateOpeningError extends HttpError {
  /** The opening that already holds this posting, for a client that wants to link to it. */
  readonly existing: JobOpeningView;

  constructor(existing: JobOpeningView) {
    super(409, alreadySavedMessage(existing), { openingId: existing.id }, 'duplicate_opening');
    this.name = 'DuplicateOpeningError';
    this.existing = existing;
  }
}

export interface IngestResult {
  draft: PostingDraft;
  /** The same verdict the New Application form shows, so a capture can warn before it saves. */
  duplicate: DuplicateCheckResult;
}

export interface ClipResult extends IngestResult {
  opening: JobOpeningView;
}

/**
 * Fetch a posting page.
 *
 * Redirects are followed by hand rather than by `fetch`, so the hop count is ours to cap
 * and the final URL is known — the final URL is what `sourceName` should be derived from,
 * since board links routinely redirect to the ATS that actually hosts the posting.
 */
async function fetchPosting(url: string): Promise<{ html: string; finalUrl: string }> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new HttpError(400, 'That is not a URL');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new HttpError(400, 'Only http and https links can be fetched');
  }

  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en',
        },
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'did not answer in time' : 'could not be reached';
      throw new IngestBlockedError(`${current.hostname} ${reason}. Paste the posting text instead.`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) break;
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      // 999 is LinkedIn's; 403 is everyone else's. Either way the answer is the same.
      const blocker = KNOWN_BLOCKERS.some((host) => current.hostname.endsWith(host));
      throw new IngestBlockedError(
        blocker
          ? `${current.hostname} does not allow this — it blocks automated readers. Use the browser extension, or paste the posting text.`
          : `That page answered ${response.status}. Paste the posting text instead.`,
      );
    }

    // Read with a cap rather than trusting content-length, which a server need not send.
    const body = await response.arrayBuffer();
    const bytes = body.byteLength > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
    return { html: new TextDecoder('utf-8').decode(bytes), finalUrl: current.toString() };
  }

  throw new IngestBlockedError('That link redirected too many times.');
}

/** The verdict for a draft. A draft with no company yet cannot be checked against anything. */
async function verdictFor(
  repos: Repos,
  search: SearchIndex,
  draft: PostingDraft,
): Promise<DuplicateCheckResult> {
  if (draft.companyName.trim() === '') {
    return {
      verdict: 'none',
      companyMatched: false,
      matches: [],
      priorCount: 0,
      company: null,
      semanticUsed: false,
    };
  }
  return checkDuplicates(repos, search, { company: draft.companyName, title: draft.jobTitle });
}

export async function ingestUrl(
  repos: Repos,
  search: SearchIndex,
  url: string,
): Promise<IngestResult> {
  const { html, finalUrl } = await fetchPosting(url);
  const draft = parseJsonLdPosting(html, finalUrl);
  if (!draft) {
    throw new IngestBlockedError(
      'That page does not publish structured job data. Paste the posting text instead.',
    );
  }
  // The link the user typed is the one worth keeping; the redirect chain is an implementation
  // detail of the board, but it is what identifies the source system.
  draft.jobUrl = url;
  draft.sourceName = sourceFromUrl(finalUrl) ?? sourceFromUrl(url);

  return { draft, duplicate: await verdictFor(repos, search, draft) };
}

export async function ingestText(
  repos: Repos,
  search: SearchIndex,
  text: string,
  url?: string,
): Promise<IngestResult> {
  const draft = parsePostingText(text, url);
  return { draft, duplicate: await verdictFor(repos, search, draft) };
}

/**
 * Save a draft as an opening, unless that posting is already saved.
 *
 * Two different duplicate questions meet here, and treating them as one was the bug. "Have
 * I applied to this *company* before?" is a remark: the verdict comes back alongside the
 * saved opening so the UI can say so, because a second application to a company you like is
 * a perfectly reasonable thing to do. "Is this the same *posting* I already clipped?" is a
 * refusal: pressing Save twice on one tab — or opening the same ad next week having
 * forgotten — used to write a second identical opening and say nothing about it. That copy
 * carries no information anybody wanted, so it is declined and the existing one is named.
 *
 * Only this route enforces it, and deliberately so: `POST /api/openings` is a person typing
 * a record on purpose, while a clip is a button that looks the same whether or not it has
 * been pressed before.
 */
export async function clipPosting(
  repos: Repos,
  search: SearchIndex,
  draft: PostingDraft,
): Promise<ClipResult> {
  const existing = await findMatchingOpening(repos, draft);
  if (existing) throw new DuplicateOpeningError(existing);

  const duplicate = await verdictFor(repos, search, draft);
  const opening = await createOpening(repos, {
    companyName: draft.companyName,
    jobTitle: draft.jobTitle,
    jobUrl: draft.jobUrl,
    location: draft.location,
    workMode: draft.workMode,
    sourceName: draft.sourceName,
    salaryMin: draft.salaryMin,
    salaryMax: draft.salaryMax,
    salaryCurrency: draft.salaryCurrency,
    notes: draft.notes,
  });
  return { draft, duplicate, opening };
}
