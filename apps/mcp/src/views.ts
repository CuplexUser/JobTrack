/**
 * Compact projections of the API's view types, for the tools that hand back many records
 * at once.
 *
 * The view types are shaped for the web UI, which can afford a whole nested company
 * object and every derived column on every row. An MCP client cannot: Claude Desktop
 * rejects a tool result past its token ceiling outright rather than truncating it, and a
 * default page of fifty full `JobApplicationView`s lands well past that line — mostly on
 * fields nothing reading a list needs (`titleKey`, `periodYear`/`periodMonth`, the
 * company's `nameKey` and timestamps, `null` after `null`).
 *
 * So a list answers with what you would read off a row. Everything omitted is one
 * `get_application` or `get_company` away, which is the trade an agent wants: cheap
 * breadth, detail on request.
 */

import type { ContactView, FitResult, JobApplicationView, JobOpeningView, Note, NoteTarget } from '@jobtrack/shared';

/** Drop keys that carry nothing, so an unset field costs zero characters instead of six. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as T;
}

/** `50000-70000 USD`, or whichever half of it exists — `null` when neither does. */
function formatSalary(app: Pick<JobApplicationView, 'salaryMin' | 'salaryMax' | 'salaryCurrency'>): string | null {
  const { salaryMin: min, salaryMax: max, salaryCurrency: currency } = app;
  if (min === null && max === null) return null;
  const range = min !== null && max !== null ? `${min}-${max}` : `${min ?? max}`;
  return currency ? `${range} ${currency}` : range;
}

export interface ApplicationSummary {
  id: string;
  company: string;
  jobTitle: string;
  status: string;
  appliedOn: string;
  workMode?: string;
  location?: string;
  source?: string;
  salary?: string;
  jobUrl?: string;
  followUpOn?: string;
  tags?: string[];
  noteCount?: number;
  archived?: boolean;
}

/**
 * One application as a list row. Fields the record does not have are absent rather than
 * null, and so are the two defaults that say nothing — an unspecified work mode and
 * `archived: false`.
 */
export function applicationSummary(app: JobApplicationView): ApplicationSummary {
  return compact({
    id: app.id,
    company: app.company.name,
    jobTitle: app.jobTitle,
    status: app.status,
    appliedOn: app.appliedOn,
    workMode: app.workMode === 'unspecified' ? undefined : app.workMode,
    location: app.location ?? undefined,
    source: app.sourceName ?? undefined,
    salary: formatSalary(app) ?? undefined,
    jobUrl: app.jobUrl ?? undefined,
    followUpOn: app.followUpOn ?? undefined,
    tags: app.tags.length > 0 ? app.tags.map((tag) => tag.name) : undefined,
    noteCount: app.noteCount > 0 ? app.noteCount : undefined,
    archived: app.archived ? true : undefined,
  });
}

/**
 * How much of a note body a list row carries.
 *
 * Notes are the one free-text field in the app, so a few long ones are enough to blow a
 * whole `list_notes` past the limit on their own. A preview is what a list is for; the
 * body in full is what `get_note` is for.
 */
export const BODY_PREVIEW_CHARS = 500;

export interface NoteSummary {
  id: string;
  title: string;
  body: string;
  /** Present only when `body` was cut — call `get_note` for the rest. */
  bodyTruncated?: boolean;
  targetType: NoteTarget;
  targetId?: string;
  targetLabel?: string;
  pinned?: boolean;
  updatedAt: string;
}

export function noteSummary(note: Note & { targetLabel?: string | null }): NoteSummary {
  const truncated = note.body.length > BODY_PREVIEW_CHARS;
  return compact({
    id: note.id,
    title: note.title,
    body: truncated ? `${note.body.slice(0, BODY_PREVIEW_CHARS)}…` : note.body,
    bodyTruncated: truncated ? true : undefined,
    targetType: note.targetType,
    targetId: note.targetId ?? undefined,
    targetLabel: note.targetLabel ?? undefined,
    pinned: note.pinned ? true : undefined,
    updatedAt: note.updatedAt,
  });
}

/**
 * How much of an opening's notes a list row carries. Captured openings keep the whole
 * posting text in `notes`, which is exactly what makes a list of them too big to return.
 */
export const OPENING_NOTES_PREVIEW_CHARS = 300;

export interface OpeningSummary {
  id: string;
  company: string;
  jobTitle: string;
  savedOn: string;
  workMode?: string;
  location?: string;
  source?: string;
  salary?: string;
  jobUrl?: string;
  notes?: string;
  /** Present only when `notes` was cut. Call `get_opening` for the rest. */
  notesTruncated?: boolean;
  archived?: boolean;
  convertedApplicationId?: string;
  /** 0 to 100 against the user's profile, with the reasons; absent when there is no profile. */
  fit?: { score: number; reasons: string[] };
}

export function openingSummary(opening: JobOpeningView & { fit?: FitResult | null }): OpeningSummary {
  const notes = opening.notes ?? '';
  const truncated = notes.length > OPENING_NOTES_PREVIEW_CHARS;
  return compact({
    id: opening.id,
    company: opening.company.name,
    jobTitle: opening.jobTitle,
    savedOn: opening.savedOn,
    workMode: opening.workMode === 'unspecified' ? undefined : opening.workMode,
    location: opening.location ?? undefined,
    source: opening.sourceName ?? undefined,
    salary: formatSalary(opening) ?? undefined,
    jobUrl: opening.jobUrl ?? undefined,
    notes: notes ? (truncated ? `${notes.slice(0, OPENING_NOTES_PREVIEW_CHARS)}…` : notes) : undefined,
    notesTruncated: truncated ? true : undefined,
    archived: opening.archived ? true : undefined,
    convertedApplicationId: opening.convertedApplicationId ?? undefined,
    fit: opening.fit
      ? { score: opening.fit.score, reasons: opening.fit.reasons.map((reason) => `${reason.effect === 'minus' ? '-' : '+'} ${reason.label}`) }
      : undefined,
  });
}

/** How much of the free-text notes about a person a list row carries. */
export const CONTACT_ABOUT_PREVIEW_CHARS = 200;

export interface ContactSummary {
  id: string;
  name: string;
  company?: string;
  headline?: string;
  relationship: string;
  email?: string;
  linkedinUrl?: string;
  about?: string;
  reconnectOn?: string;
  lastInteractionOn?: string;
  interactionCount?: number;
  archived?: boolean;
}

export function contactSummary(contact: ContactView): ContactSummary {
  const about = contact.about ?? '';
  return compact({
    id: contact.id,
    name: contact.name,
    company: contact.companyName ?? undefined,
    headline: contact.headline ?? undefined,
    relationship: contact.relationship,
    email: contact.email ?? undefined,
    linkedinUrl: contact.linkedinUrl ?? undefined,
    about: about
      ? about.length > CONTACT_ABOUT_PREVIEW_CHARS
        ? `${about.slice(0, CONTACT_ABOUT_PREVIEW_CHARS)}…`
        : about
      : undefined,
    reconnectOn: contact.reconnectOn ?? undefined,
    lastInteractionOn: contact.lastInteractionOn ?? undefined,
    interactionCount: contact.interactionCount > 0 ? contact.interactionCount : undefined,
    archived: contact.archived ? true : undefined,
  });
}
