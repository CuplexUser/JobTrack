/**
 * Database rows -> wire objects.
 *
 * Two things change at this boundary. Dates become strings, because a calendar day that
 * travels as a `Date` picks up a timezone it never had and can arrive as the previous day.
 * And the free-form string columns (`status`, `workMode`, `targetType`) are narrowed back
 * to their unions — the database has no enum type on every engine, so the guarantee has to
 * be re-established here rather than assumed.
 */

import {
  APPLICATION_STATUSES,
  NOTE_TARGETS,
  TAG_SCOPES,
  WORK_MODES,
  formatDateOnly,
  type ApplicationStatus,
  type Company,
  type JobApplication,
  type JobOpening,
  type Note,
  type NoteTarget,
  type StatusEvent,
  type Tag,
  type TagScope,
  type WorkMode,
} from '@jobtrack/shared';

import type {
  ApplicationRow,
  CompanyRow,
  JobOpeningRow,
  NoteRow,
  StatusEventRow,
  TagRow,
} from './schema.js';

/**
 * Narrow a stored string back to its union, falling back rather than throwing.
 *
 * A row written by an older version of the app, or by hand, should render as something
 * sensible instead of taking down the whole list endpoint.
 */
function oneOf<T extends string>(values: readonly T[], raw: string, fallback: T): T {
  return (values as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export const toStatus = (raw: string): ApplicationStatus =>
  oneOf(APPLICATION_STATUSES, raw, 'applied');
export const toWorkMode = (raw: string): WorkMode => oneOf(WORK_MODES, raw, 'unspecified');
export const toNoteTarget = (raw: string): NoteTarget => oneOf(NOTE_TARGETS, raw, 'standalone');
export const toTagScope = (raw: string): TagScope => oneOf(TAG_SCOPES, raw, 'both');

const dateOnly = (value: Date): string => formatDateOnly(value);
const iso = (value: Date): string => value.toISOString();

export function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    nameKey: row.nameKey,
    website: row.website,
    location: row.location,
    archived: row.archived,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toApplication(row: ApplicationRow): JobApplication {
  return {
    id: row.id,
    companyId: row.companyId,
    jobTitle: row.jobTitle,
    titleKey: row.titleKey,
    appliedOn: dateOnly(row.appliedOn),
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    status: toStatus(row.status),
    jobUrl: row.jobUrl,
    location: row.location,
    workMode: toWorkMode(row.workMode),
    sourceName: row.sourceName,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    followUpOn: row.followUpOn ? dateOnly(row.followUpOn) : null,
    archived: row.archived,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    nameKey: row.nameKey,
    color: row.color,
    scope: toTagScope(row.scope),
  };
}

export function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    targetType: toNoteTarget(row.targetType),
    targetId: row.targetId,
    pinned: row.pinned,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toOpening(row: JobOpeningRow): JobOpening {
  return {
    id: row.id,
    companyId: row.companyId,
    jobTitle: row.jobTitle,
    jobUrl: row.jobUrl,
    location: row.location,
    workMode: toWorkMode(row.workMode),
    sourceName: row.sourceName,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryCurrency: row.salaryCurrency,
    notes: row.notes,
    savedOn: dateOnly(row.savedOn),
    archived: row.archived,
    convertedApplicationId: row.convertedApplicationId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toStatusEvent(row: StatusEventRow): StatusEvent {
  return {
    id: row.id,
    applicationId: row.applicationId,
    fromStatus: row.fromStatus ? toStatus(row.fromStatus) : null,
    toStatus: toStatus(row.toStatus),
    occurredOn: dateOnly(row.occurredOn),
    // `comment_text` in the database only because `comment` is too close to a reserved
    // word to risk on an engine repolayer never quotes identifiers for.
    comment: row.commentText,
    createdAt: iso(row.createdAt),
  };
}
