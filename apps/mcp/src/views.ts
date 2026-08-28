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

import type { JobApplicationView, Note, NoteTarget } from '@jobtrack/shared';

/** Drop keys that carry nothing, so an unset field costs zero characters instead of six. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== null && v !== undefined),
  ) as T;
}

/** `50000-70000 USD`, or whichever half of it exists — `null` when neither does. */
function formatSalary(app: JobApplicationView): string | null {
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
