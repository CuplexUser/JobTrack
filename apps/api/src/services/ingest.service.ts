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
  STATUS_LABELS,
  draftFromPlatsbankenAd,
  locationFromText,
  parseJsonLdPosting,
  parsePostingText,
  platsbankenAdId,
  postingNote,
  readableTextFromHtml,
  sourceFromUrl,
  workModeFromText,
  type JobApplicationView,
  type JobOpeningView,
  type PlatsbankenAd,
  type PostingDraft,
} from '@jobtrack/shared';
import type { Repos } from '../db/repos.js';
import type { SearchIndex } from '../search/index.js';
import { HttpError } from '../lib/errors.js';
import { checkDuplicates, type DuplicateCheckResult } from './duplicates.service.js';
import {
  createOpening,
  findMatchingApplication,
  findMatchingOpening,
  type OpeningIdentity,
} from './openings.service.js';

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
    return `${what} was already saved on ${existing.savedOn}, and you have since applied to it.`;
  }
  if (existing.archived) {
    return `${what} was already saved on ${existing.savedOn}, and archived since.`;
  }
  return `${what} is already saved. It has been in JobTrack since ${existing.savedOn}.`;
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

/**
 * "You already applied to this posting."
 *
 * The same 409 as `DuplicateOpeningError`, with its own code so a client can say "applied"
 * rather than "saved". The extension treats any 409 as "already in JobTrack" and shows the
 * message, which is the right answer for both.
 */
export class AlreadyAppliedError extends HttpError {
  /** The application that already covers this posting. */
  readonly existing: JobApplicationView;

  constructor(existing: JobApplicationView) {
    super(
      409,
      `You applied to “${existing.jobTitle}” at ${existing.company.name} on ${existing.appliedOn} (status: ${STATUS_LABELS[existing.status]}).`,
      { applicationId: existing.id },
      'duplicate_application',
    );
    this.name = 'AlreadyAppliedError';
    this.existing = existing;
  }
}

/**
 * Refuse a posting that is already in JobTrack, as a saved opening or as an application.
 *
 * An opening match is reported first: it is the more literal "you have this already", and
 * an opening converted into an application carries that application's id with it.
 */
export async function assertNewPosting(repos: Repos, posting: OpeningIdentity): Promise<void> {
  const opening = await findMatchingOpening(repos, posting);
  if (opening) throw new DuplicateOpeningError(opening);
  const application = await findMatchingApplication(repos, posting);
  if (application) throw new AlreadyAppliedError(application);
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
          ? `${current.hostname} does not allow this, because it blocks automated readers. Use the browser extension, or paste the posting text.`
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

/**
 * Arbetsförmedlingen's Jobsearch API: public, unauthenticated, and the only place Platsbanken's
 * own content can be read from, since the site itself renders it client-side (see
 * `ingestUrl` below). Returns `null` on any failure so the caller can fall back to the
 * generic page-fetch path rather than hard-failing on a site known to need this detour.
 */
async function fetchPlatsbankenAd(id: string): Promise<PlatsbankenAd | null> {
  try {
    const response = await fetch(`https://jobsearch.api.jobtechdev.se/ad/${id}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as PlatsbankenAd;
  } catch {
    return null;
  }
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
      contacts: [],
    };
  }
  return checkDuplicates(repos, search, { company: draft.companyName, title: draft.jobTitle });
}

/**
 * Fill in what a posting's structured data left out, from the page it was read off.
 *
 * Structured data is stated by the site and so is trusted first, but it is routinely
 * partial: a `JobPosting` with no `jobLocation`, or with the description carried only in
 * the visible markup, is ordinary. Taking those two from the page is the difference between
 * a draft that says where the job is and one whose location box the user fills in by hand
 * every time.
 *
 * The page's own furniture — navigation, cookie banner, footer — is dropped before any of
 * this, so what lands in the note is the posting rather than the website around it.
 */
function fillFromPage(draft: PostingDraft, html: string): void {
  if (draft.location !== null && draft.notes !== null && draft.workMode !== 'unspecified') return;

  const text = readableTextFromHtml(html);
  draft.location ??= locationFromText(text);
  draft.notes ??= postingNote(text);
  if (draft.workMode === 'unspecified') {
    draft.workMode = workModeFromText(`${draft.location ?? ''} ${text.slice(0, 4000)}`);
  }
}

export async function ingestUrl(
  repos: Repos,
  search: SearchIndex,
  url: string,
): Promise<IngestResult> {
  // Platsbanken renders every posting client-side, so a fetched page never carries the ad —
  // only the empty app shell, whatever the URL. Its own public API is read instead, and this
  // has to happen before the generic fetch, which would otherwise see that empty shell and
  // report the site as publishing no structured data, which is technically true and useless.
  const adId = platsbankenAdId(url);
  if (adId) {
    const ad = await fetchPlatsbankenAd(adId);
    if (ad) {
      const draft = draftFromPlatsbankenAd(ad, url);
      return { draft, duplicate: await verdictFor(repos, search, draft) };
    }
  }

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
  fillFromPage(draft, html);

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
 * A posting already applied to is refused the same way, since an opening for it is a to-do
 * for work that is done. `allowDuplicate` skips both checks, for an MCP client that has
 * asked the user and been told to save anyway.
 *
 * Only clips and the MCP `create_opening` tool enforce it, and deliberately so:
 * `POST /api/openings` is a person typing a record on purpose, while a clip is a button that
 * looks the same whether or not it has been pressed before, and an assistant has no memory
 * of what it saved last week.
 */
export async function clipPosting(
  repos: Repos,
  search: SearchIndex,
  draft: PostingDraft,
  options: { allowDuplicate?: boolean } = {},
): Promise<ClipResult> {
  if (!options.allowDuplicate) await assertNewPosting(repos, draft);

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
