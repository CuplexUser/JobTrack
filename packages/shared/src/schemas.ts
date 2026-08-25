/**
 * Zod schemas shared by the API (request validation) and the web app (form validation), so
 * the two cannot disagree about what a valid application looks like.
 */

import { z } from 'zod';
import {
  APPLICATION_STATUSES,
  WORK_MODES,
  NOTE_TARGETS,
  TAG_SCOPES,
  LINK_TARGETS,
} from './types.js';

/** A calendar day. Kept as a string end to end; see periods.ts for why. */
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

/** Trimmed free text where an empty box means "not set" rather than an empty string. */
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === '' ? null : v));

export const statusSchema = z.enum(APPLICATION_STATUSES);
export const workModeSchema = z.enum(WORK_MODES);
export const noteTargetSchema = z.enum(NOTE_TARGETS);
export const tagScopeSchema = z.enum(TAG_SCOPES);
export const linkTargetSchema = z.enum(LINK_TARGETS);

const tagList = z.array(z.string().trim().min(1).max(60)).max(30);

/**
 * Creating an application. `companyName` rather than `companyId`: the form lets you type a
 * new employer, and the API resolves-or-creates the company inside one transaction. Tags
 * work the same way, by name.
 */
export const createApplicationSchema = z
  .object({
    companyName: z.string().trim().min(1, 'Company is required').max(200),
    jobTitle: z.string().trim().min(1, 'Job title is required').max(200),
    appliedOn: dateOnly,
    status: statusSchema.default('applied'),
    jobUrl: optionalTrimmed(2000),
    location: optionalTrimmed(200),
    workMode: workModeSchema.default('unspecified'),
    sourceName: optionalTrimmed(120),
    salaryMin: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((v) => v ?? null),
    salaryMax: z
      .number()
      .int()
      .nonnegative()
      .nullish()
      .transform((v) => v ?? null),
    salaryCurrency: optionalTrimmed(8),
    followUpOn: dateOnly.nullish().transform((v) => v ?? null),
    tags: tagList.default([]),
    /** Free-text notes typed straight into the form; stored as a linked note. */
    notes: optionalTrimmed(20000),
  })
  .refine((v) => v.salaryMin === null || v.salaryMax === null || v.salaryMin <= v.salaryMax, {
    message: 'Minimum salary cannot exceed the maximum',
    path: ['salaryMin'],
  });

/**
 * Partial update. Declared separately rather than via `.partial()`, because the refine on
 * the create schema wraps the object and makes it unavailable.
 */
export const patchApplicationSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200).optional(),
    jobTitle: z.string().trim().min(1).max(200).optional(),
    appliedOn: dateOnly.optional(),
    status: statusSchema.optional(),
    /** Recorded on the status event when the status is what changed. */
    statusComment: z.string().trim().max(2000).nullish(),
    jobUrl: optionalTrimmed(2000).optional(),
    location: optionalTrimmed(200).optional(),
    workMode: workModeSchema.optional(),
    sourceName: optionalTrimmed(120).optional(),
    salaryMin: z.number().int().nonnegative().nullish(),
    salaryMax: z.number().int().nonnegative().nullish(),
    salaryCurrency: optionalTrimmed(8).optional(),
    followUpOn: dateOnly.nullish(),
    archived: z.boolean().optional(),
    tags: tagList.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const changeStatusSchema = z.object({
  status: statusSchema,
  occurredOn: dateOnly.optional(),
  comment: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v ?? null),
});

/**
 * Repeatable query values arrive either as `?status=a&status=b` or `?status=a,b`.
 * Both are accepted and normalized to an array.
 */
const csvArray = <T extends z.ZodType<string, string>>(item: T) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return undefined;
    const parts = Array.isArray(v) ? v.map(String) : String(v).split(',');
    const cleaned = parts.map((p) => p.trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned : undefined;
  }, z.array(item).optional());

/**
 * The list/filter query.
 *
 * The *same* object drives the list view, the search endpoint and both exports — which is
 * what makes "export exactly what I'm looking at" true rather than approximately true.
 * Everything arrives as a string in a URL, so numbers and booleans are coerced here.
 */
export const applicationFilterSchema = z.object({
  q: z.string().trim().max(300).optional(),
  year: z.coerce.number().int().min(1970).max(2200).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  status: csvArray(statusSchema),
  workMode: csvArray(workModeSchema),
  tags: csvArray(z.string()),
  companyId: z.uuid().optional(),
  source: z.string().trim().max(120).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  archived: z
    .enum(['true', 'false', 'all'])
    .default('false')
    .transform((v) => (v === 'all' ? ('all' as const) : v === 'true')),
  /** Only applications whose follow-up date has arrived and are not yet concluded. */
  followUpDue: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sort: z.enum(['appliedOn', 'company', 'jobTitle', 'status', 'createdAt']).default('appliedOn'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type ApplicationFilter = z.output<typeof applicationFilterSchema>;

export const duplicateCheckSchema = z.object({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).optional().default(''),
  /** Set when editing, so a record does not report itself as its own duplicate. */
  excludeId: z.uuid().optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(300),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  types: csvArray(z.enum(['application', 'company', 'note'])),
});

export const exportQuerySchema = applicationFilterSchema.extend({
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

export type ExportQuery = z.output<typeof exportQuerySchema>;

export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  website: optionalTrimmed(2000),
  location: optionalTrimmed(200),
  tags: tagList.default([]),
});

export const patchCompanySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    website: optionalTrimmed(2000).optional(),
    location: optionalTrimmed(200).optional(),
    archived: z.boolean().optional(),
    tags: tagList.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(50000).default(''),
  targetType: noteTargetSchema.default('standalone'),
  targetId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  pinned: z.boolean().default(false),
});

export const patchNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().max(50000).optional(),
    targetType: noteTargetSchema.optional(),
    targetId: z.uuid().nullish(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const createTagSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: optionalTrimmed(30),
  scope: tagScopeSchema.default('both'),
});

export type CreateApplicationInput = z.input<typeof createApplicationSchema>;
export type PatchApplicationInput = z.input<typeof patchApplicationSchema>;
export type CreateCompanyInput = z.input<typeof createCompanySchema>;
export type CreateNoteInput = z.input<typeof createNoteSchema>;
export type ChangeStatusInput = z.input<typeof changeStatusSchema>;
