/**
 * The seven tables, described with repolayer's schema descriptor.
 *
 * Two conventions run through all of them:
 *
 * 1. **Fields are camelCase, columns are snake_case.** repolayer's `column` option maps
 *    between them, so application code never types an underscore and the database never
 *    sees a capital letter.
 *
 * 2. **No column is named after a reserved word.** repolayer never quotes identifiers (a
 *    deliberate trade documented in its engines.md), so a column called `order`, `rank` or
 *    `position` would compile to broken SQL on at least one engine. That is why the job
 *    title column is `job_title` and not `position`, and why the status event's free text
 *    is `comment_text` rather than `comment`.
 */

import { defineSchema, type Infer } from 'repolayer';

/** Every table carries these, maintained by repolayer rather than by database defaults. */
const timestampFields = {
  createdAt: { type: 'date', column: 'created_at' },
  updatedAt: { type: 'date', column: 'updated_at' },
} as const;

export const companySchema = defineSchema({
  id: { type: 'string', primaryKey: true },
  name: { type: 'string' },
  /** Normalized for duplicate detection; unique so two spellings cannot both take root. */
  nameKey: { type: 'string', unique: true, column: 'name_key' },
  website: { type: 'string', nullable: true },
  location: { type: 'string', nullable: true },
  archived: { type: 'boolean' },
  ...timestampFields,
});

export const applicationSchema = defineSchema({
  id: { type: 'string', primaryKey: true },
  companyId: { type: 'string', column: 'company_id' },
  jobTitle: { type: 'string', column: 'job_title' },
  titleKey: { type: 'string', column: 'title_key' },
  appliedOn: { type: 'date', column: 'applied_on' },
  /**
   * Denormalized from `appliedOn`. repolayer has no SQL date functions, so this is what
   * turns "show me March 2026" into an indexed equality filter that compiles identically
   * on SQLite and Postgres. Written in exactly one place: applications.service.ts.
   */
  periodYear: { type: 'integer', column: 'period_year' },
  periodMonth: { type: 'integer', column: 'period_month' },
  status: { type: 'string' },
  jobUrl: { type: 'string', nullable: true, column: 'job_url' },
  location: { type: 'string', nullable: true },
  workMode: { type: 'string', column: 'work_mode' },
  sourceName: { type: 'string', nullable: true, column: 'source_name' },
  salaryMin: { type: 'integer', nullable: true, column: 'salary_min' },
  salaryMax: { type: 'integer', nullable: true, column: 'salary_max' },
  salaryCurrency: { type: 'string', nullable: true, column: 'salary_currency' },
  followUpOn: { type: 'date', nullable: true, column: 'follow_up_on' },
  archived: { type: 'boolean' },
  ...timestampFields,
});

export const tagSchema = defineSchema({
  id: { type: 'string', primaryKey: true },
  name: { type: 'string' },
  nameKey: { type: 'string', unique: true, column: 'name_key' },
  color: { type: 'string', nullable: true },
  scope: { type: 'string' },
  ...timestampFields,
});

/**
 * Polymorphic junction between tags and the things they label.
 *
 * repolayer has no joins, so this is read with a batched `in` on `target_id` and stitched
 * in memory by hydrate.ts — never one query per row.
 */
export const tagLinkSchema = defineSchema({
  id: { type: 'string', primaryKey: true },
  tagId: { type: 'string', column: 'tag_id' },
  targetType: { type: 'string', column: 'target_type' },
  targetId: { type: 'string', column: 'target_id' },
  ...timestampFields,
});

export const noteSchema = defineSchema({
  id: { type: 'string', primaryKey: true },
  title: { type: 'string' },
  body: { type: 'string' },
  targetType: { type: 'string', column: 'target_type' },
  targetId: { type: 'string', nullable: true, column: 'target_id' },
  pinned: { type: 'boolean' },
  ...timestampFields,
});

/** The dated audit trail. Written automatically whenever an application's status changes. */
export const statusEventSchema = defineSchema({
  id: { type: 'string', primaryKey: true },
  applicationId: { type: 'string', column: 'application_id' },
  fromStatus: { type: 'string', nullable: true, column: 'from_status' },
  toStatus: { type: 'string', column: 'to_status' },
  occurredOn: { type: 'date', column: 'occurred_on' },
  commentText: { type: 'string', nullable: true, column: 'comment_text' },
  ...timestampFields,
});

/**
 * Embeddings, kept off the hot application row so a list query never drags 384 floats per
 * record across the wire. `textHash` makes re-embedding idempotent: on startup only rows
 * whose composed text actually changed are recomputed.
 */
export const searchVectorSchema = defineSchema({
  id: { type: 'string', primaryKey: true },
  targetType: { type: 'string', column: 'target_type' },
  targetId: { type: 'string', column: 'target_id' },
  model: { type: 'string' },
  dim: { type: 'integer' },
  embedding: { type: 'json' },
  textHash: { type: 'string', column: 'text_hash' },
  ...timestampFields,
});

/**
 * A saved opportunity — "found this, don't have time to apply right now". Deliberately
 * thinner than `applicationSchema`: no status pipeline, no tags, no linked notes, just
 * enough to remember the posting until it becomes a real application.
 *
 * `convertedApplicationId` is set once, by `convertOpening`, and never cleared — it is the
 * trace of what this opening became, not a piece of state anything else edits.
 */
export const jobOpeningSchema = defineSchema({
  id: { type: 'string', primaryKey: true },
  companyId: { type: 'string', column: 'company_id' },
  jobTitle: { type: 'string', column: 'job_title' },
  jobUrl: { type: 'string', nullable: true, column: 'job_url' },
  location: { type: 'string', nullable: true },
  workMode: { type: 'string', column: 'work_mode' },
  sourceName: { type: 'string', nullable: true, column: 'source_name' },
  salaryMin: { type: 'integer', nullable: true, column: 'salary_min' },
  salaryMax: { type: 'integer', nullable: true, column: 'salary_max' },
  salaryCurrency: { type: 'string', nullable: true, column: 'salary_currency' },
  notes: { type: 'string', nullable: true },
  savedOn: { type: 'date', column: 'saved_on' },
  archived: { type: 'boolean' },
  convertedApplicationId: { type: 'string', nullable: true, column: 'converted_application_id' },
  ...timestampFields,
});

export type CompanyRow = Infer<typeof companySchema>;
export type ApplicationRow = Infer<typeof applicationSchema>;
export type TagRow = Infer<typeof tagSchema>;
export type TagLinkRow = Infer<typeof tagLinkSchema>;
export type NoteRow = Infer<typeof noteSchema>;
export type StatusEventRow = Infer<typeof statusEventSchema>;
export type SearchVectorRow = Infer<typeof searchVectorSchema>;
export type JobOpeningRow = Infer<typeof jobOpeningSchema>;
